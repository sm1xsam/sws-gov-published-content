import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { normaliseArticleImage } from '../lib/notion/media';
import { readGitHubSnapshotForSync } from '../lib/notion/githubStorage';
import { synchroniseNotionArticles } from '../lib/notion/sync';
import type { NotionSnapshot } from '../lib/articles/notionSnapshot';

const snapshot: NotionSnapshot = {
  schemaVersion: 1, converterVersion: 2, provider: 'notion', dataSourceId: 'test-source',
  updatedAt: '2026-10-26T00:00:00.000Z', articles: [], slugLocks: {}, errors: [],
};

test('large GitHub snapshots use the exact immutable blob and reject corrupt generations', async t => {
  const large: NotionSnapshot = { ...snapshot, articles: [{
    id: 'notion:test', source: 'notion', sourceId: 'test', title: 'Test', slug: 'test', standfirst: 'Test summary',
    publishedAt: '2026-10-26', status: 'published', tags: [], section: 'news', assets: [],
    blocks: [{ type: 'paragraph', runs: [{ text: 'Large snapshot regression. '.repeat(50_000) }] }],
  }] };
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 1024 * 1024);
  const sha = 'a'.repeat(40);
  let body: unknown = large;
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    calls.push(String(url));
    return String(url).includes('/git/blobs/') ? Response.json(body) : Response.json({ sha, encoding: 'none', content: '' });
  });
  assert.deepEqual(await readGitHubSnapshotForSync(), { snapshot: large, etag: sha });
  assert.ok(calls[1].endsWith(`/git/blobs/${sha}`));
  body = { invalid: true };
  await assert.rejects(readGitHubSnapshotForSync());
});

test('a malformed article image aborts the sync without writing any public snapshot', async t => {
  const originalEnv = { ...process.env };
  Object.assign(process.env, { ARTICLES_STORAGE: 'github', NOTION_API_TOKEN: 'test', NOTION_ARTICLES_DATA_SOURCE_ID: 'test-source' });
  t.after(() => { process.env = originalEnv; });
  const text = (value: string) => [{ plain_text: value }];
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (init?.method === 'PUT') { writes++; throw Error('Must not save a failed generation'); }
    if (address.includes('/contents/')) return Response.json({ sha: 'a'.repeat(40), encoding: 'base64', content: Buffer.from(JSON.stringify(snapshot)).toString('base64') });
    if (address.includes('/query')) return Response.json({ has_more: false, results: [{ id: 'test', properties: {
      Title: { title: text('Test') }, Slug: { rich_text: text('test') }, Standfirst: { rich_text: text('Summary') },
      'Publish date': { date: { start: '2026-10-26' } }, Status: { select: { name: 'Published' } }, Section: { select: { name: 'News' } },
    } }] });
    return Response.json({ has_more: false, results: [{ id: 'image', type: 'image', image: { external: { url: 'file-upload://unfinished' } } }] });
  });
  await assert.rejects(synchroniseNotionArticles(), /no HTTPS asset/);
  assert.equal(writes, 0);
});

test('installed JPEG XL decoder converts a real encoded image end to end', { skip: process.env.REQUIRE_JXL_DECODER !== '1' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sws-jxl-test-'));
  try {
    const png = path.join(directory, 'source.png');
    const jxl = path.join(directory, 'source.jxl');
    await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64'));
    await promisify(execFile)('cjxl', [png, jxl, '--distance=0'], { timeout: 30_000 });
    const result = await normaliseArticleImage(await readFile(jxl), 'image/jxl');
    assert.equal(result.contentType, 'image/png');
    assert.equal(result.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await assert.rejects(normaliseArticleImage(Buffer.from('corrupt JXL'), 'image/jxl'), /JPEG XL decoding failed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
