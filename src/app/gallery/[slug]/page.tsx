import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import GalleryClient from './gallery-client';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await prisma.event.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true, title: true, watermarkVersion: true } });
  if (!event) notFound();
  const photos = await prisma.photo.findMany({
    where: { eventId: event.id, status: 'READY', removedAt: null,
      variants: { some: { kind: 'PREVIEW', watermarkVersion: event.watermarkVersion } } },
    orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, fileName: true, photographer: { select: { name: true } } }
  });
  return <GalleryClient title={event.title} photos={photos.map(p => ({ id: p.id, name: p.fileName, photographer: p.photographer?.name || 'Tim Dokumentasi' }))} />;
}
