import test from 'node:test';
import assert from 'node:assert/strict';
import { ImmichAdapter } from '../src/lib/immich-adapter';

test('Immich v3.2 structured album filter + cursor pagination', async () => {
  process.env.IMMICH_SEARCH_MODE = 'modern';
  const fetchOriginal = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    bodies.push(body);
    const response = bodies.length === 1
      ? { assets: { items: [{id:'asset1',originalFileName:'one.jpg'}], nextCursor: 'cursor-1' } }
      : { assets: { items: [{id:'asset2',originalFileName:'two.jpg'}], nextCursor: null } };
    return new Response(JSON.stringify(response), {status:200,headers:{'content-type':'application/json'}});
  }) as typeof globalThis.fetch;
  try {
    const found: string[]=[];
    for await (const asset of new ImmichAdapter('http://immich.example:2283','fake').albumAssets('abc')) found.push(asset.id);
    assert.deepEqual(found, ['asset1','asset2']);
    assert.deepEqual(bodies[0].filter, {albumIds:{any:['abc']}});
    assert.equal(bodies[1].cursor,'cursor-1');
  } finally { globalThis.fetch=fetchOriginal; }
});

test('Immich repeated page fails closed', async () => {
  process.env.IMMICH_SEARCH_MODE = 'modern';
  const prev = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({assets:{items:[{id:'same',originalFileName:'a.jpg'}],nextCursor:'same'}}),{status:200})) as typeof fetch;
  try {
    const next = new ImmichAdapter('http://immich.example:2283','fake').albumAssets('abc');
    await next.next();
    await assert.rejects(async () => { for await (const _ of next) {} }, /repeated (search page|cursor)/);
  } finally { globalThis.fetch=prev; }
});
