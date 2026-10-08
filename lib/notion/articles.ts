import type { Article, ArticleBlock, ArticleTextRun } from '../articles/types';

export type NotionRichText = { plain_text?: string; text?: { content: string; link?: { url: string } | null }; href?: string | null; annotations?: { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; code?: boolean }; type?: string; equation?: { expression: string } };
export type NotionProperty = { title?: NotionRichText[]; rich_text?: NotionRichText[]; select?: { name: string } | null; status?: { name: string } | null; multi_select?: { name: string }[]; date?: { start: string } | null; checkbox?: boolean; url?: string | null };
export type NotionPage = { id: string; properties: Record<string, NotionProperty>; created_time?: string; last_edited_time?: string; url?: string; archived?: boolean; in_trash?: boolean; parent?: { data_source_id?: string } };
export type NotionBlock = { id: string; type: string; has_children?: boolean; children?: NotionBlock[]; [key: string]: unknown };
type BlockValue = { rich_text?: NotionRichText[]; caption?: NotionRichText[]; language?: string; url?: string; external?: { url: string }; file?: { url: string }; cells?: NotionRichText[][]; expression?: string; checked?: boolean };
export const richText = (runs: NotionRichText[] = []) => runs.map(run => run.plain_text ?? run.text?.content ?? run.equation?.expression ?? '').join('');
export function textRuns(runs: NotionRichText[] = []): ArticleTextRun[] {
  return runs.map(run => {
    if (run.type === 'equation') throw new Error('Inline equations need an explicit rendering conversion');
    return { text: run.plain_text ?? run.text?.content ?? '', ...run.annotations, link: run.href || run.text?.link?.url || undefined };
  });
}
const propertyText = (page: NotionPage, name: string) => richText(page.properties[name]?.rich_text);
const choice = (page: NotionPage, name: string) => page.properties[name]?.select?.name || page.properties[name]?.status?.name || '';
export const isPublishedNotionPage = (page: NotionPage) => !page.archived && !page.in_trash && choice(page, 'Status') === 'Published';
export function notionPageToArticle(page: NotionPage, body: NotionBlock[]): Article {
  const title = richText(page.properties.Title?.title).trim();
  const slug = propertyText(page, 'Slug').trim();
  const status = choice(page, 'Status');
  const section = choice(page, 'Section');
  const date = page.properties['Publish date']?.date?.start || '';
  if (!page.id || !title || !slug || /[\s/?#\\]/.test(slug) || slug === '.' || slug === '..') throw new Error('Article requires a title and stable URL-safe slug');
  if (!['Draft', 'Published', 'Archived'].includes(status)) throw new Error('Article status must be Draft, Published or Archived');
  if (!['News', 'Press Office'].includes(section)) throw new Error('Only News and Press Office belong in the Notion Articles CMS');
  if (status === 'Published' && (!date || !Number.isFinite(Date.parse(date)) || !propertyText(page, 'Standfirst').trim())) throw new Error('Published article requires a valid publish date and standfirst');
  const article: Article = {
    id: `notion:${page.id}`, source: 'notion', sourceId: propertyText(page, 'Source ID') || propertyText(page, 'Original Craft ID') || page.id,
    sourceRevision: page.last_edited_time, title, nativeTitle: propertyText(page, 'Native title') || undefined, slug,
    standfirst: propertyText(page, 'Standfirst'), publishedAt: date, uploadedAt: page.properties['Original created']?.date?.start || (propertyText(page, 'Original Craft ID') ? undefined : page.created_time),
    status: status.toLowerCase() as Article['status'], section: section === 'News' ? 'news' : 'press-office',
    tags: (page.properties.Tags?.multi_select || []).map(tag => tag.name.replace(/^(Glasgow|Homepage|Transport) \(capitalised\)$/, '$1')), blocks: [], assets: [], sourceUrl: page.properties['Source URL']?.url || undefined,
    superfeed: { importance: 'automatic', pinned: page.properties['Superfeed pinned']?.checkbox === true },
  };
  const importance = choice(page, 'Superfeed importance').toLowerCase();
  if (['automatic', 'breaking', 'major', 'standard', 'minor'].includes(importance)) article.superfeed!.importance = importance as NonNullable<Article['superfeed']>['importance'];
  else if (importance) throw new Error('Unknown Superfeed importance');
  const walk = (blocks: NotionBlock[], level = 0) => {
    for (const block of blocks) {
      const value = (block[block.type] || {}) as BlockValue;
      const runs = textRuns(value.rich_text);
      let converted: ArticleBlock | undefined;
      if (block.type === 'paragraph') converted = { type: 'paragraph', runs };
      else if (/^heading_[123]$/.test(block.type)) converted = { type: 'heading', level: Number(block.type.slice(-1)) === 1 ? 2 : Number(block.type.slice(-1)) as 2 | 3, runs };
      else if (block.type === 'quote' || block.type === 'callout') converted = { type: block.type === 'quote' ? 'quote' : 'paragraph', runs };
      else if (block.type === 'bulleted_list_item' || block.type === 'numbered_list_item' || block.type === 'to_do') converted = { type: 'list-item', ordered: block.type === 'numbered_list_item', level, runs: block.type === 'to_do' ? [{ text: value.checked ? '[x] ' : '[ ] ' }, ...runs] : runs };
      else if (block.type === 'divider') converted = { type: 'rule' };
      else if (block.type === 'image') {
        const url = value.external?.url || value.file?.url;
        if (!url || !/^https:\/\//.test(url)) throw new Error(`Image ${block.id} has no HTTPS asset`);
        const caption = richText(value.caption);
        const altMatch = caption.match(/\n\[SWS alt: ([\s\S]*)\]$/);
        article.assets.push({ id: block.id, sourceUrl: url });
        converted = { type: 'image', assetId: block.id, alt: altMatch?.[1] || caption || title, caption: altMatch ? caption.slice(0, altMatch.index) : caption || undefined };
      } else if (block.type === 'table') {
        if (!block.children) throw new Error(`Table ${block.id} children were not retrieved`);
        converted = { type: 'table', rows: block.children.map(row => ((row.table_row as BlockValue)?.cells || []).map(richText)) };
      } else if (block.type === 'code') {
        const code = richText(value.rich_text); const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1)));
        converted = { type: 'legacy-markdown', markdown: `${fence}${value.language || ''}\n${code}\n${fence}` };
      } else if (['toggle', 'column_list', 'column', 'synced_block'].includes(block.type)) {
        if (runs.length) converted = { type: 'paragraph', runs };
      } else if (['bookmark', 'link_preview', 'embed', 'video', 'audio', 'file', 'pdf'].includes(block.type)) {
        const url = value.url || value.external?.url || value.file?.url;
        if (!url) throw new Error(`Missing URL for ${block.type}`);
        converted = { type: 'paragraph', runs: [{ text: richText(value.caption) || url, link: url }] };
      } else throw new Error(`Unsupported Notion block ${block.type} (${block.id}); snapshot not replaced`);
      if (converted) article.blocks.push(converted);
      if (block.type !== 'table' && block.children) walk(block.children, block.type.includes('list_item') ? level + 1 : level);
      else if (block.has_children && !block.children) throw new Error(`Missing child blocks for ${block.id}`);
    }
  };
  walk(body);
  if (status === 'Published' && !article.blocks.some(block => block.type !== 'paragraph' || block.runs.some(run => run.text.trim()))) throw new Error('Published article requires body content');
  return article;
}
