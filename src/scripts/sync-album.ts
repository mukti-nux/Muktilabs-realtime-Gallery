import { prisma } from '../lib/prisma';
import { previewQueue, queueConnection } from '../lib/queue';
import { syncAlbum } from '../services/sync';

async function main() {
  const slug = process.argv[2];
  const prune = process.argv.includes('--prune');
  if (!slug) throw new Error('Usage: npm run sync:album -- <event-slug> [--prune]');
  const event = await prisma.event.findUniqueOrThrow({ where: { slug } });
  console.log(await syncAlbum(event.id, { prune }));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  await previewQueue.close(); await queueConnection.quit(); await prisma.$disconnect();
});
