import { marked } from 'marked';
import type { FocusLayout, SiteData } from '@vernissage/schema';
import { h, clear, store } from '../dom';
import { formatDimensions, roomOfArtwork, tourOrder } from '../data';
import { icons } from './icons';

const LAYOUT_META: Record<FocusLayout, { label: string; icon: string }> = {
  'side-by-side': { label: 'Side by side', icon: icons.layoutSide },
  stacked: { label: 'Stacked', icon: icons.layoutStack },
  immersive: { label: 'Immersive', icon: icons.layoutImmersive },
  catalogue: { label: 'Catalogue', icon: icons.layoutCatalogue },
};

export interface FocusEvents {
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** only offered when the 3D gallery is available */
  onShowInGallery?: (id: string) => void;
}

/** Pan & zoom that resizes the image (rather than CSS-scaling it) so SVG stays vector-sharp. */
class Zoomer {
  scale = 1;
  tx = 0;
  ty = 0;
  private fitW = 0;
  private fitH = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private ro: ResizeObserver;

  constructor(private stage: HTMLElement, private img: HTMLImageElement, private aspect: number) {
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(stage);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    stage.addEventListener('dblclick', (e) => { this.scale > 1.05 ? this.reset() : this.zoomAt(e.clientX, e.clientY, 2.5); });
    stage.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      stage.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinch = this.dist();
    });
    stage.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const d = this.dist();
        const [a, b] = [...this.pointers.values()];
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch);
        this.pinch = d;
        return;
      }
      if (this.scale > 1) { this.tx += e.clientX - p.x; this.ty += e.clientY - p.y; this.apply(); }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const up = (e: PointerEvent) => this.pointers.delete(e.pointerId);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }

  private dist() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }

  fit() {
    const r = this.stage.getBoundingClientRect();
    const pad = 0.94;
    if (r.width / r.height > this.aspect) { this.fitH = r.height * pad; this.fitW = this.fitH * this.aspect; }
    else { this.fitW = r.width * pad; this.fitH = this.fitW / this.aspect; }
    this.apply();
  }

  reset() { this.scale = 1; this.tx = this.ty = 0; this.apply(); }

  zoomAt(cx: number, cy: number, f: number) {
    const r = this.stage.getBoundingClientRect();
    const ns = Math.min(12, Math.max(1, this.scale * f));
    const k = ns / this.scale;
    // keep the point under the cursor fixed
    const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2);
    this.tx = ox - (ox - this.tx) * k;
    this.ty = oy - (oy - this.ty) * k;
    this.scale = ns;
    if (ns === 1) this.tx = this.ty = 0;
    this.apply();
  }

  private apply() {
    const w = this.fitW * this.scale, hh = this.fitH * this.scale;
    const r = this.stage.getBoundingClientRect();
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (hh - r.height) / 2);
    this.tx = Math.min(mx, Math.max(-mx, this.tx));
    this.ty = Math.min(my, Math.max(-my, this.ty));
    this.img.style.width = `${w}px`;
    this.img.style.height = `${hh}px`;
    this.img.style.transform = `translate(-50%, -50%) translate(${this.tx}px, ${this.ty}px)`;
    this.stage.classList.toggle('zoomed', this.scale > 1.01);
  }

  dispose() { this.ro.disconnect(); }
}

export class FocusView {
  readonly el = h('div', { class: 'focus', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Artwork detail' });
  private order: string[];
  private layout: FocusLayout;
  private layoutPref: ReturnType<typeof store<FocusLayout>>;
  private zoomer?: Zoomer;
  private current?: string;
  private infoOpen = false;
  private keyHandler = (e: KeyboardEvent) => {
    if (!this.current) return;
    if (e.key === 'Escape') this.ev.onClose();
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key.toLowerCase() === 'i') this.toggleInfo();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  constructor(private data: SiteData, private ev: FocusEvents) {
    this.order = tourOrder(data);
    const f = data.gallery.focus;
    this.layoutPref = store<FocusLayout>(`vernissage:${data.gallery.title}:layout`, f.defaultLayout);
    const pref = this.layoutPref.get();
    this.layout = f.layouts.includes(pref) ? pref : f.defaultLayout;
    window.addEventListener('keydown', this.keyHandler, true);
  }

  get isOpen() { return !!this.current; }

  open(id: string) {
    const art = this.data.gallery.artworks.find((a) => a.id === id);
    if (!art) return false;
    this.current = id;
    this.render();
    document.body.classList.add('focus-open');
    this.el.classList.add('open');
    return true;
  }

  close() {
    this.current = undefined;
    this.zoomer?.dispose();
    this.el.classList.remove('open');
    document.body.classList.remove('focus-open');
  }

  private step(d: number) {
    if (!this.current) return;
    const i = this.order.indexOf(this.current);
    const next = this.order[(i + d + this.order.length) % this.order.length];
    this.ev.onNavigate(next);
  }

  private toggleInfo() { this.infoOpen = !this.infoOpen; this.el.classList.toggle('info-open', this.infoOpen); }

  private setLayout(l: FocusLayout) {
    this.layout = l;
    this.layoutPref.set(l);
    this.render();
  }

  private render() {
    const id = this.current!;
    const g = this.data.gallery;
    const art = g.artworks.find((a) => a.id === id)!;
    const asset = this.data.assets[id];
    const where = roomOfArtwork(this.data, id);
    const pos = this.order.indexOf(id) + 1;
    this.zoomer?.dispose();
    clear(this.el);
    this.el.className = `focus open layout-${this.layout}${this.infoOpen ? ' info-open' : ''}`;

    const btn = (label: string, icon: string, onclick: () => void, extra: Record<string, string | boolean> = {}) =>
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick: onclick as EventListener, ...extra, html: icon });

    const layouts = g.focus.layouts.length > 1
      ? h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' },
          g.focus.layouts.map((l) => btn(LAYOUT_META[l].label, LAYOUT_META[l].icon, () => this.setLayout(l), { 'aria-pressed': String(l === this.layout), class: `icon-btn${l === this.layout ? ' active' : ''}` })))
      : null;

    const bar = h('header', { class: 'focus-bar' },
      h('div', { class: 'focus-crumb' },
        h('span', { class: 'muted' }, where ? where.room.name : 'Collection'),
        h('span', { class: 'muted' }, ` · ${pos} / ${this.order.length}`)),
      h('div', { class: 'focus-actions' },
        layouts,
        this.layout === 'immersive' ? btn('Toggle information (I)', icons.info, () => this.toggleInfo()) : null,
        btn('Previous (←)', icons.prev, () => this.step(-1)),
        btn('Next (→)', icons.next, () => this.step(1)),
        btn('Close (Esc)', icons.close, () => this.ev.onClose())),
    );

    // image stage
    const img = h('img', { class: 'focus-img', alt: `${art.title} by ${art.artist.name}`, draggable: 'false' }) as HTMLImageElement;
    const stage = h('div', { class: 'focus-stage', style: `--placeholder:${asset?.color ?? '#777'}` }, img);
    if (asset) {
      img.src = asset.thumb;
      const full = new Image();
      full.onload = () => { if (this.current === id) { img.src = asset.full; img.classList.add('loaded'); } };
      full.src = asset.full;
      this.zoomer = new Zoomer(stage, img, asset.width / asset.height);
      requestAnimationFrame(() => this.zoomer?.fit());
    }
    const zoomCtl = h('div', { class: 'zoom-ctl' },
      btn('Zoom in', icons.plus, () => { const r = stage.getBoundingClientRect(); this.zoomer?.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.6); }),
      btn('Zoom out', icons.minus, () => { const r = stage.getBoundingClientRect(); this.zoomer?.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.6); }),
      btn('Fit', icons.fit, () => this.zoomer?.reset()));
    stage.append(zoomCtl);

    // information
    const dims = formatDimensions(art.dimensions);
    const life = [art.artist.nationality, art.artist.life].filter(Boolean).join(', ');
    const facts: Array<[string, string | undefined]> = [
      ['Date', art.date], ['Medium', art.medium], ['Dimensions', dims], ['Collection', art.collection], ['Accession', art.accession], ['Credit', art.credit],
    ];
    const info = h('aside', { class: 'focus-info' },
      this.layout === 'catalogue' ? h('div', { class: 'plate-no' }, `Cat. ${String(pos).padStart(2, '0')}`) : null,
      h('p', { class: 'artist' }, art.artist.name, life ? h('span', { class: 'life' }, ` (${life})`) : null),
      h('h1', { class: 'title' }, art.title),
      art.date ? h('p', { class: 'date' }, art.date) : null,
      h('dl', { class: 'facts' }, facts.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v!)])),
      art.description ? h('div', { class: 'desc', html: marked.parse(art.description, { async: false }) as string }) : null,
      art.provenance.length
        ? h('section', { class: 'prov' }, h('h2', {}, 'Provenance'),
            h('ol', { class: 'timeline' }, art.provenance.map((p) => h('li', {}, p.date ? h('span', { class: 'when' }, p.date) : null, h('span', { class: 'what' }, p.event), p.note ? h('span', { class: 'note' }, p.note) : null))))
        : null,
      art.tags.length ? h('p', { class: 'tags' }, art.tags.map((t) => h('span', { class: 'tag' }, t))) : null,
      h('p', { class: 'source' },
        art.rights ? h('span', {}, art.rights) : null,
        art.source ? h('a', { href: art.source, target: '_blank', rel: 'noopener' }, 'Source record ↗') : null,
        asset ? h('a', { href: asset.full, target: '_blank', rel: 'noopener' }, asset.kind === 'svg' ? 'Open SVG ↗' : 'Full image ↗') : null),
      this.ev.onShowInGallery && where
        ? h('button', { class: 'text-btn', type: 'button', onclick: (() => this.ev.onShowInGallery!(id)) as EventListener, html: `${icons.pin}<span>Show in gallery</span>` })
        : null,
    );

    this.el.append(bar, h('div', { class: 'focus-body' }, stage, info));
    (bar.querySelector('button[aria-label^="Close"]') as HTMLButtonElement)?.focus({ preventScroll: true });
  }

  dispose() { window.removeEventListener('keydown', this.keyHandler, true); this.zoomer?.dispose(); }
}
