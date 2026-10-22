import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { prisma } from '../lib/prisma';
import { atomicWrite } from '../lib/files';

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: npm run donation:set -- /path/qris.png');
  const bytes = await readFile(path);
  if (bytes.length > 5 * 1024 * 1024) throw new Error('QRIS max 5MB');
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) throw new Error('Invalid QRIS dimensions');
  const data = await sharp(bytes).rotate().png().toBuffer();
  const relative = `donation/qris-${Date.now()}.png`;
  await atomicWrite(relative, data);
  await prisma.donationSettings.upsert({
    where: { id: 1 }, create: { id: 1, enabled: true, qrisPath: relative },
    update: { enabled: true, qrisPath: relative }
  });
  console.log('QRIS updated on server. No application redeploy needed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
