import { describe, expect, it } from 'vitest';
import { parseGallery } from '@vernissage/schema';
import { formatDay, galleryFromAlbum, parseAlbumPage, parsePhotoPage } from '../src/album';

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
