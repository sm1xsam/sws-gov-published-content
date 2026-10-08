import type { Article } from './types';

export function compareArticlesByRecency(a: Article, b: Article) {
  return b.publishedAt.localeCompare(a.publishedAt)
    || (b.uploadedAt || '').localeCompare(a.uploadedAt || '')
    || b.sourceId.localeCompare(a.sourceId);
}
