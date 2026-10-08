type Converter = (options: { buffer: Uint8Array; format: 'JPEG'; quality: number }) => Promise<ArrayBuffer | Uint8Array>;

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
