import { resolve, sep } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from './env';

export function cachePath(relative: string): string {
  if (!relative || relative.includes('\\') || relative.startsWith('/') || relative.split('/').some(s => s === '..' || s === '.' || s === '')) {
    throw new Error('Unsafe cache path');
  }
  const full = resolve(config.cacheRoot, relative);
  if (!full.startsWith(config.cacheRoot + sep)) throw new Error('Cache path escapes root');
  return full;
}

export async function atomicWrite(relative: string, data: Buffer) {
  const path = cachePath(relative);
  await mkdir(resolve(path, '..'), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { mode: 0o640 });
    await rename(temp, path);
  } catch (e) {
    const { rm } = await import('node:fs/promises');
    await rm(temp, { force: true });
    throw e;
  }
  return path;
}
