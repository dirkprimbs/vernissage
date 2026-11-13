import { describe, expect, it, beforeAll } from 'vitest';
import { cp, mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
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
