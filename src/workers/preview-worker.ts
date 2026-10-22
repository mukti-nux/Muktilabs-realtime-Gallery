import { Worker } from 'bullmq';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { immich, readImageResponse } from '../lib/immich-adapter';
import { cachePath, atomicWrite } from '../lib/files';
import { queueConnection, type PreviewJob } from '../lib/queue';
import { asError } from '../lib/http';

const MAX_PIXELS = 120_000_000;
const TARGET_PIXELS = 2_000_000;
const JPG_QUALITY = 84;

async function sourceBuffer(assetId: string) {
  // Immich native preview is preferable, original is fetched only to avoid upscaling.
  let preview: Buffer;
  try {
    preview = await readImageResponse(await immich.getPreview(assetId));
  } catch (error) {
    console.warn(`Preview for ${assetId} not ready: ${asError(error)}`);
    preview = await readImageResponse(await immich.getOriginal(assetId));
  }
  const meta = await sharp(preview, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!meta.width || !meta.height) throw new Error('Image has no dimensions');
  if (meta.width * meta.height >= TARGET_PIXELS) return preview;
  try {
    const original = await readImageResponse(await immich.getOriginal(assetId));
    const origMeta = await sharp(original, { limitInputPixels: MAX_PIXELS }).metadata();
    if ((origMeta.width || 0) * (origMeta.height || 0) > meta.width * meta.height) return original;
  } catch {
    // RAW formats may not be decodable by Sharp; don't upscale native Immich preview.
  }
  return preview;
}

/** Convert to pixel-limited JPEG; apply the event watermark within the photo bounds. */
export async function makeWatermarkedPreview(input: Buffer, watermarkPng: Buffer) {
  const metadata = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!metadata.width || !metadata.height) throw new Error('Cannot identify image dimensions');
  const swap = metadata.orientation && [5,6,7,8].includes(metadata.orientation);
  const width = swap ? metadata.height : metadata.width;
  const height = swap ? metadata.width : metadata.height;
  const scale = Math.min(1, Math.sqrt(TARGET_PIXELS / (width * height)));
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  const base = await sharp(input, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(w, h, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .jpeg({ quality: JPG_QUALITY, mozjpeg: true })
    .toBuffer();

  const m = await sharp(base).metadata();
  if (!m.width || !m.height) throw new Error('Unable to resize photo');
  const wmWidth = Math.min(Math.max(90, Math.floor(m.width * .28)), Math.floor(m.width * .6));
  const watermark = await sharp(watermarkPng).resize({ width: wmWidth, height: Math.max(1, Math.floor(m.height * .45)), fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const wmMeta = await sharp(watermark).metadata();
  const margin = Math.max(8, Math.floor(m.width * 0.02));
  const left = Math.max(0, m.width - (wmMeta.width || 0) - margin);
  const top = Math.max(0, m.height - (wmMeta.height || 0) - margin);
  const composited = await sharp(base)
    .composite([{ input: watermark, left, top }])
    .jpeg({ quality: JPG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { data: composited, width: m.width, height: m.height };
}

export async function processPreviewJob(job: PreviewJob) {
  const photo = await prisma.photo.findUnique({ where: { id: job.photoId }, include: { event: true } });
  if (!photo || photo.removedAt) return;
  const ev = photo.event;
  if (ev.watermarkVersion !== job.watermarkVersion) return; // superseded job
  if (!ev.watermarkPath) throw new Error('Event watermark not configured');
  await prisma.photo.update({ where: { id: photo.id }, data: { status: 'PROCESSING', lastError: null } });
  try {
    const original = await sourceBuffer(photo.immichAssetId);
    const wm = await readFile(cachePath(ev.watermarkPath));
    const preview = await makeWatermarkedPreview(original, wm);
    const thumbData = await sharp(preview.data)
      .resize({ width: 600, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true }).toBuffer();
    const thumbMeta = await sharp(thumbData).metadata();
    const previewRel = `variants/${ev.id}/${photo.id}/v${job.watermarkVersion}/preview.jpg`;
    const thumbnailRel = `variants/${ev.id}/${photo.id}/v${job.watermarkVersion}/thumbnail.jpg`;
    await atomicWrite(previewRel, preview.data);
    await atomicWrite(thumbnailRel, thumbData);
    // Complete DB variant metadata only after files are written.
    await prisma.$transaction(async tx => {
      await tx.photoVariant.upsert({
        where: { photoId_kind_watermarkVersion: { photoId: photo.id, kind: 'PREVIEW', watermarkVersion: job.watermarkVersion } },
        create: { photoId: photo.id, kind: 'PREVIEW', watermarkVersion: job.watermarkVersion, path: previewRel, width: preview.width, height: preview.height },
        update: { path: previewRel, width: preview.width, height: preview.height }
      });
      await tx.photoVariant.upsert({
        where: { photoId_kind_watermarkVersion: { photoId: photo.id, kind: 'THUMBNAIL', watermarkVersion: job.watermarkVersion } },
        create: { photoId: photo.id, kind: 'THUMBNAIL', watermarkVersion: job.watermarkVersion, path: thumbnailRel, width: thumbMeta.width ?? 0, height: thumbMeta.height ?? 0 },
        update: { path: thumbnailRel, width: thumbMeta.width ?? 0, height: thumbMeta.height ?? 0 }
      });
      // Don't publish stale watermark versions if admin updated them during processing.
      const latest = await tx.event.findUniqueOrThrow({ where: { id: ev.id } });
      if (latest.watermarkVersion === job.watermarkVersion) {
        await tx.photo.update({ where: { id: photo.id }, data: { status: 'READY', lastError: null } });
      }
    });
    console.log(`READY: ${photo.id}, watermark v${job.watermarkVersion}`);
  } catch (error) {
    await prisma.photo.update({ where: { id: photo.id }, data: { status: 'FAILED', lastError: asError(error).slice(0, 1000) } });
    throw error; // BullMQ exponential retries
  }
}

if (process.argv[1]?.endsWith('preview-worker.ts')) {
  const worker = new Worker<PreviewJob>('gallery-preview-v1', async job => processPreviewJob(job.data), {
    connection: queueConnection,
    concurrency: 2,
    lockDuration: 5 * 60_000
  });
  worker.on('error', e => console.error('Worker error', e));
  worker.on('failed', (job, error) => console.error(`FAILED ${job?.id}: ${error.message}`));
  console.log('Gallery preview worker started (concurrency=2)');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => { await worker.close(); await queueConnection.quit(); await prisma.$disconnect(); process.exit(0); });
  }
}
