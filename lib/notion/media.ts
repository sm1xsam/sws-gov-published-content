type Converter = (options: { buffer: Uint8Array; format: 'JPEG'; quality: number }) => Promise<ArrayBuffer | Uint8Array>;

const imageHosts = new Set(['r.craft.do', 'images.unsplash.com', 'prod-files-secure.s3.us-west-2.amazonaws.com', 's3.us-west-2.amazonaws.com', 'file.notion.so', 'secure.notion-static.com', 'prod-files-secure.s3.amazonaws.com', 'upload.wikimedia.org']);

/** Resolve Commons file redirects without allowing a redirect to an arbitrary host. */
export async function fetchArticleImage(url: string, request: typeof fetch = fetch): Promise<Response> {
  let source = new URL(url);
  const signal = AbortSignal.timeout(30000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (source.protocol !== 'https:' || source.username || source.password || (source.port && source.port !== '443')) throw new Error('Article image requires public HTTPS');
    const commonsFile = source.hostname === 'commons.wikimedia.org' && /^\/wiki\/Special:Redirect\/file\//i.test(source.pathname);
    if (!imageHosts.has(source.hostname) && !commonsFile) throw new Error(`Image host ${source.hostname} needs an explicit migration/storage policy`);
    const response = await request(source.href, { signal, redirect: 'manual', headers: { 'User-Agent': 'SWS.GOV-Publisher/1.0 (article image synchronisation)' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Article image redirect is missing its destination');
    source = new URL(location, source);
  }
  throw new Error('Article image exceeded the redirect limit');
}

/** Convert iPhone originals on the sync worker; the original remains in the Notion page. */
export async function normaliseArticleImage(bytes: Buffer, contentType: string, convert?: Converter): Promise<{ bytes: Buffer; contentType: string }> {
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Image must be between 1 byte and 25 MB');
  if (!['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].includes(contentType)) return { bytes, contentType };
  const converter = convert || (await import('heic-convert')).default;
  const output = await converter({ buffer: bytes, format: 'JPEG', quality: 0.95 });
  const converted = Buffer.from(output instanceof Uint8Array ? output : new Uint8Array(output));
  if (!converted.length || converted.length > 25 * 1024 * 1024 || converted[0] !== 0xff || converted[1] !== 0xd8) throw new Error('HEIC conversion did not produce a valid JPEG within the image size limit');
  return { bytes: converted, contentType: 'image/jpeg' };
}
