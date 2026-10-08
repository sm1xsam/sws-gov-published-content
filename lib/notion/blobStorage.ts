import { BlobNotFoundError, head, put } from '@vercel/blob';
import { notionSnapshotSchema, type NotionSnapshot } from '../articles/notionSnapshot';
export const SNAPSHOT_PATH = 'articles/notion/published-v1.json';
function token() { return process.env.ARTICLES_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN; }
export async function readSnapshotForSync(): Promise<{ snapshot?: NotionSnapshot; etag?: string }> {
  try {
    const meta = await head(SNAPSHOT_PATH, { token: token() });
    const response = await fetch(meta.downloadUrl, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Article snapshot unavailable (${response.status})`);
    return { snapshot: notionSnapshotSchema.parse(await response.json()), etag: meta.etag };
  } catch (error) { if (error instanceof BlobNotFoundError) return {}; throw error; }
}
export async function saveSnapshot(snapshot: NotionSnapshot, etag?: string) {
  const validated = notionSnapshotSchema.parse(snapshot);
  if (!token()) throw new Error('Article synchronisation requires a Blob write token');
  // Immutable recovery generation first; compare-and-swap protects against concurrent refreshes.
  await put(`articles/notion/history/${validated.updatedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(validated), { access: 'public', addRandomSuffix: true, contentType: 'application/json', token: token() });
  await put(SNAPSHOT_PATH, JSON.stringify(validated), { access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: Boolean(etag), ifMatch: etag, cacheControlMaxAge: 60, token: token() });
}
