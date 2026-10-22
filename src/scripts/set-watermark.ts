import { prisma } from '../lib/prisma';
import { cachePath, atomicWrite } from '../lib/files';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

async function main() {
  const [slug, inputFile] = process.argv.slice(2);
  if (!slug || !inputFile) throw new Error('Usage: npm run watermark:set -- <event-slug> /path/watermark.png');
  const bytes = await readFile(inputFile);
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error('Watermark >10MB');
  const meta = await sharp(bytes).metadata();
  if (meta.format !== 'png' || !meta.hasAlpha || !meta.width || !meta.height || meta.width > 5000 || meta.height > 5000) {
    throw new Error('Watermark must be transparent PNG <= 5000px');
  }
  const event = await prisma.event.findUniqueOrThrow({ where: { slug } });
  const next = event.watermarkVersion + 1;
  const relative = `watermarks/${event.id}/v${next}.png`;
  await atomicWrite(relative, bytes);
  // optimistic concurrency: prevent simultaneous admin updates from reusing same version
  const changed = await prisma.event.updateMany({ where: { id: event.id, watermarkVersion: event.watermarkVersion }, data: { watermarkVersion: next, watermarkPath: relative } });
  if (!changed.count) throw new Error('Concurrent watermark update; retry');
  console.log(`Watermark updated to v${next}. Run sync:album ${slug} to enqueue preview jobs.`);
  // Old watermark versions remain for rollback; do not delete until all active references are gone.
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
