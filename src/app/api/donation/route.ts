import { prisma } from '@/lib/prisma';
export const runtime = 'nodejs';
export async function GET() {
  const settings = await prisma.donationSettings.findUnique({ where: { id: 1 } });
  return Response.json({
    enabled: Boolean(settings?.enabled && settings.qrisPath),
    message: settings?.message || 'Donasi sepenuhnya sukarela.',
    qrisUrl: settings?.enabled && settings.qrisPath ? '/api/donation/qr' : null
  }, { headers: { 'Cache-Control': 'no-store' } });
}
