import { storeGitHubImage } from './githubStorage';
import { createHash } from 'node:crypto';
import { head, put, BlobNotFoundError } from '@vercel/blob';
import type { Article } from '../articles/types';
import { notionSnapshotSchema, type NotionSnapshot } from '../articles/notionSnapshot';
import { articlesDataSourceId, notionClient, type NotionClient } from './client';
import { isPublishedNotionPage, notionPageToArticle, type NotionPage, type NotionBlock } from './articles';

type List<T> = { results: T[]; has_more: boolean; next_cursor?: string | null };
export async function queryAllPages(client: NotionClient, dataSourceId: string, filter?: unknown) {
  const pages: NotionPage[] = []; let cursor: string | undefined;
  do { const result = await client.request<List<NotionPage>>(`/data_sources/${dataSourceId}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...(filter ? { filter } : {}) }, true);
    pages.push(...result.results); if (result.has_more && !result.next_cursor) throw new Error('Notion query missing pagination cursor'); cursor = result.has_more ? result.next_cursor! : undefined;
  } while (cursor); return pages;
}
export async function readPageBlocks(client: NotionClient, id: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = []; let cursor: string | undefined;
  do { const result = await client.request<List<NotionBlock>>(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    blocks.push(...result.results); if (result.has_more && !result.next_cursor) throw new Error('Notion blocks missing pagination cursor'); cursor = result.has_more ? result.next_cursor! : undefined;
  } while (cursor);
  for (const block of blocks) if (block.has_children) block.children = await readPageBlocks(client, block.id);
  return blocks;
}
export async function storeDurableImage(url: string): Promise<{ url: string; contentType: string }> {
  const source = new URL(url);
  if (source.protocol !== 'https:') throw new Error('Article image requires HTTPS');
  if (source.hostname.endsWith('.public.blob.vercel-storage.com') || /^https:\/\/github\.com\/sm1xsam\/sws-gov-published-content\/releases\/download\/article-media-v1\/[a-f0-9]{64}\.(jpg|png|webp|gif|avif|svg)$/.test(url)) return { url, contentType: 'image/*' };
  // Only download trusted CMS/provider hosts. Never fetch arbitrary internal URLs supplied in page content.
  const allowed = ['r.craft.do', 'images.unsplash.com', 'prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 'file.notion.so', 'secure.notion-static.com', 'prod-files-secure.s3.amazonaws.com'];
  if (!allowed.includes(source.hostname)) throw new Error(`Image host ${source.hostname} needs an explicit migration/storage policy`);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Image retrieval failed (${response.status})`);
  const contentType = response.headers.get('content-type')?.split(';')[0] || '';
  if (!contentType.startsWith('image/')) throw new Error('Article asset is not an image');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Image must be between 1 byte and 25 MB');
  if (process.env.ARTICLES_STORAGE !== 'blob') return storeGitHubImage(bytes, contentType);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' } as Record<string, string>)[contentType];
  if (!extension) throw new Error(`Unsupported article image MIME type ${contentType}`);
  const pathname = `articles/media/${hash}.${extension}`;
  const token = process.env.ARTICLES_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  try { const previous = await head(pathname, { token }); return { url: previous.url, contentType }; } catch (error) { if (!(error instanceof BlobNotFoundError)) throw error; }
  const stored = await put(pathname, bytes, { access: 'public', contentType, token, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000 });
  return { url: stored.url, contentType };
}
export async function buildNotionSnapshot(deps: {
  pages: NotionPage[]; previous?: NotionSnapshot; dataSourceId: string; now?: string;
  blocks: (id: string) => Promise<NotionBlock[]>; media: typeof storeDurableImage;
}): Promise<NotionSnapshot> {
  const articles: Article[] = []; const errors: NotionSnapshot['errors'] = [];
  const slugLocks = { ...deps.previous?.slugLocks };
  const old = new Map(deps.previous?.articles.map(article => [article.id, article]));
  for (const page of deps.pages) {
    if (!isPublishedNotionPage(page)) continue;
    const previous = old.get(`notion:${page.id}`);
    try {
      if (previous && page.last_edited_time && previous.sourceRevision === page.last_edited_time) { articles.push(previous); continue; }
      const article = notionPageToArticle(page, await deps.blocks(page.id));
      if (slugLocks[page.id] && slugLocks[page.id] !== article.slug) throw new Error(`Published slug is locked to ${slugLocks[page.id]}; restore it in Notion`);
      for (const asset of article.assets) { const media = await deps.media(asset.sourceUrl!); asset.sourceUrl = media.url; asset.contentType = media.contentType; }
      slugLocks[page.id] = article.slug; articles.push(article);
    } catch (error) {
      errors.push({ pageId: page.id, message: error instanceof Error ? error.message : 'Article conversion failed' });
      if (previous) articles.push(previous);
    }
  }
  return notionSnapshotSchema.parse({ schemaVersion: 1, provider: 'notion', dataSourceId: deps.dataSourceId, updatedAt: deps.now || new Date().toISOString(), articles, slugLocks, errors });
}
export async function synchroniseNotionArticles() {
  const storage = process.env.ARTICLES_STORAGE === 'blob' ? await import('./blobStorage') : await import('./githubStorage');
  const read = 'readGitHubSnapshotForSync' in storage ? storage.readGitHubSnapshotForSync : storage.readSnapshotForSync;
  const save = 'saveGitHubSnapshot' in storage ? storage.saveGitHubSnapshot : storage.saveSnapshot;
  const previous = await read(); const client = notionClient(); const dataSourceId = articlesDataSourceId();
  if (previous.snapshot && previous.snapshot.dataSourceId !== dataSourceId) throw new Error('Snapshot belongs to a different Notion data source');
  const pages = await queryAllPages(client, dataSourceId);
  const snapshot = await buildNotionSnapshot({ pages, previous: previous.snapshot, dataSourceId, blocks: id => readPageBlocks(client, id), media: storeDurableImage });
  // No partially valid generation can silently replace the public content set.
  if (snapshot.errors.length) throw new Error(`Article synchronisation failed: ${JSON.stringify(snapshot.errors)}`);
  await save(snapshot, previous.etag); return snapshot;
}
