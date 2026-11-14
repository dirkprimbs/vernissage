import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITE_DATA_ELEMENT_ID, WALL_SIDES, blockersOn, computeFloorPlan, hangWall, planIssues, migrate, parseGallery, publishedGallery, resolveStyle,
  type ArtAsset, type Gallery, type SiteData, type StyleDef, type ValidationIssue,
} from '@vernissage/schema';
import { copyVariant, processImage } from './images';

export { sanitizeSvg, processImage } from './images';
export { importAlbum, parseAlbumPage, parsePhotoPage, galleryFromAlbum, formatDay, type Album, type AlbumPhoto, type ImportOptions } from './album';

export const GENERATOR = 'Vernissage 0.4.0';
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
    for (const e of ['art', 'app', 'index.html', 'site.json', 'build-report.json']) await rm(join(outDir, e), { recursive: true, force: true });
  }
  await mkdir(join(outDir, 'art'), { recursive: true });
  await writeFile(join(outDir, MARKER), `${GENERATOR}\n`);

  // images
  const cacheRoot = join(projectDir, '.cache', 'images');
  const assets: Record<string, ArtAsset> = {};
  let processed = 0, cached = 0, done = 0;
  const queue = [...gallery.artworks];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const { dir, info, cached: hit } = await processImage(join(projectDir, a.file), cacheRoot);
      hit ? cached++ : processed++;
      const dest = join(outDir, 'art', a.id);
      await mkdir(dest, { recursive: true });
      const ext = extname(info.full);
      await Promise.all([
        copyVariant(dir, info.thumb, join(dest, 'thumb.webp')),
        copyVariant(dir, info.texture, join(dest, 'texture.webp')),
        copyVariant(dir, info.full, join(dest, `full${ext}`)),
      ]);
      assets[a.id] = {
        thumb: `art/${a.id}/thumb.webp`, texture: `art/${a.id}/texture.webp`, full: `art/${a.id}/full${ext}`,
        kind: info.kind, width: info.width, height: info.height, color: info.color,
      };
      progress('Processing images', ++done, gallery.artworks.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // viewer + data
  progress('Writing site', 0, 1);
  const site: SiteData = { gallery: publishedGallery(gallery), assets, build: { generator: GENERATOR, builtAt: new Date().toISOString() } };
  const style = resolveStyle(gallery.style.preset, gallery.style.overrides as Partial<StyleDef>);
  await cp(join(viewerDir, 'app'), join(outDir, 'app'), { recursive: true });
  const template = await readFile(join(viewerDir, 'index.html'), 'utf8');
  await writeFile(join(outDir, 'index.html'), renderIndexHtml(template, site, style));
  await writeFile(join(outDir, 'site.json'), JSON.stringify(site));

  const allIssues = [...issues, ...hangingIssues(gallery, assets)];
  const report: BuildReport = {
    outDir, artworks: gallery.artworks.length, rooms: gallery.rooms.length, processed, cached, issues: allIssues,
    bytes: await dirSize(outDir), durationMs: Date.now() - t0,
  };
  await writeFile(join(outDir, 'build-report.json'), JSON.stringify(report, null, 2));
  progress('Done', 1, 1);
  return report;
}
