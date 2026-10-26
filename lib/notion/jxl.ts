/** Native decoder is installed and smoke-tested by the standalone publishing worker. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

export async function decodeJxlImage(bytes: Buffer): Promise<Buffer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sws-jxl-'));
  try {
    const input = path.join(directory, 'input.jxl');
    const output = path.join(directory, 'output.png');
    await writeFile(input, bytes);
    try {
      await promisify(execFile)('djxl', [input, output, '--num_threads=2'], { timeout: 60_000, maxBuffer: 64 * 1024 });
    } catch {
      throw new Error('JPEG XL decoding failed; ensure libjxl-tools is installed on the publishing worker, or upload a PNG/JPEG in Notion');
    }
    // djxl emits numbered files for animations; never silently publish one frame.
    if ((await readdir(directory)).some(name => /^output-/.test(name))) throw new Error('Animated JPEG XL requires conversion to GIF/WebP before publishing');
    if ((await stat(output)).size > 25 * 1024 * 1024) throw new Error('Decoded JPEG XL exceeds the 25 MB image limit');
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
