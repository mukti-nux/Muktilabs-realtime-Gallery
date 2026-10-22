import { config } from './env';

type Version = { major: number; minor: number; patch: number };
export type ImmichAsset = {
  id: string;
  type?: string;
  originalFileName: string;
  width?: number | null;
  height?: number | null;
  fileCreatedAt?: string;
  fileModifiedAt?: string;
  exifInfo?: Record<string, unknown> | null;
};
type ImmichAlbum = { id: string; albumName: string; assetCount?: number };
type SearchPage = {
  assets: { items: ImmichAsset[]; nextCursor?: string | null; nextPage?: string | null };
};

export class ImmichHttpError extends Error {
  constructor(public readonly status: number, public readonly endpoint: string, message: string) {
    super(`Immich ${status} (${endpoint}): ${message.slice(0, 300)}`);
  }
}

export class ImmichAdapter {
  private readonly baseUrl: URL;
  private readonly key: string;
  private searchModeCache?: 'modern'|'legacy';

  constructor(url = config.immichUrl, key = config.immichApiKey) {
    this.baseUrl = new URL(url.replace(/\/+$/, '') + '/');
    this.key = key;
  }

  private url(endpoint: string) {
    const u = new URL(`api/${endpoint.replace(/^\/+/, '')}`, this.baseUrl);
    if (u.origin !== this.baseUrl.origin) throw new Error('Immich origin mismatch');
    return u;
  }

  private async request(endpoint: string, init: RequestInit = {}, redirects = 0): Promise<Response> {
    const url = this.url(endpoint);
    return this.requestUrl(url, init, redirects);
  }

  private async requestUrl(url: URL, init: RequestInit, redirects: number): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('x-api-key', this.key);
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
      cache: 'no-store',
      signal: init.signal ?? AbortSignal.timeout(5 * 60_000)
    });
    if ([301,302,303,307,308].includes(response.status) && redirects < 3) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without Location header');
      const next = new URL(location, url);
      if (next.origin !== this.baseUrl.origin) throw new Error('Refusing cross-origin Immich redirect');
      return this.requestUrl(next, init, redirects + 1);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown upstream error');
      throw new ImmichHttpError(response.status, url.pathname, body);
    }
    return response;
  }

  private async json<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(endpoint, init);
    return response.json() as Promise<T>;
  }

  private postJson<T>(endpoint: string, method: 'POST'|'PUT', body: unknown) {
    return this.json<T>(endpoint, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  async getVersion(): Promise<Version> { return this.json<Version>('server/version'); }

  async getSearchMode(): Promise<'modern'|'legacy'> {
    if (this.searchModeCache) return this.searchModeCache;
    const forced = config.searchMode;
    if (forced !== 'auto') return (this.searchModeCache = forced);
    const version = await this.getVersion();
    if (version.major !== 3) throw new Error(`Immich major ${version.major} unsupported; expected v3`);
    return (this.searchModeCache = version.minor >= 2 ? 'modern' : 'legacy');
  }

  createAlbum(albumName: string): Promise<ImmichAlbum> {
    return this.postJson<ImmichAlbum>('albums', 'POST', { albumName });
  }

  listAlbums(name?: string): Promise<ImmichAlbum[]> {
    return this.json<ImmichAlbum[]>(`albums${name ? `?name=${encodeURIComponent(name)}` : ''}`);
  }

  getAlbum(id: string): Promise<ImmichAlbum> { return this.json<ImmichAlbum>(`albums/${encodeURIComponent(id)}`); }

  async addAssetsToAlbum(albumId: string, assetIds: string[]) {
    if (!assetIds.length) return;
    const res = await this.postJson<{success: boolean; error?: string} | Array<{success: boolean; error?: string}>>('albums/assets', 'PUT', {
      albumIds: [albumId], assetIds
    });
    // Some versions return one result per association; fail closed if reported errors.
    if ((Array.isArray(res) && res.some(x => x.success === false)) || (!Array.isArray(res) && res.success === false)) {
      throw new Error(`Immich reported album-add failure: ${JSON.stringify(res).slice(0, 500)}`);
    }
  }

  getAsset(id: string): Promise<ImmichAsset> { return this.json<ImmichAsset>(`assets/${encodeURIComponent(id)}`); }
  getPreview(id: string): Promise<Response> { return this.request(`assets/${encodeURIComponent(id)}/thumbnail?size=preview`); }
  getOriginal(id: string): Promise<Response> { return this.request(`assets/${encodeURIComponent(id)}/original`); }

  async uploadPhoto(file: Blob, filename: string, createdAt = new Date()): Promise<{ id: string; status: 'created'|'duplicate' }> {
    const data = new FormData();
    data.set('assetData', file, filename);
    data.set('fileCreatedAt', createdAt.toISOString());
    data.set('fileModifiedAt', createdAt.toISOString());
    data.set('filename', filename);
    const response = await this.request('assets', { method: 'POST', body: data });
    return response.json() as Promise<{ id: string; status: 'created'|'duplicate' }>;
  }

  /**
   * v3.2+: cursor + filter, v3.0-3.1: page + albumIds.
   * Detect repeated page tokens and duplicate pages to avoid silent infinite loops.
   * No destructive cleanup should occur if this iterator fails.
   */
  async *albumAssets(albumId: string): AsyncGenerator<ImmichAsset, void, void> {
    const mode = await this.getSearchMode();
    const seenPages = new Set<string>();
    const seenIds = new Set<string>();
    let cursor: string | undefined;
    let page = 1;
    for (let requests = 0; requests < 5000; requests++) {
      const body = mode === 'modern'
        ? { size: 250, filter: { albumIds: { any: [albumId] } }, ...(cursor ? { cursor } : {}) }
        : { size: 250, page, albumIds: [albumId] };
      const res = await this.postJson<SearchPage>('search/metadata', 'POST', body);
      if (!res?.assets || !Array.isArray(res.assets.items)) throw new Error('Invalid Immich search response');
      const assets = res.assets.items;
      const signature = assets.map(x => x.id).join(',');
      if (assets.length && seenPages.has(signature)) throw new Error(`Immich repeated search page (${mode}); aborting safely`);
      seenPages.add(signature);
      for (const asset of assets) {
        if (seenIds.has(asset.id)) throw new Error(`Duplicate asset across Immich pagination: ${asset.id}`);
        seenIds.add(asset.id);
        yield asset;
      }
      if (mode === 'modern') {
        const next = res.assets.nextCursor;
        if (!next) return;
        if (next === cursor) throw new Error('Immich repeated cursor');
        cursor = next;
      } else {
        if (!res.assets.nextPage) return;
        const nextPage = Number(res.assets.nextPage);
        if (!Number.isInteger(nextPage) || nextPage <= page) throw new Error('Immich invalid/repeated nextPage');
        page = nextPage;
      }
    }
    throw new Error('Search safety limit exceeded');
  }
}

export const immich = new ImmichAdapter();

/** Read small thumbnail/preview with upper bound. Original downloads use streaming. */
export async function readImageResponse(response: Response, limit = 180 * 1024 * 1024): Promise<Buffer> {
  const known = Number(response.headers.get('content-length') || '0');
  if (known > limit) throw new Error('Immich image exceeds memory limit');
  if (!response.body) throw new Error('Empty Immich image response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) throw new Error('Immich image exceeds configured memory limit');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(x => Buffer.from(x)), received);
}
