import { describe, expect, it } from 'vitest';
import { parseGallery } from '@vernissage/schema';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { addFromAlbum, formatDay, galleryFromAlbum, listAlbum, parseAlbumPage, parsePhotoPage } from '../src/album';

// pages shaped like Google Photos' own, with made-up content
const block = (key: string, data: unknown) => `<script nonce="x">AF_initDataCallback({key: '${key}', hash: '1', data:${JSON.stringify(data)}, sideChannel: {}});</script>`;
const item = (id: string, w: number, h: number, extra: Record<string, unknown> = {}) =>
  [id, [`https://lh3.googleusercontent.com/pw/${id}`, w, h, null], 1768104891000, 'x', -18000000, 1, [], [], 2, { 15: 1, ...extra }];
const albumHtml = `<html>${block('ds:0', [])}<script>AF_initDataCallback({key: 'ds:9',  data:[7],errorHasStatus: true,});</script>${block('ds:1', [
  null,
  [item('A1', 3000, 4000), item('A2', 4000, 1400), item('V1', 1920, 1080, { 76647426: [1] })],
  '', ['ALBUM', 'Harbour Walk', [], null, [], ['u', '1', null, null, null, [], null, null, null, null, null, ['Ada Example', 1, null, 'Ada']]],
])}</html>`;
const photoHtml = `<html>${block('ds:1', [
  ['A1', ['https://lh3.googleusercontent.com/pw/A1', 3000, 4000, null, null, null, null, null, [3000, 4000, 1, null, ['ACME Optical', 'ACME X-1  ', null, 24, 2.8, 400, 0.004]]], 1, 'x', 0, 1, [], [], 2, null, { 396644657: ['Fog over the harbour'] }],
])}</html>`;

describe('Google Photos album pages', () => {
  it('lists the photos, skips videos, reads title and owner', () => {
    const a = parseAlbumPage(albumHtml, 'https://photos.google.com/share/ALBUM?key=KEY');
    expect(a).toMatchObject({ id: 'ALBUM', key: 'KEY', title: 'Harbour Walk', owner: 'Ada Example', truncated: false });
    expect(a.photos.map((p) => [p.id, p.width, p.height])).toEqual([['A1', 3000, 4000], ['A2', 4000, 1400]]);
    expect(a.photos[0].taken).toBe(1768104891000);
  });

  it('refuses pages that are not albums', () => {
    expect(() => parseAlbumPage('<html>Sign in</html>')).toThrow(/public Google Photos album/);
  });

  it('reads a caption and the camera settings', () => {
    expect(parsePhotoPage(photoHtml)).toEqual({ description: 'Fog over the harbour', camera: 'ACME X-1', settings: '24 mm, f/2.8, 1/250 s, ISO 400' });
    expect(parsePhotoPage('<html></html>')).toEqual({ description: undefined, camera: undefined, settings: undefined });
  });

  it("formats a day in the camera's time zone", () => {
    expect(formatDay(Date.UTC(2026, 0, 11, 3, 0), -5 * 36e5)).toBe('10 January 2026');
  });

  it('builds a valid gallery: file name as title, caption, camera data, a panorama on its own wall', () => {
    const album = parseAlbumPage(albumHtml, 'https://photos.google.com/share/ALBUM?key=KEY');
    const photos = album.photos.map((p, i) => ({ ...p, ...(i === 0 ? parsePhotoPage(photoHtml) : {}), fileName: `IMG_00${i}.JPG`, artId: `img-00${i}`, file: `assets/img-00${i}.jpg` }));
    const g = galleryFromAlbum(album, photos, 'https://photos.app.goo.gl/x', Date.UTC(2026, 10, 13));
    const parsed = parseGallery(g);
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const a = parsed.gallery!.artworks[0];
    expect(a).toMatchObject({ title: 'IMG_000', artist: { name: 'Ada Example' }, date: '10 January 2026', description: 'Fog over the harbour', medium: 'Digital photograph, ACME X-1' });
    expect(a.provenance[0]).toEqual({ date: '10 January 2026', event: 'Photographed with ACME X-1', note: '24 mm, f/2.8, 1/250 s, ISO 400' });
    expect(a.provenance[1].event).toContain('Harbour Walk');
    expect(parsed.gallery!.environment.landscape).toBe('toronto');
    const walls = parsed.gallery!.rooms.flatMap((r) => Object.values(r.walls));
    expect(walls.find((w) => w.artworks.some((p) => p.artwork === 'img-001'))!.artworks).toHaveLength(1);
  });
});

describe('adding to an existing gallery', () => {
  const link = 'https://photos.app.goo.gl/abc';
  const names: Record<string, string> = { A1: 'P1010001.JPG', A2: 'Harbour Pano.jpg' };
  /** a stand-in for Google Photos: the album page, photo pages, file names and images */
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input);
    if (u === link) { const r = new Response(albumHtml); Object.defineProperty(r, 'url', { value: 'https://photos.google.com/share/ALBUM?key=KEY' }); return r; }
    if (u.includes('/photo/')) return new Response(photoHtml);
    const id = /pw\/(\w+)=/.exec(u)![1];
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-disposition': `attachment; filename="${names[id]}"` } });
    const jpg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#789' } }).jpeg().toBuffer();
    return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;

  it('lists the album with the key each photo would have in a gallery', async () => {
    const { album, photos } = await listAlbum(link, { fetch: fakeFetch, thumbs: 64 });
    expect(album.title).toBe('Harbour Walk');
    expect(photos.map((p) => p.key)).toEqual(['p1010001', 'harbour-pano']);
    expect(photos[0].thumb).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('fetches only the chosen photos and never writes over what is there', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vernissage-album-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets/p1010001.jpg'), 'edited by hand');
    const r = await addFromAlbum(link, dir, ['A2'], ['p1010001'], { fetch: fakeFetch });
    expect(r.skipped).toEqual([]);
    expect(r.artworks).toHaveLength(1);
    expect(r.artworks[0]).toMatchObject({ id: 'harbour-pano', file: 'assets/harbour-pano.jpg', title: 'Harbour Pano', artist: { name: 'Ada Example' }, provenance: [], width: 40, height: 30 });
    expect((await readdir(join(dir, 'assets'))).sort()).toEqual(['harbour-pano.jpg', 'p1010001.jpg']);
    expect(await readFile(join(dir, 'assets/p1010001.jpg'), 'utf8')).toBe('edited by hand');
    // a photo whose name is taken gets a new id and its own file
    const again = await addFromAlbum(link, dir, ['A1'], ['p1010001', 'harbour-pano'], { fetch: fakeFetch });
    expect(again.artworks[0]).toMatchObject({ id: 'p1010001-2', file: 'assets/p1010001-2.jpg' });
    expect(await readFile(join(dir, 'assets/p1010001.jpg'), 'utf8')).toBe('edited by hand');
  });
});
