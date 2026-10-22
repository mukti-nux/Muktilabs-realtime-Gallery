import { getPublicPhoto } from '@/lib/public-access';
import { safeFilename } from '@/lib/http';
import { immich } from '@/lib/immich-adapter';
import { prisma } from '@/lib/prisma';
import { serveVariant } from '@/lib/serve-variant';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quality = new URL(request.url).searchParams.get('quality');
  if (quality !== 'original' && quality !== 'social') return Response.json({ error: 'Invalid quality' }, { status: 400 });
  const photo = await getPublicPhoto(id);
  if (!photo) return Response.json({ error: 'Not found' }, { status: 404 });
  try {
    if (quality === 'social') {
      const output = await serveVariant(id, 'PREVIEW', true);
      if (output.ok) await prisma.downloadLog.create({ data: { photoId: photo.id, quality: 'SOCIAL' } });
      return output;
    }
    // The browser receives no API key; the service account accesses Immich on the server.
    const upstream = await immich.getOriginal(photo.immichAssetId);
    if (!upstream.body) return new Response('Original unavailable', { status: 502 });
    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename(photo.fileName)}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    const length = upstream.headers.get('content-length');
    if (length && /^\d+$/.test(length)) headers.set('Content-Length', length);
    await prisma.downloadLog.create({ data: { photoId: photo.id, quality: 'ORIGINAL' } });
    return new Response(upstream.body, { headers });
  } catch (error) {
    console.error('Download failed', error);
    return Response.json({ error: 'Download temporarily unavailable' }, { status: 502 });
  }
}
