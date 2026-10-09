import { storeGitHubImage } from './githubStorage';
import { createHash } from 'node:crypto';
import { head, put, BlobNotFoundError } from '@vercel/blob';
import type { Article } from '../articles/types';
import { notionSnapshotSchema, type NotionSnapshot } from '../articles/notionSnapshot';
import { articlesDataSourceId, notionClient } from './client';
import { isPublishedNotionPage, notionPageToArticle, type NotionPage, type NotionBlock } from './articles';
import { hasPendingArticleChanges, needsHtmlEmbedUpgrade } from './updates';
import { fetchArticleImage, normaliseArticleImage } from './media';
import { fetchHtmlEmbed, resolveHtmlEmbeds } from './htmlEmbeds';

import { queryAllPages, readPageBlocks } from './blocks';
export { queryAllPages, readPageBlocks } from './blocks';
export async function storeDurableImage(url: string): Promise<{ url: string; contentType: string }> {
  const source = new URL(url);
  if (source.protocol !== 'https:') throw new Error('Article image requires HTTPS');
  if (source.hostname.endsWith('.public.blob.vercel-storage.com') || /^https:\/\/github\.com\/sm1xsam\/sws-gov-published-content\/releases\/download\/article-media-v1\/[a-f0-9]{64}\.(jpg|png|webp|gif|avif|svg)$/.test(url)) return { url, contentType: 'image/*' };
  const response = await fetchArticleImage(url);
  if (!response.ok) throw new Error(`Image retrieval failed (${response.status})`);
  const sourceType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  if (!sourceType.startsWith('image/')) throw new Error('Article asset is not an image');
  const { bytes, contentType } = await normaliseArticleImage(Buffer.from(await response.arrayBuffer()), sourceType);
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
  htmlEmbed?: typeof fetchHtmlEmbed;
  force?: boolean;
}): Promise<NotionSnapshot> {
  const articles: Article[] = []; const errors: NotionSnapshot['errors'] = [];
  const slugLocks = { ...deps.previous?.slugLocks };
  const old = new Map(deps.previous?.articles.map(article => [article.id, article]));
  for (const page of deps.pages) {
    if (!isPublishedNotionPage(page)) continue;
    const previous = old.get(`notion:${page.id}`);
    try {
      // Notion revision times can have minute precision. Re-read pages edited near
      // the previous sync so a second edit in that minute cannot disappear forever.
      const revisionSettled = page.last_edited_time && deps.previous &&
        Date.parse(page.last_edited_time) < Date.parse(deps.previous.updatedAt) - 60_000;
      if (!deps.force && previous && revisionSettled && previous.sourceRevision === page.last_edited_time) { articles.push(previous); continue; }
      const article = notionPageToArticle(page, await deps.blocks(page.id));
      if (slugLocks[page.id] && slugLocks[page.id] !== article.slug) throw new Error(`Published slug is locked to ${slugLocks[page.id]}; restore it in Notion`);
      await resolveHtmlEmbeds(article.blocks, deps.htmlEmbed);
      for (const asset of article.assets) { const media = await deps.media(asset.sourceUrl!); asset.sourceUrl = media.url; asset.contentType = media.contentType; }
      slugLocks[page.id] = article.slug; articles.push(article);
    } catch (error) {
      errors.push({ pageId: page.id, message: error instanceof Error ? error.message : 'Article conversion failed' });
      if (previous) articles.push(previous);
    }
  }
  return notionSnapshotSchema.parse({ schemaVersion: 1, converterVersion: 2, provider: 'notion', dataSourceId: deps.dataSourceId, updatedAt: deps.now || new Date().toISOString(), articles, slugLocks, errors });
}
export async function synchroniseNotionArticles(options: { force?: boolean } = {}) {
  const storage = process.env.ARTICLES_STORAGE === 'blob' ? await import('./blobStorage') : await import('./githubStorage');
  const read = 'readGitHubSnapshotForSync' in storage ? storage.readGitHubSnapshotForSync : storage.readSnapshotForSync;
  const save = 'saveGitHubSnapshot' in storage ? storage.saveGitHubSnapshot : storage.saveSnapshot;
  const previous = await read(); const client = notionClient(); const dataSourceId = articlesDataSourceId();
  if (previous.snapshot && previous.snapshot.dataSourceId !== dataSourceId) throw new Error('Snapshot belongs to a different Notion data source');
  const pages = await queryAllPages(client, dataSourceId);
  // Frequent scheduled checks are metadata-only when there is nothing to publish.
  if (!options.force && previous.snapshot && !hasPendingArticleChanges(pages, previous.snapshot)) return previous.snapshot;
  const snapshot = await buildNotionSnapshot({ pages, previous: previous.snapshot, dataSourceId, blocks: id => readPageBlocks(client, id), media: storeDurableImage,
    force: options.force || Boolean(previous.snapshot && needsHtmlEmbedUpgrade(previous.snapshot)) });
  // No partially valid generation can silently replace the public content set.
  if (snapshot.errors.length) throw new Error(`Article synchronisation failed: ${JSON.stringify(snapshot.errors)}`);
  await save(snapshot, previous.etag); return snapshot;
}
