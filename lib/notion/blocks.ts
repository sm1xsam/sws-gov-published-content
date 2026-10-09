import type { NotionClient } from './client';
import type { NotionPage, NotionBlock } from './articles';

type List<T> = { results: T[]; has_more: boolean; next_cursor?: string | null };
export async function queryAllPages(client: NotionClient, dataSourceId: string, filter?: unknown) {
  const pages: NotionPage[] = []; let cursor: string | undefined;
  do {
    const result = await client.request<List<NotionPage>>(`/data_sources/${dataSourceId}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...(filter ? { filter } : {}) }, true);
    pages.push(...result.results);
    if (result.has_more && !result.next_cursor) throw new Error('Notion query missing pagination cursor');
    cursor = result.has_more ? result.next_cursor! : undefined;
  } while (cursor);
  return pages;
}

export async function readPageBlocks(client: NotionClient, id: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = []; let cursor: string | undefined;
  do {
    const result = await client.request<List<NotionBlock>>(`/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    blocks.push(...result.results);
    if (result.has_more && !result.next_cursor) throw new Error('Notion blocks missing pagination cursor');
    cursor = result.has_more ? result.next_cursor! : undefined;
  } while (cursor);
  for (const block of blocks) if (block.has_children) block.children = await readPageBlocks(client, block.id);
  return blocks;
}
