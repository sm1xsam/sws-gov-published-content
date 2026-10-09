export type ArticleStatus = 'draft' | 'published' | 'archived';
export type ArticleSection = 'general' | 'news' | 'press-office' | 'daily-note';

export type ArticleTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: string;
};

export type ArticleBlock =
  | { type: 'paragraph'; runs: ArticleTextRun[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; runs: ArticleTextRun[] }
  | { type: 'list-item'; ordered: boolean; level: number; runs: ArticleTextRun[] }
  | { type: 'quote'; runs: ArticleTextRun[] }
  | { type: 'rule' }
  | { type: 'table'; rows: string[][] }
  | { type: 'image'; assetId: string; alt: string; caption?: string; width?: number; height?: number }
  | { type: 'html-embed'; html: string; caption?: string; sourceUrl?: string }
  | { type: 'legacy-markdown'; markdown: string };

export type ArticleAsset = {
  id: string;
  sourceUrl?: string;
  pathname?: string;
  contentType?: string;
};

export type Article = {
  id: string;
  source: 'google-docs' | 'craft' | 'notion';
  sourceId: string;
  sourceRevision?: string;
  title: string;
  nativeTitle?: string;
  slug: string;
  standfirst: string;
  publishedAt: string;
  uploadedAt?: string;
  status: ArticleStatus;
  tags: string[];
  section: ArticleSection;
  blocks: ArticleBlock[];
  assets: ArticleAsset[];
  sourceUrl?: string;
  /** Optional Superfeed metadata; absence means automatic ranking. */
  superfeed?: {
    importance?: 'automatic' | 'breaking' | 'major' | 'standard' | 'minor';
    pinned?: boolean;
  };
};

export type ArticleValidationIssue = {
  code: string;
  message: string;
};

export type ArticleSyncError = {
  documentId: string;
  documentName: string;
  issues: ArticleValidationIssue[];
};

export type ArticleSnapshotIndex = {
  schemaVersion: 1;
  updatedAt: string;
  articles: Article[];
  errors: ArticleSyncError[];
};

export interface ArticleRepository {
  listPublished(): Promise<Article[]>;
  getBySlug(slug: string): Promise<Article | undefined>;
  getByTag(tag: string): Promise<Article[]>;
}
