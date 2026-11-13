import { SITE_DATA_ELEMENT_ID, parseGallery, migrate, type SiteData } from '@vernissage/schema';

export async function loadSiteData(): Promise<SiteData> {
  const el = document.getElementById(SITE_DATA_ELEMENT_ID);
  let raw: SiteData;
  if (el?.textContent?.trim()) raw = JSON.parse(el.textContent);
  else {
    // dev mode (or a host that strips inline data): fetch the side-car file
    const res = await fetch('site.json');
    if (!res.ok) throw new Error('No gallery data found (site.json missing). Build a project with the Vernissage generator first.');
    raw = await res.json();
  }
  // Data is validated by the generator; re-parse to apply defaults from newer viewers.
  const parsed = parseGallery(migrate(raw.gallery));
  if (!parsed.gallery) throw new Error('Invalid gallery data: ' + parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
  return { ...raw, gallery: parsed.gallery };
}

/** Works in visiting order: rooms, then walls N/E/S/W, then placement order; unhung works last. */
export function tourOrder(data: SiteData): string[] {
  const out: string[] = [];
  for (const r of data.gallery.rooms) for (const side of ['north', 'east', 'south', 'west'] as const) for (const p of r.walls[side].artworks) if (!out.includes(p.artwork)) out.push(p.artwork);
  for (const a of data.gallery.artworks) if (!out.includes(a.id)) out.push(a.id);
  return out;
}

export function roomOfArtwork(data: SiteData, id: string) {
  for (const r of data.gallery.rooms) for (const side of ['north', 'east', 'south', 'west'] as const) if (r.walls[side].artworks.some((p) => p.artwork === id)) return { room: r, side };
  return undefined;
}

export function formatDimensions(d?: { width: number; height: number; depth?: number }): string {
  if (!d) return '';
  const f = (n: number) => (Math.round(n * 10) / 10).toString();
  return `${f(d.height)} × ${f(d.width)}${d.depth ? ` × ${f(d.depth)}` : ''} cm`;
}
