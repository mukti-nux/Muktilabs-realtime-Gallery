import { serveVariant } from '@/lib/serve-variant';
export const runtime = 'nodejs';
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveVariant((await params).id, 'PREVIEW');
}
