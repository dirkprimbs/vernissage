import { describe, expect, it, beforeAll } from 'vitest';
import { cp, mkdtemp, readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildSite, loadProject, renderIndexHtml, sanitizeSvg, BuildError } from '../src';
import { resolveStyle, SITE_DATA_ELEMENT_ID } from '@vernissage/schema';

const root = resolve(import.meta.dirname, '../../..');
const viewerDir = join(root, 'packages/viewer/dist');
const sample = join(root, 'examples/sample');

async function tmp(prefix: string) { return mkdtemp(join(tmpdir(), `vernissage-${prefix}-`)); }

describe('sanitizeSvg', () => {
  it('removes scripts, handlers and javascript: links', () => {
    const s = sanitizeSvg('<svg onload="x()"><script>alert(1)</script><a href="javascript:evil()"><rect onclick=\'y()\'/></a><foreignObject><div/></foreignObject></svg>');
    expect(s).not.toMatch(/script|onload|onclick|javascript:|foreignObject/i);
    expect(s).toMatch(/<rect/);
  });
});

describe('renderIndexHtml', () => {
  it('inlines escaped data and head tags', () => {
    const html = renderIndexHtml('<title>x</title><!--VERNISSAGE:HEAD--><!--VERNISSAGE:DATA-->', {
      gallery: { title: 'A </script> B', basePath: './', artworks: [], rooms: [] } as any, assets: {}, build: { generator: 't', builtAt: '' },
    }, resolveStyle('white-cube'));
    expect(html).toContain(`id="${SITE_DATA_ELEMENT_ID}"`);
    expect(html).not.toContain('A </script> B"');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('<title>A &lt;/script&gt; B</title>');
  });
});

describe.skipIf(!existsSync(join(viewerDir, 'index.html')))('buildSite', () => {
  let project: string;
  beforeAll(async () => { project = await tmp('proj'); await cp(sample, project, { recursive: true, filter: (s) => !s.includes('.cache') }); });

  it('writes a complete static site and reuses the cache', async () => {
    const out = join(await tmp('out'), 'site');
    const r1 = await buildSite(project, out, { viewerDir });
    expect(r1.processed).toBe(5);
    const files = (await readdir(out, { recursive: true })).map(String).sort();
    expect(files).toEqual(expect.arrayContaining(['index.html', 'site.json', 'app/viewer.js', 'art/circles/full.svg', 'art/circles/texture.webp', 'art/dusk/full.jpg', 'art/sun/full.png', 'art/sun/thumb.webp']));
    const html = await readFile(join(out, 'index.html'), 'utf8');
    expect(html).toContain('<title>Sample Gallery</title>');
    const data = JSON.parse(html.match(/<script type="application\/json" id="vernissage-data">([\s\S]*?)<\/script>/)![1]);
    expect(data.assets.circles).toMatchObject({ kind: 'svg', width: 600, height: 800 });
    expect(data.assets.dusk).toMatchObject({ kind: 'raster', width: 1200, height: 900 });
    expect(await readFile(join(out, 'art/circles/full.svg'), 'utf8')).not.toMatch(/<script/);
    expect(r1.issues.some((i) => /no dimensions/.test(i.message))).toBe(true);

    const r2 = await buildSite(project, out, { viewerDir });
    expect(r2.cached).toBe(5);
    expect(r2.processed).toBe(0);
  });

  it('a rebuild writes only what changed and keeps the other files as they were', async () => {
    const proj = await tmp('proj2');
    await cp(sample, proj, { recursive: true, filter: (s) => !s.includes('.cache') });
    const out = join(await tmp('out'), 'site');
    const first = await buildSite(proj, out, { viewerDir });
    expect(first.written).toBeGreaterThan(10);
    const list = async () => (await readdir(out, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort();
    const stamps = async () => Object.fromEntries(await Promise.all((await list()).map(async (f) => [f, (await stat(f)).mtimeMs] as const)));
    const before = await stamps();
    await new Promise((r) => setTimeout(r, 30));
    // nothing changed: nothing is written, not even the build date
    const again = await buildSite(proj, out, { viewerDir });
    expect(again).toMatchObject({ written: 0, removed: 0 });
    expect(await stamps()).toEqual(before);
    // the report in the site does not name a folder on this computer
    expect(await readFile(join(out, 'build-report.json'), 'utf8')).not.toContain(out);

    // a new title: the two pages that carry it are written, every image stays
    const file = join(proj, 'gallery.json');
    const g = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...g, title: 'Renamed' }));
    const renamed = await buildSite(proj, out, { viewerDir });
    expect(renamed.written).toBe(2);
    const after = await stamps();
    for (const f of Object.keys(before)) if (/[\\/]art[\\/]|[\\/]app[\\/]/.test(f)) expect(after[f]).toBe(before[f]);

    // a work taken out: its files go, the others stay
    const less = { ...g, artworks: g.artworks.slice(1), rooms: g.rooms.map((r: any) => ({ ...r, walls: Object.fromEntries(Object.entries(r.walls ?? {}).map(([k, w]: [string, any]) => [k, { ...w, artworks: (w.artworks ?? []).filter((p: any) => p.artwork !== g.artworks[0].id) }])) })) };
    await writeFile(file, JSON.stringify(less));
    const smaller = await buildSite(proj, out, { viewerDir });
    expect(smaller.removed).toBe(3);
    expect(existsSync(join(out, 'art', g.artworks[0].id))).toBe(false);
    expect(existsSync(join(out, 'art', g.artworks[1].id, 'thumb.webp'))).toBe(true);

    // a site folder emptied by hand comes back with the same dates, so an upload still skips the images
    const { rm } = await import('node:fs/promises');
    await rm(join(out, 'art'), { recursive: true });
    await buildSite(proj, out, { viewerDir });
    const rebuilt = await stamps();
    const img = Object.keys(rebuilt).find((f) => f.endsWith('texture.webp'))!;
    expect(rebuilt[img]).toBe(before[img]);
  });

  it('refuses to overwrite a foreign non-empty folder unless forced', async () => {
    const out = await tmp('foreign');
    await writeFile(join(out, 'important.txt'), 'keep me');
    await expect(buildSite(project, out, { viewerDir })).rejects.toThrow(/not empty/);
    await buildSite(project, out, { viewerDir, force: true });
    expect(await readFile(join(out, 'important.txt'), 'utf8')).toBe('keep me');
  });

  it('reports missing files and invalid configs as BuildError with issues', async () => {
    const bad = await tmp('bad');
    await mkdir(join(bad, 'assets'));
    await writeFile(join(bad, 'gallery.json'), JSON.stringify({ title: 'x', artworks: [{ id: 'a', file: 'assets/nope.jpg', title: 'A', artist: { name: 'B' } }], rooms: [{ id: 'r', name: 'R' }] }));
    const err = await loadProject(bad).catch((e) => e);
    expect(err).toBeInstanceOf(BuildError);
    expect(err.issues[0].message).toMatch(/file not found/);
    await writeFile(join(bad, 'gallery.json'), JSON.stringify({ title: 'x', rooms: [] }));
    const err2 = await loadProject(bad).catch((e) => e);
    expect(err2.issues[0].path).toBe('rooms');
  });

  it('applies a base path override', async () => {
    const out = join(await tmp('base'), 'site');
    await buildSite(project, out, { viewerDir, basePath: '/gallery/' });
    expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('<base href="/gallery/">');
  });
});

describe.skipIf(!existsSync(join(viewerDir, 'index.html')))('demo projects', () => {
  for (const demo of ['davinci', 'loc-photographs', 'svg-masterpieces']) {
    it(`${demo} validates and all files exist`, async () => {
      const { gallery, issues } = await loadProject(join(root, 'demos', demo));
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(gallery.artworks.length).toBeGreaterThanOrEqual(10);
      expect(gallery.rooms.length).toBe(3);
      for (const a of gallery.artworks) expect(a.provenance.length, a.id).toBeGreaterThan(0);
    });
  }
});
