import { createHash } from 'node:crypto';
import { notionSnapshotSchema, type NotionSnapshot } from '../articles/notionSnapshot';
export const contentRepository = () => process.env.ARTICLES_GITHUB_REPOSITORY || 'sm1xsam/sws-gov-published-content';
export const mediaTag = 'article-media-v1';
export const githubHeaders = () => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(process.env.ARTICLES_GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.ARTICLES_GITHUB_TOKEN}` } : {}) });
export async function githubRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (method !== 'GET' && !process.env.ARTICLES_GITHUB_TOKEN) throw new Error('ARTICLES_GITHUB_TOKEN is required for content writes');
  const response = await fetch(`https://api.github.com/repos/${contentRepository()}${path}`, { method, headers: { ...githubHeaders(), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`GitHub content request failed (${response.status})`);
  return response.json() as Promise<T>;
}
export async function readGitHubSnapshotForSync(): Promise<{ snapshot?: NotionSnapshot; etag?: string }> {
  const response = await fetch(`https://api.github.com/repos/${contentRepository()}/contents/published.json`, { headers: githubHeaders(), cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`GitHub snapshot unavailable (${response.status})`);
  const data = await response.json() as { content: string; sha: string };
  return { snapshot: notionSnapshotSchema.parse(JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))), etag: data.sha };
}
export async function saveGitHubSnapshot(snapshot: NotionSnapshot, sha?: string) {
  const validated = notionSnapshotSchema.parse(snapshot);
  await githubRequest('/contents/published.json', 'PUT', { message: `Synchronise Notion articles ${validated.updatedAt}`, content: Buffer.from(JSON.stringify(validated)).toString('base64'), ...(sha ? { sha } : {}) });
}
export async function storeGitHubImage(bytes: Uint8Array, contentType: string) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const extension = ({ 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' } as Record<string, string>)[contentType];
  if (!extension) throw new Error(`Unsupported image MIME ${contentType}`);
  const name = `${hash}.${extension}`;
  const url = `https://github.com/${contentRepository()}/releases/download/${mediaTag}/${name}`;
  const release = await githubRequest<{ id: number; assets: { name: string }[] }>(`/releases/tags/${mediaTag}`);
  if (!release.assets.some(asset => asset.name === name)) {
    if (!process.env.ARTICLES_GITHUB_TOKEN) throw new Error('ARTICLES_GITHUB_TOKEN required for new article media');
    const response = await fetch(`https://uploads.github.com/repos/${contentRepository()}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...githubHeaders(), 'Content-Type': contentType }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`GitHub image upload failed (${response.status}); retry after checking the release`);
  }
  return { url, contentType };
}
