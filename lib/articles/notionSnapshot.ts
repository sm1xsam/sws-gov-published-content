import { isLegacyUndatedArticle } from './legacyUndated';
import { z } from 'zod';
import type { Article, ArticleRepository } from './types';
import { compareArticlesByRecency } from './sort';
const run = z.object({ text: z.string(), bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(), code: z.boolean().optional(), link: z.string().optional() });
const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), runs: z.array(run) }), z.object({ type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), runs: z.array(run) }),
  z.object({ type: z.literal('quote'), runs: z.array(run) }), z.object({ type: z.literal('list-item'), ordered: z.boolean(), level: z.number().int().nonnegative(), runs: z.array(run) }),
  z.object({ type: z.literal('rule') }), z.object({ type: z.literal('table'), rows: z.array(z.array(z.string())) }),
  z.object({ type: z.literal('image'), assetId: z.string(), alt: z.string(), caption: z.string().optional(), width: z.number().optional(), height: z.number().optional() }), z.object({ type: z.literal('legacy-markdown'), markdown: z.string() }),
]);
export const publishedArticleSchema = z.object({
  id: z.string().min(1), source: z.literal('notion'), sourceId: z.string().min(1), sourceRevision: z.string().optional(), title: z.string().min(1), nativeTitle: z.string().optional(),
  slug: z.string().min(1).refine(value => !/[\s/?#\\]/.test(value) && value !== '.' && value !== '..'), standfirst: z.string().min(1), publishedAt: z.string().refine(value => value === '' || Number.isFinite(Date.parse(value))),
  uploadedAt: z.string().optional(), status: z.literal('published'), tags: z.array(z.string()), section: z.enum(['news', 'press-office']), blocks: z.array(block).min(1),
  assets: z.array(z.object({ id: z.string(), sourceUrl: z.url().refine(url => /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(url) || /^https:\/\/github\.com\/sm1xsam\/sws-gov-published-content\/releases\/download\/article-media-v1\/[a-f0-9]{64}\.(jpg|png|webp|gif|avif|svg)$/.test(url)), contentType: z.string().optional(), pathname: z.string().optional() })), sourceUrl: z.string().optional(),
  superfeed: z.object({ importance: z.enum(['automatic', 'breaking', 'major', 'standard', 'minor']).optional(), pinned: z.boolean().optional() }).optional(),
}).superRefine((article, ctx) => { if (!article.publishedAt && !isLegacyUndatedArticle(article.slug, article.sourceId)) ctx.addIssue({ code: 'custom', message: 'Published article requires a publication date' }); for (const block of article.blocks) if (block.type === 'image' && !article.assets.some(asset => asset.id === block.assetId)) ctx.addIssue({ code: 'custom', message: `Image ${block.assetId} missing durable asset` }); });
export const notionSnapshotSchema = z.object({
  schemaVersion: z.literal(1), provider: z.literal('notion'), dataSourceId: z.string(), updatedAt: z.iso.datetime(),
  articles: z.array(publishedArticleSchema), slugLocks: z.record(z.string(), z.string()), errors: z.array(z.object({ pageId: z.string(), message: z.string() })),
}).superRefine((snapshot, ctx) => { if (new Set(snapshot.articles.map(article => article.slug)).size !== snapshot.articles.length) ctx.addIssue({ code: 'custom', message: 'Duplicate article slugs' }); });
export type NotionSnapshot = z.infer<typeof notionSnapshotSchema>;
export function createSnapshotRepository(read: () => Promise<NotionSnapshot>): ArticleRepository {
  return {
    async listPublished() { return [...(await read()).articles].sort(compareArticlesByRecency) as Article[]; },
    async getBySlug(slug) { return (await this.listPublished()).find(article => article.slug === slug); },
    async getByTag(tag) { return (await this.listPublished()).filter(article => article.tags.some(value => value.toLowerCase() === tag.toLowerCase())); },
  };
}

/** Persisted data is validated before use; outage fallback never calls the CMS. */
export function createResilientSnapshotReader(read: () => Promise<unknown>, bundled: unknown, warn: () => void = () => {}) {
  let lastGood: NotionSnapshot | undefined;
  return async () => {
    try { lastGood = notionSnapshotSchema.parse(await read()); return lastGood; }
    catch (error) {
      const fallback = lastGood || notionSnapshotSchema.safeParse(bundled).data;
      if (!fallback) throw error;
      warn(); return fallback;
    }
  };
}
