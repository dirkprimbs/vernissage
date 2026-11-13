import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { SCHEMA_VERSION, parseGallery, suggestRooms, type GalleryInput } from '@vernissage/schema';

/**
 * Start a gallery from a public Google Photos album (a shared link, "photos.app.goo.gl/…" or
 * "photos.google.com/share/…"). Google has no API for public albums, so this reads the same pages a browser
 * would: the album page lists the photos, each photo's page has its caption and camera data, and the download
 * link names the original file. It only works for albums shared by link; nothing is sent but plain page requests.
 */

export interface AlbumPhoto {
  id: string;
  /** image base URL; a size suffix such as "=w2048-h2048" selects a rendition */
  url: string;
  width: number;
  height: number;
  /** when the photo was taken, ms since the epoch, and the camera's offset from UTC in ms */
  taken?: number;
  tz?: number;
}
export interface Album { id: string; key?: string; title: string; owner?: string; photos: AlbumPhoto[]; /** the page listed only the first part of a long album */ truncated: boolean }
export interface PhotoDetails { description?: string; camera?: string; settings?: string }

const UA = 'Mozilla/5.0 (X11; Linux x86_64) Vernissage';
const ALBUM_URL = /^https:\/\/(photos\.app\.goo\.gl\/[\w-]+|photos\.google\.com\/share\/[\w-]+(\?.*)?)$/;

/** the data blocks Google's pages carry, by key ("ds:1") */
function dataBlocks(html: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const block of html.matchAll(/AF_initDataCallback\(([^]*?)\);<\/script>/g)) {
    const key = /key: '([^']+)'/.exec(block[1])?.[1];
    const data = /data:([^]*), sideChannel: \{[^]*\}\s*\}$/.exec(block[1])?.[1];
    if (!key || !data) continue;
    try { out[key] = JSON.parse(data); } catch { /* not a data block we can read */ }
  }
  return out;
}
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
const num = (x: unknown): number | undefined => (typeof x === 'number' && isFinite(x) ? x : undefined);

/** Read the list of photos out of a shared album's page. */
export function parseAlbumPage(html: string, finalUrl = ''): Album {
  const data = arr(Object.values(dataBlocks(html)).find((d) => Array.isArray(d) && Array.isArray(d[1]) && Array.isArray(d[3])));
  if (!data.length) throw new Error('This does not look like a public Google Photos album. Check that the album is shared by link.');
  const meta = arr(data[3]);
  const photos: AlbumPhoto[] = [];
  for (const raw of arr(data[1])) {
    const it = arr(raw), img = arr(it[1]);
    const id = str(it[0]), url = str(img[0]), width = num(img[1]), height = num(img[2]);
    if (!id || !url || !width || !height) continue;
    // videos carry an extra block of stream data; a gallery hangs stills only
    const extra = it[it.length - 1];
    if (extra && typeof extra === 'object' && !Array.isArray(extra) && '76647426' in extra) continue;
    photos.push({ id, url, width, height, taken: num(it[2]), tz: num(it[4]) });
  }
  const owner = arr(arr(meta[5])[11])[0];
  const m = /share\/([\w-]+)(?:\?key=([\w-]+))?/.exec(finalUrl);
  return { id: m?.[1] ?? str(meta[0]) ?? '', key: m?.[2], title: str(meta[1]) ?? 'Album', owner: str(owner), photos, truncated: !!str(data[2]) };
}

/** Read a photo's caption and camera data out of its own page. */
export function parsePhotoPage(html: string): PhotoDetails {
  const data = arr(Object.values(dataBlocks(html)).find((d) => Array.isArray(d) && Array.isArray(d[0]) && Array.isArray((d[0] as unknown[])[1])));
  const it = arr(data[0]);
  let description: string | undefined;
  const extras = it[10];
  if (extras && typeof extras === 'object') for (const v of Object.values(extras)) { const s = str(arr(v)[0]); if (s) { description = s; break; } }
  const cam = arr(arr(arr(it[1])[8])[4]);
  const make = str(cam[0]), model = str(cam[1]);
  // many cameras repeat the maker in the model name
  const camera = model && make && !model.toLowerCase().includes(make.split(' ')[0].toLowerCase()) ? `${make} ${model}` : model ?? make;
  const focal = num(cam[3]), aperture = num(cam[4]), iso = num(cam[5]), exposure = num(cam[6]);
  const shutter = exposure ? (exposure >= 0.4 ? `${+exposure.toFixed(1)} s` : `1/${Math.round(1 / exposure)} s`) : undefined;
  const settings = [focal ? `${+focal.toFixed(1)} mm` : '', aperture ? `f/${+aperture.toFixed(1)}` : '', shutter ?? '', iso ? `ISO ${iso}` : ''].filter(Boolean).join(', ');
  return { description, camera, settings: settings || undefined };
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "10 January 2026", in the camera's own time zone */
export function formatDay(ms: number, tz = 0): string {
  const d = new Date(ms + tz);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export interface ImportedPhoto extends AlbumPhoto, PhotoDetails { fileName?: string }

/** Turn an album's photos into a gallery: artworks with their labels filled in, rooms suggested for their number and shapes. */
export function galleryFromAlbum(album: Album, photos: Array<ImportedPhoto & { artId: string; file: string }>, sourceUrl: string, today = Date.now()): GalleryInput {
  const artist = album.owner ?? 'Unknown photographer';
  const artworks = photos.map((p) => {
    const day = p.taken ? formatDay(p.taken, p.tz) : undefined;
    return {
      id: p.artId, file: p.file,
      title: p.fileName ? p.fileName.replace(/\.[a-z0-9]{2,5}$/i, '') : p.artId,
      artist: { name: artist },
      date: day,
      medium: ['Digital photograph', p.camera].filter(Boolean).join(', '),
      description: p.description,
      source: sourceUrl,
      mat: true,
      provenance: [
        ...(day || p.camera ? [{ date: day, event: p.camera ? `Photographed with ${p.camera}` : 'Photographed', note: p.settings }] : []),
        { date: formatDay(today), event: `Added from the Google Photos album “${album.title}”`, note: p.fileName ? `Original file: ${p.fileName}, ${p.width} × ${p.height} px` : `${p.width} × ${p.height} px` },
      ],
    };
  });
  const days = photos.map((p) => p.taken).filter((t): t is number => !!t).sort((a, b) => a - b);
  const years = days.length ? [...new Set([new Date(days[0]).getUTCFullYear(), new Date(days[days.length - 1]).getUTCFullYear()])].join('–') : '';
  return {
    schemaVersion: SCHEMA_VERSION,
    title: album.title,
    subtitle: [`${photos.length} photograph${photos.length === 1 ? '' : 's'}`, album.owner ? `by ${album.owner}` : '', years].filter(Boolean).join(' · '),
    style: { preset: 'industrial-loft', overrides: {} },
    lighting: { scenario: 'daylight', overrides: {}, allowVisitorChoice: true },
    focus: { defaultLayout: 'immersive' },
    environment: { landscape: 'toronto' },
    artworks,
    ...suggestRooms(photos.map((p) => ({ id: p.artId, aspect: p.width / p.height }))),
  } as GalleryInput;
}

export interface ImportOptions {
  /** longest side of the stored images in pixels */
  size?: number;
  onProgress?: (step: string, done: number, total: number) => void;
  fetch?: typeof fetch;
}

/** Download a public album into `projectDir` (assets/ and gallery.json) and return the gallery. */
export async function importAlbum(url: string, projectDir: string, opts: ImportOptions = {}): Promise<{ gallery: GalleryInput; album: Album; skipped: string[] }> {
  url = url.trim();
  if (!ALBUM_URL.test(url)) throw new Error('Paste the link of a shared Google Photos album (it starts with https://photos.app.goo.gl/ or https://photos.google.com/share/).');
  const get = opts.fetch ?? fetch;
  const size = opts.size ?? 4096;
  const headers = { 'user-agent': UA, 'accept-language': 'en' };
  opts.onProgress?.('Reading the album', 0, 1);
  const res = await get(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`Google Photos answered ${res.status} for this link.`);
  const album = parseAlbumPage(await res.text(), res.url);
  if (!album.photos.length) throw new Error('The album has no photos.');
  const assets = join(projectDir, 'assets');
  await mkdir(assets, { recursive: true });

  const out: Array<ImportedPhoto & { artId: string; file: string } | undefined> = [];
  const skipped: string[] = [];
  const taken = new Set<string>();
  let done = 0;
  const one = async (p: AlbumPhoto, i: number) => {
    try {
      let details: PhotoDetails = {};
      if (album.id) {
        const page = await get(`https://photos.google.com/share/${album.id}/photo/${p.id}${album.key ? `?key=${album.key}` : ''}`, { headers });
        if (page.ok) details = parsePhotoPage(await page.text());
      }
      // the download link names the original file; asking for its headers is enough
      let fileName: string | undefined;
      const head = await get(`${p.url}=d`, { method: 'HEAD', headers });
      const cd = head.headers.get('content-disposition') ?? '';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd), plain = /filename="?([^";]+)"?/i.exec(cd);
      if (star) { try { fileName = decodeURIComponent(star[1]); } catch { /* keep the plain one */ } }
      fileName ??= plain?.[1];
      const img = await get(`${p.url}=w${size}-h${size}`, { headers });
      if (!img.ok) throw new Error(`image ${img.status}`);
      let bytes: Buffer = Buffer.from(await img.arrayBuffer());
      const type = img.headers.get('content-type') ?? '';
      let ext = type.includes('png') ? '.png' : '.jpg';
      // anything that is not a JPEG or PNG (WebP, HEIC, GIF) is stored as a JPEG
      if (!/jpe?g|png/.test(type)) { bytes = await sharp(bytes).rotate().jpeg({ quality: 92 }).toBuffer(); ext = '.jpg'; }
      // very heavy renditions are re-compressed: a gallery wall does not need 15 MB per picture
      else if (ext === '.jpg' && bytes.length > 3.5e6) bytes = await sharp(bytes).rotate().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      const meta = await sharp(bytes).metadata();
      const turned = (meta.orientation ?? 1) >= 5;
      const base = slug(fileName ? fileName.replace(/\.[a-z0-9]{2,5}$/i, '') : `photo-${i + 1}`);
      let artId = base;
      for (let n = 2; taken.has(artId); n++) artId = `${base}-${n}`;
      taken.add(artId);
      await writeFile(join(assets, artId + ext), bytes);
      out[i] = {
        ...p, ...details, fileName, artId, file: `assets/${artId}${ext}`,
        width: (turned ? meta.height : meta.width) ?? p.width, height: (turned ? meta.width : meta.height) ?? p.height,
      };
    } catch (e) {
      skipped.push(`photo ${i + 1}: ${(e as Error).message}`);
    }
    opts.onProgress?.('Fetching photos', ++done, album.photos.length);
  };
  // a few at a time: polite to the server, and still quick
  const queue = album.photos.map((p, i) => [p, i] as const);
  await Promise.all(Array.from({ length: 3 }, async () => { for (let j = queue.shift(); j; j = queue.shift()) await one(j[0], j[1]); }));

  const photos = out.filter((p): p is NonNullable<typeof p> => !!p);
  if (!photos.length) throw new Error(`None of the album's photos could be fetched. ${skipped[0] ?? ''}`);
  if (album.truncated) skipped.push('the album is longer than its first page; only the first photos were imported');
  const gallery = galleryFromAlbum(album, photos, url);
  const parsed = parseGallery(gallery);
  if (!parsed.ok) throw new Error(`The imported gallery is not valid: ${parsed.issues.find((i) => i.severity === 'error')?.message}`);
  await writeFile(join(projectDir, 'gallery.json'), JSON.stringify(gallery, null, 2) + '\n');
  await writeFile(join(projectDir, '.gitignore'), '.cache/\n');
  return { gallery, album, skipped };
}
