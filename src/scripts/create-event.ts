import { prisma } from '../lib/prisma';
import { ensureAlbum } from '../services/events';

async function main() {
  const [slug, ...titleParts] = process.argv.slice(2);
  const title = titleParts.join(' ').trim();
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !title) {
    throw new Error('Usage: npm run create:event -- popda-panahan-2026 "POPDA Panahan 2026"');
  }
  const event = await prisma.event.upsert({
    where: { slug },
    update: {}, // do not mutate existing event on retries
    create: { slug, title }
  });
  const albumId = await ensureAlbum(event.id);
  console.log({ eventId: event.id, slug: event.slug, albumId, status: event.status });
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
