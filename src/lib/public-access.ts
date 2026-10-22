import { EventStatus, PhotoStatus } from '@prisma/client';
import { prisma } from './prisma';

export async function getPublicPhoto(id: string) {
  const photo = await prisma.photo.findUnique({ where: { id }, include: { event: true, variants: true, photographer: true } });
  if (!photo || photo.event.status !== EventStatus.PUBLISHED || photo.status !== PhotoStatus.READY || photo.removedAt) return null;
  if (!photo.event.watermarkVersion || !photo.variants.some(v => v.kind === 'PREVIEW' && v.watermarkVersion === photo.event.watermarkVersion)) return null;
  return photo;
}
