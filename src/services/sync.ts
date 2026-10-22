import { Prisma, PhotoStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { immich } from '../lib/immich-adapter';
import { enqueuePreview } from '../lib/queue';
import { ensureAlbum } from './events';

export async function syncAlbum(eventId: string, options: { prune?: boolean } = {}) {
  const albumId = await ensureAlbum(eventId);
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const observed = new Set<string>();
  const needsQueue: string[] = [];

  for await (const asset of immich.albumAssets(albumId)) {
    if (asset.type && asset.type !== 'IMAGE') continue;
    observed.add(asset.id);
    const previous = await prisma.photo.findUnique({ where: { eventId_immichAssetId: { eventId, immichAssetId: asset.id } } });
    const photo = await prisma.photo.upsert({
      where: { eventId_immichAssetId: { eventId, immichAssetId: asset.id } },
      create: {
        eventId, immichAssetId: asset.id, fileName: asset.originalFileName,
        width: asset.width ?? null, height: asset.height ?? null,
        exif: (asset.exifInfo ?? undefined) as Prisma.InputJsonValue | undefined,
        status: PhotoStatus.SYNCED
      },
      update: {
        fileName: asset.originalFileName, width: asset.width ?? null, height: asset.height ?? null,
        exif: (asset.exifInfo ?? undefined) as Prisma.InputJsonValue | undefined,
        lastSeenAt: new Date(),
        ...(previous?.removedAt ? { removedAt: null, status: PhotoStatus.SYNCED } : {})
      }
    });
    const hasVariant = await prisma.photoVariant.findUnique({ where: {
      photoId_kind_watermarkVersion: { photoId: photo.id, kind: 'PREVIEW', watermarkVersion: event.watermarkVersion }
    } });
    if (event.watermarkVersion > 0 && !hasVariant) needsQueue.push(photo.id);
  }
  // Never prune on partial error. This section runs only on completed iteration.
  if (options.prune) {
    const local = await prisma.photo.findMany({ where: { eventId, removedAt: null }, select: { id: true, immichAssetId: true } });
    const missing = local.filter(p => !observed.has(p.immichAssetId)).map(p => p.id);
    if (missing.length) await prisma.photo.updateMany({ where: { id: { in: missing } }, data: { status: PhotoStatus.REMOVED, removedAt: new Date() } });
  }

  await prisma.event.update({ where: { id: eventId }, data: { lastSyncedAt: new Date() } });
  for (const photoId of needsQueue) {
    await prisma.photo.updateMany({ where: { id: photoId, removedAt: null }, data: { status: PhotoStatus.QUEUED, lastError: null } });
    await enqueuePreview(photoId, event.watermarkVersion);
  }
  return { albumId, seenAssets: observed.size, queued: needsQueue.length, prune: Boolean(options.prune) };
}
