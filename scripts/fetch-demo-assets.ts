/**
 * Downloads the public-domain images used by the demo galleries.
 *
 *   npm run fetch-demos                 # all demos, skip files already present
 *   npm run fetch-demos -- davinci      # one demo
 *   npm run fetch-demos -- --force      # re-download
 *
 * Each demo has a sources.json listing Wikimedia Commons file titles (or Library of Congress image-server URLs).
 * Commons licence metadata is checked: anything not public domain / CC0 is refused. Results, with checksums,
 * resolved URLs and the licence seen at download time, go to sources.lock.json next to it.
 *
 * Wikimedia asks automated clients to identify themselves; set VERNISSAGE_UA to include your own contact
 * if you run this often.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const UA = process.env.VERNISSAGE_UA ?? 'Vernissage-demo-fetcher/0.1 (open-source static gallery generator)';
const MAX_PX = 2400;
const ROOT = join(import.meta.dirname, '..', 'demos');

export interface Source {
  id: string;
  /** Wikimedia Commons file title, e.g. "File:Foo.jpg" */
  commons?: string;
  /** direct image URL on tile.loc.gov (LoC's image server) */
  loc?: string;
  /** rights statement for non-Commons sources, as published by the holding institution */
  rights?: string;
  /** download into .originals/ (for vectorising) instead of assets/ */
  original?: boolean;
}

interface LockEntry { id: string; source: string; page?: string; licence: string; sha256: string; width: number; height: number; fetched: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, attempt = 0): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (res.status === 429 || res.status === 503 || (res.ok && res.headers.get('content-type')?.startsWith('text/html') && url.includes('api.php'))) {
    if (attempt >= 6) throw new Error(`rate limited by ${new URL(url).host}; try again later`);
    const wait = Number(res.headers.get('retry-after')) * 1000 || 15000 * (attempt + 1);
    console.log(`  … rate limited, waiting ${Math.round(wait / 1000)} s`);
    await sleep(wait);
    return get(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

async function commonsInfo(titles: string[]) {
  const out = new Map<string, { url: string; page: string; licence: string; width: number; height: number }>();
  for (let i = 0; i < titles.length; i += 20) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    const params = { action: 'query', format: 'json', formatversion: '2', titles: titles.slice(i, i + 20).join('|'), prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: String(MAX_PX), iiextmetadatafilter: 'LicenseShortName|License' };
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const text = await (await get(u.toString())).text();
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error(`Commons API: ${text.slice(0, 120)}`); }
    const norm = new Map<string, string>((data.query?.normalized ?? []).map((n: any) => [n.to, n.from]));
    for (const p of data.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      const asked = norm.get(p.title) ?? p.title;
      if (!ii) { console.warn(`  ✗ not found on Commons: ${asked}`); continue; }
      const licence = ii.extmetadata?.LicenseShortName?.value ?? ii.extmetadata?.License?.value ?? 'unknown';
      // prefer a server-side thumbnail when the original is larger than we need
      const big = Math.max(ii.width, ii.height) > MAX_PX;
      out.set(asked, { url: big ? ii.thumburl : ii.url, page: ii.descriptionurl, licence, width: ii.width, height: ii.height });
    }
    await sleep(1500);
  }
  return out;
}

function isPublicDomain(licence: string) {
  return /public domain|^pd\b|^pd-|cc0|no (known )?restrictions/i.test(licence);
}

async function fetchDemo(demo: string, force: boolean) {
  const dir = join(ROOT, demo);
  const srcFile = join(dir, 'sources.json');
  if (!existsSync(srcFile)) return;
  const sources: Source[] = JSON.parse(await readFile(srcFile, 'utf8'));
  const lockFile = join(dir, 'sources.lock.json');
  const lock: Record<string, LockEntry> = existsSync(lockFile) ? JSON.parse(await readFile(lockFile, 'utf8')) : {};
  const target = (s: Source) => join(dir, s.original ? '.originals' : 'assets', `${s.id}.jpg`);
  const todo = sources.filter((s) => force || !existsSync(target(s)));
  console.log(`${demo}: ${sources.length} sources, ${todo.length} to fetch`);
  if (!todo.length) return;
  await mkdir(join(dir, 'assets'), { recursive: true });
  await mkdir(join(dir, '.originals'), { recursive: true });

  const info = await commonsInfo(todo.filter((s) => s.commons).map((s) => s.commons!));
  let failed = 0;
  for (const s of todo) {
    try {
      let url: string, page: string | undefined, licence: string;
      if (s.commons) {
        const i = info.get(s.commons);
        if (!i) throw new Error(`no Commons record for ${s.commons}`);
        if (!isPublicDomain(i.licence)) throw new Error(`licence is "${i.licence}", not public domain — refusing`);
        ({ url, page, licence } = i);
      } else if (s.loc) {
        if (!/^https:\/\/tile\.loc\.gov\//.test(s.loc)) throw new Error('loc sources must point at tile.loc.gov');
        if (!s.rights) throw new Error('loc sources need a rights statement');
        url = s.loc; licence = s.rights;
      } else throw new Error('source needs "commons" or "loc"');
      const buf = Buffer.from(await (await get(url)).arrayBuffer());
      const img = sharp(buf, { limitInputPixels: 1e9 }).rotate();
      const jpg = await img.resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      await writeFile(target(s), jpg.data);
      lock[s.id] = {
        id: s.id, source: url.split('?')[0], page, licence,
        sha256: createHash('sha256').update(jpg.data).digest('hex'),
        width: jpg.info.width, height: jpg.info.height, fetched: new Date().toISOString().slice(0, 10),
      };
      console.log(`  ✓ ${s.id} (${jpg.info.width}×${jpg.info.height}, ${licence})`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${s.id}: ${(e as Error).message}`);
    }
    await sleep(1200);
  }
  const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(lockFile, JSON.stringify(sorted, null, 2) + '\n');
  if (failed) process.exitCode = 1;
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const demos = only.length ? only : (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
for (const d of demos) await fetchDemo(d, force);
