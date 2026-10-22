import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const event = await prisma.event.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true, title: true, watermarkVersion: true } });
  if (!event) return Response.json({ error: 'Event not found' }, { status: 404 });
  const photos = await prisma.photo.findMany({
    where: { eventId: event.id, status: 'READY', removedAt: null,
      variants: { some: { kind: 'PREVIEW', watermarkVersion: event.watermarkVersion } } },
    orderBy: { createdAt: 'desc' }, take: 100,
    include: { photographer: { select: { name: true } } }
  });
  // Deliberately exclude EXIF GPS and any internal Immich identifiers.
  return Response.json({ event: { title: event.title, slug }, photos: photos.map(p => ({
    id: p.id, fileName: p.fileName, photographer: p.photographer?.name || 'Tim Dokumentasi',
    previewUrl: `/api/photos/${p.id}/preview`, thumbnailUrl: `/api/photos/${p.id}/thumbnail`
  })) }, { headers: { 'Cache-Control': 'no-store' } });
}
