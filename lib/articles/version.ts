import type { NotionSnapshot } from './notionSnapshot';

/** Only editorial content changes count; a no-op sync must not notify readers. Edge compatible. */
export async function articleContentVersion(snapshot: NotionSnapshot): Promise<string> {
  const content = [...snapshot.articles].sort((a, b) => a.id.localeCompare(b.id)).map(article =>
    Object.fromEntries(Object.entries(article).filter(([key]) => key !== 'sourceRevision')));
  // Object key order is not editorial content and may change after schema validation.
  const canonical = JSON.stringify(content, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
