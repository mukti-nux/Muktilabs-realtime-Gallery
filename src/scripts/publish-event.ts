import { prisma } from '../lib/prisma';
async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('Usage: npm run publish:event -- <slug>');
  const event = await prisma.event.findUniqueOrThrow({ where: { slug }, include: { photos: { where: { status:'READY', removedAt:null }, take: 1 } } });
  if (!event.immichAlbumId || !event.watermarkPath || !event.watermarkVersion) throw new Error('Event requires album and watermark');
  if (!event.photos.length) throw new Error('Event has no processed READY photos');
  await prisma.event.update({ where: { id: event.id }, data: { status:'PUBLISHED' } });
  console.log(`Published: /gallery/${event.slug}`);
}
main().catch(e => { console.error(e); process.exitCode=1; }).finally(()=>prisma.$disconnect());
