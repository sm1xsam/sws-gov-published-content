import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchArticleImage, normaliseArticleImage } from '../lib/notion/media';

test('Commons file redirects resolve to original Wikimedia image bytes', async () => {
  const seen: string[] = [];
  const response = await fetchArticleImage('https://commons.wikimedia.org/wiki/Special:Redirect/file/Example.jpg', async (url, options) => {
    seen.push(String(url)); assert.equal(options?.redirect, 'manual');
    return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg' } }) : new Response('original', { headers: { 'content-type': 'image/jpeg' } });
  });
  assert.equal(seen.length, 2); assert.equal(await response.text(), 'original');
});
test('image redirect destinations are validated before any request', async () => {
  let calls = 0;
  for (const destination of ['http://upload.wikimedia.org/image.jpg', 'https://127.0.0.1/private', 'https://evil.example/image.jpg', 'https://user:password@upload.wikimedia.org/image.jpg']) {
    calls = 0;
    await assert.rejects(fetchArticleImage('https://upload.wikimedia.org/image.jpg', async () => {
      calls++; return new Response(null, { status: 302, headers: { location: destination } });
    }), /HTTPS|storage policy/);
    assert.equal(calls, 1);
  }
  await assert.rejects(fetchArticleImage('https://commons.wikimedia.org/wiki/File:Example.jpg', async () => { throw Error('Must not fetch HTML pages'); }), /storage policy/);
});
test('broken redirects and redirect loops fail without discarding the article image', async () => {
  await assert.rejects(fetchArticleImage('https://upload.wikimedia.org/image.jpg', async () => new Response(null, { status: 302 })), /missing its destination/);
  let calls = 0;
  await assert.rejects(fetchArticleImage('https://upload.wikimedia.org/image.jpg', async () => { calls++; return new Response(null, { status: 302, headers: { location: '/image.jpg' } }); }), /redirect limit/);
  assert.equal(calls, 6);
});

test('web-compatible originals retain their exact bytes and media type', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff]);
  const result = await normaliseArticleImage(bytes, 'image/jpeg', async () => { throw Error('No conversion expected'); });
  assert.equal(result.bytes, bytes); assert.equal(result.contentType, 'image/jpeg');
});
test('HEIC and HEIF originals become high-quality durable JPEG bytes without altering article placement', async () => {
  const bytes = Buffer.from('original HEIC');
  for (const mime of ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']) {
    const result = await normaliseArticleImage(bytes, mime, async options => {
      assert.equal(options.buffer, bytes); assert.equal(options.format, 'JPEG'); assert.equal(options.quality, .95);
      return Uint8Array.from([0xff, 0xd8, 0xff, 1]);
    });
    assert.equal(result.contentType, 'image/jpeg'); assert.deepEqual(result.bytes, Buffer.from([0xff, 0xd8, 0xff, 1]));
  }
});
test('bad HEIC conversions and invalid asset sizes fail publishing instead of losing the image', async () => {
  await assert.rejects(normaliseArticleImage(Buffer.from('heic'), 'image/heic', async () => Buffer.from('invalid')), /valid JPEG/);
  await assert.rejects(normaliseArticleImage(Buffer.from('heic'), 'image/heic', async () => { throw Error('Corrupt original'); }), /Corrupt original/);
  await assert.rejects(normaliseArticleImage(Buffer.alloc(0), 'image/jpeg'), /25 MB/);
  await assert.rejects(normaliseArticleImage(Buffer.alloc(25 * 1024 * 1024 + 1), 'image/jpeg'), /25 MB/);
});

test('JPEG XL is decoded to PNG before durable storage', async () => {
  const original = Buffer.from('JXL original');
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const result = await normaliseArticleImage(original, 'image/jxl', undefined, async bytes => {
    assert.equal(bytes, original); return png;
  });
  assert.deepEqual(result, { bytes: png, contentType: 'image/png' });
});

test('invalid JPEG XL conversion and unknown formats block publication with actionable errors', async () => {
  await assert.rejects(normaliseArticleImage(Buffer.from('jxl'), 'image/jxl', undefined, async () => Buffer.from('invalid')), /valid PNG/);
  await assert.rejects(normaliseArticleImage(Buffer.from('jxl'), 'image/jxl', undefined, async () => Buffer.alloc(25 * 1024 * 1024 + 1)), /image size limit/);
  await assert.rejects(normaliseArticleImage(Buffer.from('jxl'), 'image/jxl', undefined, async () => { throw Error('Decoder failed'); }), /Decoder failed/);
  await assert.rejects(normaliseArticleImage(Buffer.from('image'), 'image/tiff'), /upload PNG/);
});
