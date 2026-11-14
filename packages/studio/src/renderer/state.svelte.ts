import { starterRoom } from '@vernissage/schema';
import { parseGallery, planIssues, WALL_SIDES, type Gallery, type ValidationIssue, type WallSide } from '@vernissage/schema';
import { studio, type Meta, type ProjectInfo } from './api';

/**
 * The gallery without rows that are still being typed: menu links without a label or a full address, a
 * contact address that is not complete yet, and
 * provenance entries without an event. They stay in the editor but are not saved, checked or previewed.
 */
export function finished<T extends { menu?: Array<{ label?: string; url?: string }>; contact?: string; artworks?: Array<{ provenance?: Array<{ event?: string }> }> }>(g: T): T {
  return {
    ...g,
    menu: g.menu?.filter((l) => l.label?.trim() && /^https?:\/\/\S+\.\S+/.test(l.url ?? '')),
    contact: /^\S+@\S+\.\S+$/.test(g.contact?.trim() ?? '') ? g.contact!.trim() : undefined,
    artworks: g.artworks?.map((a) => ({ ...a, provenance: a.provenance?.filter((p) => p.event?.trim()) })),
  };
}

export type Pane = 'gallery' | 'plan' | 'walls' | 'library' | 'build';

class StudioState {
  dir = $state<string | null>(null);
  gallery = $state<Gallery | null>(null);
  saved = $state('');
  issues = $state<ValidationIssue[]>([]);
  outDir = $state('');
  basePath = $state('');
  meta = $state<Record<string, Meta>>({});
  pane = $state<Pane>('gallery');
  /** the wall picked in the preview, for the wall editor to show; `n` counts the picks */
  wallFocus = $state<{ side: 'north' | 'east' | 'south' | 'west'; n: number } | null>(null);
  /** the studio's own version */
  version = $state('');
  room = $state<string | null>(null);
  artwork = $state<string | null>(null);
  previewBase = $state('');
  previewUrl = $state('');
  previewRoom = $state<string | null>(null);
  previewKey = $state(0);
  /** ask the live preview to go to an artwork (n makes repeated requests distinct) */
  previewGoto = $state<{ id: string; n: number } | null>(null);
  message = $state<{ text: string; kind: 'info' | 'error' } | null>(null);

  get dirty() { return !!this.gallery && JSON.stringify(this.gallery) !== this.saved; }
  get errors() { return this.issues.filter((i) => i.severity === 'error'); }

  load(p: ProjectInfo) {
    this.dir = p.dir;
    this.gallery = p.gallery;
    this.saved = JSON.stringify(p.gallery);
    this.issues = p.issues;
    this.outDir = p.outDir ?? '';
    this.basePath = '';
    this.room = p.gallery.rooms[0]?.id ?? null;
    this.artwork = p.gallery.artworks[0]?.id ?? null;
    this.meta = {};
    this.refreshMeta();
  }

  async refreshMeta() {
    if (!this.gallery) return;
    const missing = this.gallery.artworks.map((a) => a.file).filter((f) => !this.meta[f]);
    if (!missing.length) return;
    const m = await studio.assetMeta(missing);
    this.meta = { ...this.meta, ...m };
  }

  validate() {
    if (!this.gallery) return;
    const r = parseGallery(finished($state.snapshot(this.gallery)));
    this.issues = r.gallery ? [...r.issues, ...planIssues(r.gallery)] : r.issues;
  }

  async save() {
    if (!this.gallery) return;
    const snap = $state.snapshot(this.gallery);
    await studio.save(finished(snap));
    this.saved = JSON.stringify(snap);
    this.notify('Saved');
  }

  notify(text: string, kind: 'info' | 'error' = 'info') {
    this.message = { text, kind };
    setTimeout(() => { if (this.message?.text === text) this.message = null; }, kind === 'error' ? 7000 : 2500);
  }

  thumb(file: string) { return `${this.previewBase}/preview/project/${file.split('/').map(encodeURIComponent).join('/')}`; }

  /** where an artwork currently hangs */
  placementOf(id: string): { roomId: string; side: WallSide } | undefined {
    for (const r of this.gallery?.rooms ?? []) for (const side of WALL_SIDES) if (r.walls[side].artworks.some((p) => p.artwork === id)) return { roomId: r.id, side };
    return undefined;
  }

  unhang(id: string) {
    for (const r of this.gallery?.rooms ?? []) for (const side of WALL_SIDES) {
      const w = r.walls[side];
      const i = w.artworks.findIndex((p) => p.artwork === id);
      if (i >= 0) w.artworks.splice(i, 1);
    }
  }

  hang(id: string, roomId: string, side: WallSide, index?: number) {
    this.unhang(id);
    const r = this.gallery?.rooms.find((x) => x.id === roomId);
    if (!r) return;
    const list = r.walls[side].artworks;
    list.splice(index ?? list.length, 0, { artwork: id });
  }
}

export const st = new StudioState();

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const clean = base.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  if (!set.has(clean)) return clean;
  for (let i = 2; ; i++) if (!set.has(`${clean}-${i}`)) return `${clean}-${i}`;
}

/** a new room like the first one: three walls for art and a windowed north wall */
export function newRoom(taken: string[], n: number) {
  return starterRoom(uniqueId(`room-${n}`, taken), `Room ${n}`);
}
