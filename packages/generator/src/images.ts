import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, stat, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';

export const THUMB_PX = 720;
export const TEXTURE_PX = 2048;
export const FULL_PX = 4096;
/** bump to invalidate caches when processing changes */
const PIPELINE = 'v1';

export interface ProcessedImage {
  kind: 'raster' | 'svg';
  width: number;
  height: number;
  color: string;
  /** file names inside the cache dir */
  thumb: string;
  texture: string;
  full: string;
}

/** Remove scripts, event handlers and external references from an SVG so it is safe to serve. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
}

function svgSize(svg: string): { width: number; height: number } | undefined {
  const vb = svg.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/);
  if (vb) return { width: parseFloat(vb[3]), height: parseFloat(vb[4]) };
  const w = svg.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/), hh = svg.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/);
  if (w && hh) return { width: parseFloat(w[1]), height: parseFloat(hh[1]) };
  return undefined;
}

async function dominant(img: Sharp): Promise<string> {
  const { dominant: d } = await img.clone().stats();
  return '#' + [d.r, d.g, d.b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Produce thumb / texture / full variants for one source file, cached by content hash. */
export async function processImage(src: string, cacheRoot: string): Promise<{ dir: string; info: ProcessedImage; cached: boolean }> {
  const buf = await readFile(src);
  const isSvg = /\.svg$/i.test(src);
  const hash = createHash('sha256').update(PIPELINE).update(buf).digest('hex').slice(0, 20);
  const dir = join(cacheRoot, hash);
  const infoPath = join(dir, 'info.json');
  if (existsSync(infoPath)) return { dir, info: JSON.parse(await readFile(infoPath, 'utf8')), cached: true };
  await mkdir(dir, { recursive: true });

  let info: ProcessedImage;
  if (isSvg) {
    const text = sanitizeSvg(buf.toString('utf8'));
    const size = svgSize(text) ?? (await sharp(Buffer.from(text)).metadata());
    const width = size.width ?? 1000, height = size.height ?? 1000;
    // render at a density that yields ~TEXTURE_PX on the long side
    const density = Math.min(2400, Math.max(10, (72 * TEXTURE_PX) / Math.max(width, height)));
    const raster = sharp(Buffer.from(text), { density }).flatten({ background: '#ffffff' });
    await raster.clone().resize(TEXTURE_PX, TEXTURE_PX, { fit: 'inside' }).webp({ quality: 88 }).toFile(join(dir, 'texture.webp'));
    await raster.clone().resize(THUMB_PX, THUMB_PX, { fit: 'inside' }).webp({ quality: 82 }).toFile(join(dir, 'thumb.webp'));
    await writeFile(join(dir, 'full.svg'), text);
    info = { kind: 'svg', width, height, color: await dominant(raster), thumb: 'thumb.webp', texture: 'texture.webp', full: 'full.svg' };
  } else {
    const img = sharp(buf, { limitInputPixels: 1e9 }).rotate();
    const meta = await img.metadata();
    const oriented = (meta.orientation ?? 1) >= 5;
    const width = (oriented ? meta.height : meta.width) ?? 1, height = (oriented ? meta.width : meta.height) ?? 1;
    await img.clone().resize(TEXTURE_PX, TEXTURE_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toFile(join(dir, 'texture.webp'));
    await img.clone().resize(THUMB_PX, THUMB_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(dir, 'thumb.webp'));
    const large = Math.max(width, height) > FULL_PX;
    let full: string;
    if (!large && meta.format === 'jpeg') { full = 'full.jpg'; await writeFile(join(dir, full), buf); }
    else if (!large && meta.format === 'png' && buf.length < 12e6) { full = 'full.png'; await writeFile(join(dir, full), buf); }
    else { full = 'full.webp'; await img.clone().resize(FULL_PX, FULL_PX, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toFile(join(dir, full)); }
    info = { kind: 'raster', width, height, color: await dominant(img), thumb: 'thumb.webp', texture: 'texture.webp', full };
  }
  await writeFile(infoPath, JSON.stringify(info));
  return { dir, info, cached: false };
}

/**
 * Put a processed image into the site. The copy carries the cached file's modification time, and a file that is
 * already there with the same size and time is left alone: a rebuild then changes nothing on disk for images
 * that did not change, and an upload tool that compares size and time (rsync, lftp mirror) skips them.
 * Returns whether the file was written.
 */
export async function copyVariant(cacheDir: string, name: string, dest: string): Promise<boolean> {
  const s = join(cacheDir, name);
  const a = await stat(s);
  if (existsSync(dest)) {
    const b = await stat(dest);
    if (a.size === b.size && Math.abs(b.mtimeMs - a.mtimeMs) < 2) return false;
  }
  await copyFile(s, dest);
  await utimes(dest, a.atime, a.mtime);
  return true;
}

/** Write a file only if that changes its content, so an unchanged file keeps its modification time. */
export async function writeIfChanged(dest: string, content: string | Buffer): Promise<boolean> {
  const next = typeof content === 'string' ? Buffer.from(content) : content;
  if (existsSync(dest) && (await readFile(dest)).equals(next)) return false;
  await writeFile(dest, next);
  return true;
}
