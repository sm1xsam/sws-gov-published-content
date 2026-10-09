import type { ArticleBlock } from '../articles/types';

const HTML_EMBED_MAX_BYTES = 1024 * 1024;
const notionFileHosts = new Set([
  'prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com',
  'prod-files-secure.s3.amazonaws.com', 'file.notion.so', 'secure.notion-static.com',
]);

export function isHtmlEmbedUrl(value: string): boolean {
  try { return /\.html?$/i.test(decodeURIComponent(new URL(value).pathname)); }
  catch { return false; }
}

export async function resolveHtmlEmbeds(blocks: ArticleBlock[], load = fetchHtmlEmbed) {
  for (const block of blocks) {
    if (block.type !== 'html-embed' || !block.sourceUrl) continue;
    block.html = await load(block.sourceUrl);
    delete block.sourceUrl;
  }
}

/** Capture uploaded HTML during sync, before Notion's signed file URL expires. */
export async function fetchHtmlEmbed(url: string, request: typeof fetch = fetch): Promise<string> {
  let source = new URL(url);
  const signal = AbortSignal.timeout(30000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (source.protocol !== 'https:' || source.username || source.password || (source.port && source.port !== '443') || !notionFileHosts.has(source.hostname)) {
      throw new Error('HTML embed requires an uploaded Notion file on an approved HTTPS host');
    }
    const response = await request(source.href, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('HTML embed redirect is missing its destination');
      source = new URL(location, source);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTML embed retrieval failed (${response.status})`); }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    // Uploaded files can be served as generic binary downloads.
    if (!['text/html', 'application/xhtml+xml', 'application/octet-stream'].includes(contentType || '')) {
      await response.body?.cancel();
      throw new Error('HTML embed file has an unsupported content type');
    }
    if (Number(response.headers.get('content-length')) > HTML_EMBED_MAX_BYTES) {
      await response.body?.cancel(); throw new Error('HTML embed exceeds 1 MB');
    }
    if (!response.body) throw new Error('HTML embed file is empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > HTML_EMBED_MAX_BYTES) throw new Error('HTML embed exceeds 1 MB');
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const html = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    if (!html.trim()) throw new Error('HTML embed file is empty');
    return html;
  }
  throw new Error('HTML embed exceeded the redirect limit');
}
