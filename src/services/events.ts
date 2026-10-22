import { prisma } from '../lib/prisma';
import { immich } from '../lib/immich-adapter';

export async function ensureAlbum(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  if (event.immichAlbumId) {
    await immich.getAlbum(event.immichAlbumId); // fail if album was deleted manually
    return event.immichAlbumId;
  }

  // Deterministic name enables recovery if Immich created the album but the local DB write failed.
  const name = `[MG:${event.id}] ${event.title}`;
  const matches = (await immich.listAlbums(name)).filter(a => a.albumName === name);
  if (matches.length > 1) throw new Error('Multiple Immich albums with the same marker; resolve manually');
  const album = matches[0] ?? await immich.createAlbum(name);
  await prisma.event.update({ where: { id: event.id }, data: { immichAlbumId: album.id } });
  return album.id;
}
