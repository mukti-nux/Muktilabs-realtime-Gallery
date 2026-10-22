import { readFile } from 'node:fs/promises';
import { getPublicPhoto } from './public-access';
import { cachePath } from './files';

export async function serveVariant(id: string, kind: 'PREVIEW'|'THUMBNAIL', asDownload = false) {
  const photo = await getPublicPhoto(id);
  if (!photo) return new Response('Not found', { status: 404 });
  const variant = photo.variants.find(v => v.kind === kind && v.watermarkVersion === photo.event.watermarkVersion);
  if (!variant) return new Response('Preview processing', { status: 503, headers: { 'Retry-After': '5' } });
  try {
    const bytes = await readFile(cachePath(variant.path));
    const headers = new Headers({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    if (asDownload) headers.set('Content-Disposition', `attachment; filename="${id}-social.jpg"`);
    return new Response(new Uint8Array(bytes), { headers });
  } catch {
    return new Response('Variant missing', { status: 503 });
  }
}
