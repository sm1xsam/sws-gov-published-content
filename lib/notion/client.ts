/** Server-side only: never import this module from a client component. */
export class NotionApiError extends Error {
  constructor(public status: number, public code: string, public retryAfterMs?: number) { super(`Notion request failed (${status}, ${code})`); }
}
export function createNotionClient(options: {
  token: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; intervalMs?: number; timeoutMs?: number; maxAttempts?: number;
}) {
  const transport = options.fetch || fetch;
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 6;
  let queue: Promise<unknown> = Promise.resolve();
  async function perform<T>(path: string, method: string, body?: unknown, readOnly = false): Promise<T> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await transport(`https://api.notion.com/v1${path}`, {
          method, headers: { Authorization: `Bearer ${options.token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
        });
      } catch (error) {
        if (!(method === 'GET' || readOnly) || attempt === maxAttempts - 1) throw error;
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (response.ok) return response.json() as Promise<T>;
      const data = await response.json().catch(() => ({ code: 'unknown' })) as { code?: string; additional_data?: { rate_limit_reason?: string } };
      const retryable = data.additional_data?.rate_limit_reason !== 'public_api_request_blocked' &&
        (response.status === 429 || response.status === 529 || ((method === 'GET' || readOnly) && [500, 502, 503, 504].includes(response.status)));
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      if (!retryable || attempt === maxAttempts - 1) throw new NotionApiError(response.status, data.code || 'unknown', Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : undefined);
      await sleep((Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : Math.min(30000, 1000 * 2 ** attempt)) + Math.random() * 250);
    }
    throw new Error('Notion retry limit reached');
  }
  return {
    request<T>(path: string, method = 'GET', body?: unknown, readOnly = false): Promise<T> {
      const result = queue.then(() => perform<T>(path, method, body, readOnly));
      queue = result.catch(() => undefined).then(() => sleep(options.intervalMs ?? 350));
      return result;
    },
  };
}
export type NotionClient = ReturnType<typeof createNotionClient>;
export function notionClient() {
  const token = process.env.NOTION_API_TOKEN?.trim();
  if (!token) throw new Error('NOTION_API_TOKEN is required for article synchronisation and publishing.');
  return createNotionClient({ token });
}
export function articlesDataSourceId() {
  const id = process.env.NOTION_ARTICLES_DATA_SOURCE_ID?.trim();
  if (!id) throw new Error('NOTION_ARTICLES_DATA_SOURCE_ID is required.');
  return id;
}
