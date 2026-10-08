import { articleContentVersion } from '../articles/version';
import type { NotionSnapshot } from '../articles/notionSnapshot';
import { isPublishedNotionPage, type NotionPage } from './articles';
import { NotionApiError } from './client';

export type ArticleUpdateCheck = { version: string; pending: boolean | null; published: number; updatedAt: string };

/** Metadata only. Also detects archiving, deletion and new published pages. */
export function hasPendingArticleChanges(pages: NotionPage[], snapshot: NotionSnapshot): boolean {
  const published = pages.filter(isPublishedNotionPage);
  if (published.length !== snapshot.articles.length) return true;
  const previous = new Map(snapshot.articles.map(article => [article.id, article.sourceRevision]));
  return published.some(page => !previous.has(`notion:${page.id}`) || !page.last_edited_time ||
    previous.get(`notion:${page.id}`) !== page.last_edited_time ||
    // Match the sync's minute-precision safeguard: never skip rapid second edits.
    Date.parse(page.last_edited_time) >= Date.parse(snapshot.updatedAt) - 60_000);
}

export function createArticleUpdateChecker(deps: {
  snapshot: () => Promise<NotionSnapshot>; pages: () => Promise<NotionPage[]>; now?: () => number;
}) {
  let metadata: Promise<NotionPage[] | null> | undefined;
  let checkedAt = -Infinity;
  let backoff = 10_000;
  let failed = false;
  return async (fresh = false): Promise<ArticleUpdateCheck> => {
    const now = (deps.now || Date.now)();
    // Coalesce clicks and back off after outages; the shared Next cache handles routine polling.
    if (!metadata || now - checkedAt >= backoff || (fresh && !failed && checkedAt !== Infinity)) {
      checkedAt = Infinity;
      metadata = Promise.resolve().then(deps.pages).then(pages => { failed = false; backoff = 10_000; return pages; }).catch(error => {
        failed = true; backoff = Math.max(60_000, error instanceof NotionApiError ? error.retryAfterMs || 0 : 0); return null;
      }).finally(() => { checkedAt = (deps.now || Date.now)(); });
    }
    const [snapshot, pages] = await Promise.all([deps.snapshot(), metadata]);
    return { version: await articleContentVersion(snapshot), pending: pages ? hasPendingArticleChanges(pages, snapshot) : null,
      published: snapshot.articles.length, updatedAt: snapshot.updatedAt };
  };
}
