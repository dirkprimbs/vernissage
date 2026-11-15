import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITE_DATA_ELEMENT_ID, WALL_SIDES, blockersOn, computeFloorPlan, hangWall, planIssues, migrate, parseGallery, pinAssetKey, publishedGallery, resolveStyle,
  type ArtAsset, type Gallery, type SiteData, type StyleDef, type ValidationIssue,
} from '@vernissage/schema';
import { copyVariant, processImage, writeIfChanged } from './images';

export { sanitizeSvg, processImage } from './images';
export { importAlbum, listAlbum, addFromAlbum, type ListedPhoto, parseAlbumPage, parsePhotoPage, galleryFromAlbum, formatDay, type Album, type AlbumPhoto, type ImportOptions } from './album';

export const GENERATOR = 'Vernissage 0.7.4';
const MARKER = '.vernissage-site';

export interface BuildOptions {
  /** prebuilt viewer (packages/viewer/dist); defaults to the copy next to this package */
  viewerDir?: string;
  /** overrides gallery.basePath */
  basePath?: string;
  /** allow writing into a non-empty folder that was not created by Vernissage */
  force?: boolean;
  onProgress?: (step: string, done: number, total: number) => void;
}

export interface BuildReport {
  outDir: string;
  artworks: number;
  rooms: number;
  processed: number;
  cached: number;
  /** files of the site this build wrote, and files of an earlier build it removed; everything else was left untouched */
  written: number;
  removed: number;
  issues: ValidationIssue[];
  bytes: number;
  durationMs: number;
}

export class BuildError extends Error {
  constructor(message: string, public issues: ValidationIssue[] = []) { super(message); }
}

export function defaultViewerDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.VERNISSAGE_VIEWER_DIR,
    join(here, '../../viewer/dist'), // workspace: packages/generator/{src,dist} → packages/viewer/dist
    join(here, '../viewer'), // packaged app resources
    join(here, 'viewer'),
  ].filter(Boolean) as string[];
  const hit = candidates.find((c) => existsSync(join(c, 'index.html')));
  if (!hit) throw new BuildError('Viewer bundle not found. Run "npm run build -w @vernissage/viewer" first.');
  return hit;
}

export async function loadProject(projectDir: string): Promise<{ gallery: Gallery; issues: ValidationIssue[] }> {
  const file = join(projectDir, 'gallery.json');
  if (!existsSync(file)) throw new BuildError(`No gallery.json in ${projectDir}`);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { throw new BuildError(`gallery.json is not valid JSON: ${(e as Error).message}`); }
  const res = parseGallery(migrate(raw));
  if (!res.ok || !res.gallery) throw new BuildError('The gallery configuration has errors', res.issues);
  // asset existence
  const missing = res.gallery.artworks.filter((a) => !existsSync(join(projectDir, a.file)));
  if (missing.length) throw new BuildError('Missing artwork files', missing.map((a) => ({ path: `artworks.${res.gallery!.artworks.indexOf(a)}.file`, message: `file not found: ${a.file}`, severity: 'error' as const })));
  const pins = res.gallery.rooms.flatMap((r, ri) => (r.pinboard?.items ?? []).flatMap((p, pi) => (p.kind === 'photo' && !existsSync(join(projectDir, p.file)) ? [{ path: `rooms.${ri}.pinboard.items.${pi}.file`, message: `file not found: ${p.file}`, severity: 'error' as const }] : [])));
  if (pins.length) throw new BuildError('Missing pinboard photos', pins);
  const plan = planIssues(res.gallery);
  if (plan.some((i) => i.severity === 'error')) throw new BuildError('Rooms run into each other', plan);
  return { gallery: res.gallery, issues: [...res.issues, ...plan] };
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await stat(join(e.parentPath, e.name))).size;
  }
  return total;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function headTags(g: Gallery, assets: Record<string, ArtAsset>, style: StyleDef): string {
  const desc = g.subtitle ?? `${g.artworks.length} works in ${g.rooms.length} rooms`;
  const first = g.artworks.find((a) => assets[a.id]);
  return [
    g.basePath && g.basePath !== './' ? `<base href="${esc(g.basePath)}">` : '',
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="theme-color" content="${style.ui.bg}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(g.title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    first ? `<meta property="og:image" content="${esc(assets[first.id].thumb)}">` : '',
    `<style>html,body{background:${style.ui.bg};color:${style.ui.fg}}</style>`,
  ].filter(Boolean).join('\n    ');
}

/** Extra layout warnings (works shrunk to fit, crowded walls) using real image sizes. */
function hangingIssues(g: Gallery, assets: Record<string, ArtAsset>): ValidationIssue[] {
  const style = resolveStyle(g.style.preset, g.style.overrides as Partial<StyleDef>);
  const plan = computeFloorPlan(g);
  const artworks = new Map(g.artworks.map((a) => [a.id, a]));
  const out: ValidationIssue[] = [];
  plan.rooms.forEach((pr) => {
    for (const side of WALL_SIDES) {
      const res = hangWall({
        wall: pr.room.walls[side], length: pr.walls[side].length, roomHeight: pr.room.height, doors: blockersOn(g, plan, pr.room.id, side),
        artworks, aspect: (id) => (assets[id] ? assets[id].width / assets[id].height : undefined), styleFrame: style.frame, ...g.display,
      });
      res.warnings.forEach((m) => out.push({ path: `rooms.${pr.index}.walls.${side}`, message: `${pr.room.name}, ${side} wall: ${m}`, severity: 'warning' }));
    }
  });
  return out;
}

export function renderIndexHtml(template: string, site: SiteData, style: StyleDef): string {
  const json = JSON.stringify(site).replace(/</g, '\\u003c');
  return template
    .replace(/<title>.*?<\/title>/, `<title>${esc(site.gallery.title)}</title>`)
    .replace('<!--VERNISSAGE:HEAD-->', headTags(site.gallery, site.assets, style))
    .replace('<!--VERNISSAGE:DATA-->', `<script type="application/json" id="${SITE_DATA_ELEMENT_ID}">${json}</script>`);
}

export async function buildSite(projectDir: string, outDir: string, opts: BuildOptions = {}): Promise<BuildReport> {
  const t0 = Date.now();
  projectDir = resolve(projectDir);
  outDir = resolve(outDir);
  const progress = opts.onProgress ?? (() => {});
  if (outDir === projectDir || projectDir.startsWith(outDir + '/')) throw new BuildError('The output folder must not contain the project folder.');

  progress('Validating', 0, 1);
  const { gallery, issues } = await loadProject(projectDir);
  if (opts.basePath !== undefined) gallery.basePath = opts.basePath;
  const viewerDir = opts.viewerDir ?? defaultViewerDir();

  // output folder safety
  if (existsSync(outDir)) {
    const entries = await readdir(outDir);
    if (entries.length && !entries.includes(MARKER) && !opts.force)
      throw new BuildError(`${outDir} is not empty and was not created by Vernissage. Choose an empty folder or pass --force.`);
  }
  await mkdir(join(outDir, 'art'), { recursive: true });
  await writeIfChanged(join(outDir, MARKER), `${GENERATOR}\n`);

  // images
  const cacheRoot = join(projectDir, '.cache', 'images');
  const assets: Record<string, ArtAsset> = {};
  let processed = 0, cached = 0, done = 0;
  /** every file this build puts into the site (relative paths): whatever else lies in art/ and app/ is from an earlier build and goes */
  const kept = new Set<string>();
  let written = 0;
  const put = async (cacheDir: string, name: string, rel: string) => { kept.add(rel); if (await copyVariant(cacheDir, name, join(outDir, rel))) written++; };
  const queue = [...gallery.artworks];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const { dir, info, cached: hit } = await processImage(join(projectDir, a.file), cacheRoot);
      hit ? cached++ : processed++;
      const dest = join(outDir, 'art', a.id);
      await mkdir(dest, { recursive: true });
      const ext = extname(info.full);
      await Promise.all([
        put(dir, info.thumb, `art/${a.id}/thumb.webp`),
        put(dir, info.texture, `art/${a.id}/texture.webp`),
        put(dir, info.full, `art/${a.id}/full${ext}`),
      ]);
      assets[a.id] = {
        thumb: `art/${a.id}/thumb.webp`, texture: `art/${a.id}/texture.webp`, full: `art/${a.id}/full${ext}`,
        kind: info.kind, width: info.width, height: info.height, color: info.color,
      };
      progress('Processing images', ++done, gallery.artworks.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // the photos on the rooms' pinboards: a texture for the board and the full picture for the close-up
  for (const room of gallery.rooms) for (const p of room.pinboard?.items ?? []) {
    if (p.kind !== 'photo') continue;
    const { dir, info, cached: hit } = await processImage(join(projectDir, p.file), cacheRoot);
    hit ? cached++ : processed++;
    const name = `pin-${room.id}-${p.id}`, dest = join(outDir, 'art', name);
    await mkdir(dest, { recursive: true });
    const ext = extname(info.full);
    await Promise.all([
      // an instant photo is small on the wall: the thumbnail is texture enough
      put(dir, info.thumb, `art/${name}/thumb.webp`),
      put(dir, info.full, `art/${name}/full${ext}`),
    ]);
    assets[pinAssetKey(room.id, p.id)] = { thumb: `art/${name}/thumb.webp`, texture: `art/${name}/thumb.webp`, full: `art/${name}/full${ext}`, kind: info.kind, width: info.width, height: info.height, color: info.color };
  }

  // viewer + data
  progress('Writing site', 0, 1);
  // the images were processed side by side and finished in any order: list them in the gallery's order, so the
  // same gallery always gives the same data
  const ordered: Record<string, ArtAsset> = {};
  for (const a of gallery.artworks) if (assets[a.id]) ordered[a.id] = assets[a.id];
  for (const k of Object.keys(assets)) ordered[k] ??= assets[k];
  const site: SiteData = { gallery: publishedGallery(gallery), assets: ordered, build: { generator: GENERATOR, builtAt: new Date().toISOString() } };
  // a build that changes nothing keeps the date of the build before it, so the site's files stay byte for byte the same
  try {
    const before = JSON.parse(await readFile(join(outDir, 'site.json'), 'utf8')) as SiteData;
    const same = (s: SiteData) => JSON.stringify({ ...s, build: { ...s.build, builtAt: '' } });
    if (same(before) === same(site)) site.build.builtAt = before.build.builtAt;
  } catch { /* no earlier build, or not one this version can read */ }
  const style = resolveStyle(gallery.style.preset, gallery.style.overrides as Partial<StyleDef>);
  // the viewer: only files whose content changed are written
  await mkdir(join(outDir, 'app'), { recursive: true });
  for (const e of await readdir(join(viewerDir, 'app'), { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const rel = join('app', relative(join(viewerDir, 'app'), join(e.parentPath, e.name))).split(sep).join('/');
    kept.add(rel);
    await mkdir(dirname(join(outDir, rel)), { recursive: true });
    if (await writeIfChanged(join(outDir, rel), await readFile(join(e.parentPath, e.name)))) written++;
  }
  const template = await readFile(join(viewerDir, 'index.html'), 'utf8');
  if (await writeIfChanged(join(outDir, 'index.html'), renderIndexHtml(template, site, style))) written++;
  if (await writeIfChanged(join(outDir, 'site.json'), JSON.stringify(site))) written++;

  // what an earlier build left behind and this one no longer has: works taken out, a renamed id, old viewer files
  let removed = 0;
  for (const top of ['art', 'app']) {
    for (const e of await readdir(join(outDir, top), { withFileTypes: true, recursive: true })) {
      if (!e.isFile()) continue;
      const rel = relative(outDir, join(e.parentPath, e.name)).split(sep).join('/');
      if (!kept.has(rel)) { await rm(join(outDir, rel), { force: true }); removed++; }
    }
    // folders that are empty now, deepest first
    const dirs = (await readdir(join(outDir, top), { withFileTypes: true, recursive: true })).filter((e) => e.isDirectory()).map((e) => join(e.parentPath, e.name)).sort((a, b) => b.length - a.length);
    for (const d of dirs) if (!(await readdir(d)).length) await rm(d, { recursive: true, force: true });
  }

  const allIssues = [...issues, ...hangingIssues(gallery, assets)];
  // the report in the site names no folder on this computer and nothing that differs from run to run
  const summary = { artworks: gallery.artworks.length, rooms: gallery.rooms.length, issues: allIssues };
  if (await writeIfChanged(join(outDir, 'build-report.json'), JSON.stringify(summary, null, 2))) written++;
  const report: BuildReport = {
    outDir, ...summary, processed, cached, written, removed,
    bytes: await dirSize(outDir), durationMs: Date.now() - t0,
  };
  progress('Done', 1, 1);
  return report;
}
