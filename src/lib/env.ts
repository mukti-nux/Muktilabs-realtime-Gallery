import 'dotenv/config';
import { resolve } from 'node:path';

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing env ${key}`);
  return value;
}
export const config = {
  get immichUrl() {
    // Fixed, trusted origin: never derived from browser parameters.
    const raw = required('IMMICH_URL').replace(/\/+$/, '');
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Invalid IMMICH_URL');
    return raw;
  },
  get immichApiKey() { return required('IMMICH_API_KEY'); },
  get redisUrl() { return required('REDIS_URL'); },
  get cacheRoot() { return resolve(process.env.GALLERY_CACHE_ROOT || './.gallery-cache'); },
  get searchMode(): 'auto'|'modern'|'legacy' {
    const v = process.env.IMMICH_SEARCH_MODE || 'auto';
    if (v !== 'auto' && v !== 'modern' && v !== 'legacy') throw new Error('Invalid IMMICH_SEARCH_MODE');
    return v;
  }
};
