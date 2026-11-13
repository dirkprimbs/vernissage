/**
 * Turns the public-domain originals of the SVG demo into vector traces with VTracer.
 *
 *   cargo install vtracer
 *   npm run fetch-demos -- svg-masterpieces   # downloads originals into demos/svg-masterpieces/.originals
 *   npm run vectorise                         # writes demos/svg-masterpieces/assets/*.svg
 *   npm run vectorise -- starry-night         # one work
 *
 * Trace styles (set per work in sources.json, "trace"):
 *   posterised – full colour, reduced palette, smooth splines
 *   ink        – one-colour ink on paper (VTracer binary mode on a contrast-boosted greyscale)
 *   minimal    – very few colours and polygonal edges, a flat graphic interpretation
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const DEMO = join(import.meta.dirname, '..', 'demos', 'svg-masterpieces');
const TMP = join(DEMO, '.originals', 'tmp');

type Style = 'posterised' | 'ink' | 'minimal';

/**
 * Colour styles are quantised to a fixed palette with sharp first, then traced with VTracer at full colour precision,
 * so every palette colour becomes one clean layer.
 */
const STYLES: Record<Style, { px: number; colours?: number; args: string[]; prepare: (img: sharp.Sharp) => sharp.Sharp }> = {
  posterised: {
    px: 900,
    colours: 16,
    args: ['--colormode', 'color', '--mode', 'spline', '--color_precision', '8', '--gradient_step', '1', '--filter_speckle', '10', '--corner_threshold', '60', '--segment_length', '4', '--splice_threshold', '45', '--path_precision', '1'],
    prepare: (img) => img.median(3),
  },
  ink: {
    px: 1100,
    args: ['--colormode', 'bw', '--mode', 'spline', '--filter_speckle', '3', '--corner_threshold', '60', '--segment_length', '4', '--splice_threshold', '45', '--path_precision', '1'],
    prepare: (img) => img.greyscale().normalise({ lower: 2, upper: 98 }).threshold(105),
  },
  minimal: {
    px: 800,
    colours: 7,
    args: ['--colormode', 'color', '--mode', 'polygon', '--color_precision', '8', '--gradient_step', '1', '--filter_speckle', '12', '--corner_threshold', '90', '--path_precision', '1'],
    prepare: (img) => img.median(9),
  },
};

const INK = '#1e1a16';
const PAPER = '#f2ead8';

function finish(svg: string, title: string, style: Style, w: number, h: number): string {
  let out = svg.replace(/<\?xml[^>]*>\s*/, '').replace(/<!--[\s\S]*?-->\s*/g, '');
  // make it scalable: replace fixed width/height with a viewBox
  out = out.replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 viewBox="0 0 ${w} ${h}"`);
  if (!/viewBox=/.test(out)) out = out.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
  if (style === 'ink') {
    out = out.replace(/fill="#000000"/gi, `fill="${INK}"`).replace(/fill="#ffffff"/gi, `fill="${PAPER}"`);
    out = out.replace(/(<svg[^>]*>)/, `$1<rect width="${w}" height="${h}" fill="${PAPER}"/>`);
  }
  const meta = `<title>${title.replace(/[<&]/g, '')}</title><desc>Vector trace (${style}) of a public-domain original, generated with VTracer for the Vernissage demo.</desc>`;
  return out.replace(/(<svg[^>]*>)/, `$1${meta}`) + '\n';
}

async function trace(id: string, style: Style, title: string) {
  const src = join(DEMO, '.originals', `${id}.jpg`);
  if (!existsSync(src)) throw new Error(`missing original ${src} — run "npm run fetch-demos -- svg-masterpieces" first`);
  const s = STYLES[style];
  await mkdir(TMP, { recursive: true });
  const png = join(TMP, `${id}.png`);
  const prepared = await s.prepare(sharp(src).resize(s.px, s.px, { fit: 'inside' })).png().toBuffer();
  const resized = await sharp(prepared)
    .png(s.colours ? { palette: true, colours: s.colours, dither: 0 } : {})
    .toFile(png);
  const raw = join(TMP, `${id}.svg`);
  execFileSync('vtracer', ['--input', png, '--output', raw, ...s.args], { stdio: 'pipe' });
  const svg = finish(await readFile(raw, 'utf8'), title, style, resized.width, resized.height);
  const dest = join(DEMO, 'assets', `${id}.svg`);
  await writeFile(dest, svg);
  const kb = (await stat(dest)).size / 1024;
  console.log(`  ✓ ${id} (${style}, ${resized.width}×${resized.height}, ${kb.toFixed(0)} KB)${kb > 2048 ? '  ! large' : ''}`);
}

try { execFileSync('vtracer', ['--version'], { stdio: 'pipe' }); }
catch { console.error('vtracer not found. Install it with: cargo install vtracer'); process.exit(1); }

const sources: Array<{ id: string; trace: Style }> = JSON.parse(await readFile(join(DEMO, 'sources.json'), 'utf8'));
const gallery = JSON.parse(await readFile(join(DEMO, 'gallery.json'), 'utf8').catch(() => '{"artworks":[]}'));
const only = process.argv.slice(2);
await mkdir(join(DEMO, 'assets'), { recursive: true });
for (const s of sources) {
  if (only.length && !only.includes(s.id)) continue;
  const title = gallery.artworks.find((a: any) => a.file?.includes(s.id))?.title ?? s.id;
  try { await trace(s.id, s.trace, title); } catch (e) { console.error(`  ✗ ${s.id}: ${(e as Error).message}`); process.exitCode = 1; }
}
await rm(TMP, { recursive: true, force: true });
