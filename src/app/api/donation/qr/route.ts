import { prisma } from '@/lib/prisma';
import { cachePath } from '@/lib/files';
import { readFile } from 'node:fs/promises';
export const runtime = 'nodejs';
export async function GET() {
  const settings = await prisma.donationSettings.findUnique({ where: { id: 1 } });
  if (!settings?.enabled || !settings.qrisPath) return new Response('Not found', { status: 404 });
  try {
    const bytes = await readFile(cachePath(settings.qrisPath));
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}
