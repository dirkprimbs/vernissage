import { marked } from 'marked';
import { LIGHTING, LIGHTING_IDS, TIME_IDS, WEATHER_CREDIT, WEATHER_IDS, type LightingId, type PlacedRoom, type SiteData, type TimeId, type WeatherId } from '@vernissage/schema';
import type { ConditionsChoice, ConditionsNow } from '../conditions';
import { h, clear } from '../dom';
import { formatDimensions, roomOfArtwork, tourOrder } from '../data';
import type { Gallery3D } from '../app3d';
import type { Quality } from '../scene/lighting';
import type { ArtworkInstance } from '../scene/build';
import { icons } from './icons';

export interface ShellState { lighting: LightingId; quality: Quality; outside: ConditionsChoice }

const TIME_NAMES: Record<TimeId, string> = { live: 'Live', dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };
const WEATHER_NAMES: Record<WeatherId, string> = { live: 'Live', clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', snow: 'Snow', fog: 'Fog' };

export interface ShellEvents {
  onPortfolio: () => void;
  onLeave: () => void;
  onInspect: (id: string) => void;
  /** wall label close-up */
  onLabel: (id: string) => void;
  onLighting: (id: LightingId) => void;
  /** the visitor chose a time of day or a weather for outside */
  onOutside: (choice: ConditionsChoice) => void;
  onQuality: (q: Quality) => void;
}

type Preset = 'basic' | 'transparent' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5';
type SidebarId = 'artworks' | 'rooms' | 'info';

/**
 * The in-room interface: a bottom toolbar of round, labelled buttons, popovers above it, sidebars on the right,
 * a dark object menu for the selected artwork and transient notifications at the bottom left.
 */
export class Shell {
  readonly el = h('div', { class: 'room-layout' });
  private viewport = h('div', { class: 'viewport' });
  private sidebar = h('aside', { class: 'sidebar', hidden: true, 'aria-live': 'polite' });
  private toolbar = h('footer', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Gallery tools' });
  private roomChip = h('div', { class: 'room-chip' });
  private notes = h('div', { class: 'notifications', 'aria-live': 'polite' });
  private hint = h('button', { class: 'hint', type: 'button', hidden: true });
  private objectMenu = h('div', { class: 'object-menu-container', hidden: true });
  private minimap = h('canvas', { class: 'minimap', width: 220, height: 220, 'aria-label': 'Map — click a room to walk there' }) as HTMLCanvasElement;
  private progress = h('div', { class: 'progress' }, h('span'));
  private pop?: { el: HTMLElement; anchor: HTMLElement };
  private side?: SidebarId;
  private buttons = new Map<string, HTMLButtonElement>();
  private order: string[];
  private nearId?: string;
  private showMap = !matchMedia('(max-width: 767px)').matches;
  private outsideNow?: ConditionsNow;
  private outsideStatus?: HTMLElement;

  constructor(private data: SiteData, private g3d: Gallery3D, private state: ShellState, private ev: ShellEvents) {
    this.order = tourOrder(data).filter((id) => g3d.built.artworks.some((a) => a.id === id));
    const g = data.gallery;
    const tb = (id: string, label: string, icon: string, preset: Preset, onclick: (b: HTMLButtonElement) => void) => {
      const b = h('button', { class: `tb-btn ${preset}`, type: 'button', 'aria-label': label, 'data-id': id },
        h('span', { class: 'tb-icon', html: icon }), h('label', {}, label)) as HTMLButtonElement;
      b.addEventListener('click', (e) => { e.stopPropagation(); onclick(b); });
      this.buttons.set(id, b);
      return b;
    };
    this.toolbar.append(
      h('div', { class: 'tb-group left' },
        tb('share', 'Share', icons.share, 'basic', (b) => this.popover(b, this.sharePanel())),
        tb('info', 'Info', icons.info, 'transparent', () => this.toggleSidebar('info'))),
      h('div', { class: 'tb-group center' },
        g.lighting.allowVisitorChoice ? tb('light', 'Light', icons.sun, 'accent5', (b) => this.popover(b, this.lightPanel())) : null,
        tb('artworks', 'Artworks', icons.list, 'accent3', () => this.toggleSidebar('artworks')),
        tb('rooms', 'Rooms', icons.map, 'accent4', () => this.toggleSidebar('rooms')),
        tb('portfolio', 'Portfolio', icons.grid, 'accent2', () => ev.onPortfolio())),
      h('div', { class: 'tb-group right' },
        tb('more', 'More', icons.more, 'transparent', (b) => this.popover(b, this.morePanel())),
        tb('leave', 'Leave', icons.leave, 'accent1', () => ev.onLeave())),
    );
    this.viewport.append(this.roomChip, this.minimap, this.notes, this.hint, this.objectMenu, this.progress);
    this.minimap.hidden = !this.showMap;
    this.el.append(this.viewport, this.sidebar, this.toolbar);
    this.roomChip.append(h('strong', {}, g.title), h('span', {}));
    this.hint.addEventListener('click', () => this.nearId && this.g3d.select(this.nearId));
    this.minimap.addEventListener('click', (e) => this.mapClick(e));
    document.addEventListener('pointerdown', (e) => { if (this.pop && !this.pop.el.contains(e.target as Node) && !this.pop.anchor.contains(e.target as Node)) this.closePop(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (this.pop) this.closePop(); else if (this.side) this.toggleSidebar(this.side); } });
  }

  // ---------- toolbar state ----------
  private setActive(id: string, on: boolean) { this.buttons.get(id)?.classList.toggle('selected', on); }

  // ---------- popovers ----------
  private closePop() {
    if (!this.pop) return;
    this.setActive(this.pop.anchor.dataset.id!, false);
    this.pop.el.remove();
    this.pop = undefined;
  }

  private popover(anchor: HTMLElement, content: HTMLElement) {
    const same = this.pop?.anchor === anchor;
    this.closePop();
    if (same) return;
    const el = h('div', { class: 'popover', role: 'dialog' }, content, h('span', { class: 'popover-arrow' }));
    this.viewport.append(el);
    const r = anchor.getBoundingClientRect();
    const vr = this.viewport.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2 - vr.left), vr.width - w - 8);
    el.style.left = `${left}px`;
    el.style.bottom = `12px`;
    (el.querySelector('.popover-arrow') as HTMLElement).style.left = `${r.left + r.width / 2 - vr.left - left - 8}px`;
    this.pop = { el, anchor };
    this.setActive(anchor.dataset.id!, true);
  }

  private panel(title: string, ...body: (Node | null)[]) {
    return h('div', { class: 'panel' }, h('h5', { class: 'panel-title' }, title), ...(body.filter(Boolean) as Node[]));
  }

  private sharePanel() {
    const base = (location.origin + location.pathname);
    const room = this.g3d.currentRoom?.room;
    const sel = this.g3d.selectedArtwork;
    const row = (label: string, url: string) => {
      const input = h('input', { readonly: true, value: url, 'aria-label': label }) as HTMLInputElement;
      const copy = h('button', { class: 'btn small', type: 'button', html: `${icons.copy}<span>Copy</span>` });
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(url); } catch { input.select(); document.execCommand?.('copy'); }
        this.notify('Link copied');
        this.closePop();
      });
      return h('div', { class: 'share-row' }, h('small', {}, label), h('div', { class: 'input-row' }, input, copy));
    };
    return this.panel('Share',
      row('This gallery', base),
      room ? row(`This room · ${room.name}`, `${base}#/room/${room.id}`) : null,
      sel ? row(`This artwork · ${sel.art.title}`, `${base}#/art/${sel.id}`) : null);
  }

  /** the conditions outside changed (the sun moved on, the weather report arrived) */
  setOutside(now: ConditionsNow) {
    this.outsideNow = now;
    if (this.outsideStatus?.isConnected) this.outsideStatus.textContent = this.outsideText();
  }

  private outsideText() {
    const n = this.outsideNow, c = this.state.outside;
    if (!n) return '';
    const sky = `${TIME_NAMES[n.phase]}, ${WEATHER_NAMES[n.weather].toLowerCase()}`;
    if (c.time !== 'live' && c.weather !== 'live') return `Showing: ${sky}`;
    const report = c.weather === 'live' ? (n.failed ? 'the weather report is not available' : n.report ?? 'asking for the weather…') : '';
    return `Toronto now: ${[c.time === 'live' ? TIME_NAMES[n.phase].toLowerCase() : '', report].filter(Boolean).join(' · ')}`;
  }

  private lightPanel() {
    const env = this.data.gallery.environment;
    const chips = <T extends string>(label: string, ids: readonly T[], names: Record<T, string>, get: () => T, set: (v: T) => void) => {
      const row = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label }, ids.map((id) => {
        const b = h('button', { type: 'button', role: 'radio', class: `chip${id === 'live' ? ' live' : ''}${id === get() ? ' active' : ''}`, 'aria-checked': String(id === get()) }, names[id]);
        b.addEventListener('click', () => {
          set(id);
          row.querySelectorAll('button').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); });
          this.ev.onOutside({ ...this.state.outside });
          status.textContent = this.outsideText();
        });
        return b;
      }));
      return h('div', { class: 'chip-row' }, h('small', {}, label), row);
    };
    const status = h('p', { class: 'outside-status', 'aria-live': 'polite' }, this.outsideText());
    this.outsideStatus = status;
    // "live" weather asks Environment Canada; if the gallery's owner fixed the weather, visitors are not offered it
    const weathers = WEATHER_IDS.filter((id) => id !== 'live' || env.weather === 'live');
    const outside = h('div', { class: 'menu-group' },
      h('h6', {}, 'Outside'),
      chips('Time of day', TIME_IDS, TIME_NAMES, () => this.state.outside.time, (v) => { this.state.outside.time = v; }),
      chips('Weather', weathers, WEATHER_NAMES, () => this.state.outside.weather, (v) => { this.state.outside.weather = v; }),
      status);
    const rooms = h('div', { class: 'menu-group' }, h('h6', {}, 'Room lighting'), h('div', { class: 'option-list' }, LIGHTING_IDS.map((id) => {
      const b = h('button', { type: 'button', class: `option${id === this.state.lighting ? ' active' : ''}` },
        h('strong', {}, LIGHTING[id].name), h('span', {}, LIGHTING[id].description));
      b.addEventListener('click', () => {
        this.state.lighting = id; this.ev.onLighting(id);
        rooms.querySelectorAll('.option').forEach((x) => x.classList.toggle('active', x === b));
        this.notify(`Lighting: ${LIGHTING[id].name}`);
      });
      return b;
    })));
    return this.panel('Light', outside, rooms);
  }

  private morePanel() {
    const item = (label: string, icon: string, fn: () => void) => {
      const b = h('button', { type: 'button', class: 'menu-row', html: `${icon}<span>${label}</span>` });
      b.addEventListener('click', () => { this.closePop(); fn(); });
      return b;
    };
    const q = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Graphics quality' }, (['low', 'medium', 'high'] as Quality[]).map((v) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === this.state.quality), class: v === this.state.quality ? 'active' : '' }, v[0].toUpperCase() + v.slice(1));
      b.addEventListener('click', () => { this.state.quality = v; this.ev.onQuality(v); q.querySelectorAll('button').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-checked', String(x === b)); }); });
      return b;
    }));
    const narrow = matchMedia('(max-width: 520px)').matches;
    return this.panel('More',
      narrow ? item('Share', icons.share, () => { const b = this.buttons.get('more')!; setTimeout(() => this.popover(b, this.sharePanel())); }) : null,
      narrow ? item('About this gallery', icons.info, () => this.toggleSidebar('info')) : null,
      item('Full screen', icons.fullscreen, () => { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }),
      item(this.showMap ? 'Hide map' : 'Show map', icons.map, () => { this.showMap = !this.showMap; this.minimap.hidden = !this.showMap; }),
      item('Controls & help', icons.help, () => this.toggleSidebar('info')),
      h('div', { class: 'menu-sub' }, h('small', {}, 'Graphics quality'), q));
  }

  // ---------- sidebars ----------
  toggleSidebar(id: SidebarId) {
    this.closePop();
    if (this.side) this.setActive(this.side, false);
    if (this.side === id) { this.side = undefined; this.sidebar.hidden = true; this.el.classList.remove('with-sidebar'); return; }
    this.side = id;
    this.setActive(id, true);
    this.renderSidebar();
    this.sidebar.hidden = false;
    this.el.classList.add('with-sidebar');
  }

  private renderSidebar() {
    clear(this.sidebar);
    const title = { artworks: `Artworks (${this.order.length})`, rooms: `Rooms (${this.data.gallery.rooms.length})`, info: 'About this gallery' }[this.side!];
    const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: icons.close });
    close.addEventListener('click', () => this.toggleSidebar(this.side!));
    this.sidebar.append(h('header', { class: 'sidebar-head' }, close, h('h5', {}, title)));
    const body = h('div', { class: 'sidebar-body' });
    this.sidebar.append(body);
    if (this.side === 'artworks') this.artworksList(body);
    else if (this.side === 'rooms') this.roomsList(body);
    else this.infoPanel(body);
  }

  private artworksList(body: HTMLElement) {
    for (const r of this.data.gallery.rooms) {
      const ids = this.order.filter((id) => roomOfArtwork(this.data, id)?.room.id === r.id);
      if (!ids.length) continue;
      body.append(h('h6', { class: 'list-heading' }, r.name));
      const ul = h('ul', { class: 'list' });
      for (const id of ids) {
        const a = this.data.gallery.artworks.find((x) => x.id === id)!;
        const asset = this.data.assets[id];
        const row = h('li', {},
          h('button', { type: 'button', class: 'list-row', 'aria-label': `Go to ${a.title}` },
            h('span', { class: 'thumb', style: `background:${asset?.color ?? '#ddd'}` }, asset ? h('img', { src: asset.thumb, alt: '', loading: 'lazy' }) : null),
            h('span', { class: 'list-text' }, h('strong', {}, a.title), h('small', {}, [a.artist.name, a.date].filter(Boolean).join(' · ')))),
          h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Inspect ${a.title}`, title: 'Inspect', html: icons.inspect }));
        (row.children[0] as HTMLElement).addEventListener('click', () => { this.g3d.select(id, 'walk'); if (matchMedia('(max-width: 991px)').matches) this.toggleSidebar('artworks'); });
        (row.children[1] as HTMLElement).addEventListener('click', () => this.ev.onInspect(id));
        ul.append(row);
      }
      body.append(ul);
    }
  }

  private roomsList(body: HTMLElement) {
    const ul = h('ul', { class: 'list' });
    this.data.gallery.rooms.forEach((r, i) => {
      const n = Object.values(r.walls).reduce((s, w) => s + w.artworks.length, 0);
      const here = this.g3d.currentRoom?.room.id === r.id;
      const b = h('button', { type: 'button', class: 'list-row' },
        h('span', { class: 'room-no' }, String(i + 1)),
        h('span', { class: 'list-text' }, h('strong', {}, r.name), h('small', {}, `${n} work${n === 1 ? '' : 's'}${r.description ? ' · ' + r.description : ''}`)),
        here ? h('span', { class: 'tag' }, 'You are here') : null);
      b.addEventListener('click', () => { this.g3d.walkToRoom(r.id); this.notify(`Walking to ${r.name}`); });
      ul.append(h('li', {}, b));
    });
    body.append(ul);
  }

  private infoPanel(body: HTMLElement) {
    const g = this.data.gallery;
    const row = (k: string, v: string) => h('tr', {}, h('th', {}, h('kbd', {}, k)), h('td', {}, v));
    body.append(...[
      h('h2', { class: 'info-title' }, g.title),
      g.subtitle ? h('p', { class: 'muted' }, g.subtitle) : null,
      g.intro ? h('div', { class: 'md', html: marked.parse(g.intro, { async: false }) as string }) : null,
      h('h6', { class: 'list-heading' }, 'Controls'),
      h('table', { class: 'keys' },
        row('W A S D', 'Move'), row('↑ ↓ ← →', 'Move forward / back, turn'), row('Q / E', 'Snap turn 45°'), row('Shift', 'Move faster'),
        row('Drag', 'Look around'), row('Right-click', 'Teleport (hold, aim, release)'), row('Click', 'Walk to the floor or select an artwork'),
        row('Space / Tab', 'Options for the artwork you face'), row('Enter', 'Inspect the artwork'), row('L', 'Read the wall label up close'), row('Mouse wheel', 'Zoom in and out (press the wheel to reset)'), row('Esc', 'Close menus')),
      h('p', { class: 'muted small' }, 'On touch screens: joystick to move, drag to look, long-press the floor to teleport, tap an artwork for options.'),
      g.environment.weather === 'live' ? h('p', { class: 'muted small' }, `The sky follows Toronto's time of day and weather. Weather: ${WEATHER_CREDIT}.`) : null,
      h('p', { class: 'muted small' }, `Built with ${this.data.build.generator}.`),
    ].filter(Boolean) as HTMLElement[]);
  }

  // ---------- object menu ----------
  setSelected(a?: ArtworkInstance) {
    clear(this.objectMenu);
    this.objectMenu.hidden = !a;
    this.hint.hidden = !!a || !this.nearId;
    if (!a) return;
    const art = a.art;
    const btn = (label: string, icon: string, fn: () => void) => {
      const b = h('button', { type: 'button', class: 'om-btn', html: `${icon}<span>${label}</span>` });
      b.addEventListener('click', fn);
      return b;
    };
    const close = h('button', { class: 'om-close', type: 'button', 'aria-label': 'Close', html: icons.close });
    close.addEventListener('click', () => this.g3d.select(undefined));
    const i = this.order.indexOf(a.id);
    const page = (d: number) => this.g3d.select(this.order[(i + d + this.order.length) % this.order.length], 'teleport');
    const prev = h('button', { class: 'om-page', type: 'button', 'aria-label': 'Previous artwork', html: icons.chevronLeft });
    const next = h('button', { class: 'om-page', type: 'button', 'aria-label': 'Next artwork', html: icons.chevronRight });
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    const actions = [
      btn('Inspect', icons.inspect, () => this.ev.onInspect(a.id)),
      btn('Label', icons.label, () => this.ev.onLabel(a.id)),
      btn('Walk here', icons.walk, () => this.g3d.walkToArtwork(a.id)),
      art.source ? btn('Source', icons.link, () => window.open(art.source, '_blank', 'noopener')) : null,
      btn('Share', icons.share, async () => {
        const url = `${(location.origin + location.pathname)}#/art/${a.id}`;
        try { await navigator.clipboard.writeText(url); this.notify('Link to this artwork copied'); } catch { this.notify(url); }
      }),
    ].filter(Boolean) as HTMLElement[];
    const menu = h('div', { class: 'object-menu' },
      h('div', { class: 'om-header' }, close,
        h('div', { class: 'om-title' }, h('strong', {}, art.title), h('small', {}, [art.artist.name, art.date, formatDimensions(art.dimensions)].filter(Boolean).join(' · ')))),
      h('div', { class: 'om-actions' }, actions.flatMap((b, k) => (k ? [h('span', { class: 'om-sep' }), b] : [b]))));
    this.objectMenu.append(menu, h('div', { class: 'om-pagination' }, prev, h('span', {}, `${i + 1} / ${this.order.length}`), next));
  }

  setNear(a?: ArtworkInstance) {
    this.nearId = a?.id;
    this.hint.hidden = !a || !this.objectMenu.hidden;
    if (a) { clear(this.hint); this.hint.append(h('kbd', {}, 'Space'), h('span', {}, 'Options'), h('kbd', {}, '↵'), h('span', {}, 'Inspect'), h('em', {}, a.art.title)); }
  }

  // ---------- room, notifications, progress, map ----------
  setRoom(r: PlacedRoom) {
    (this.roomChip.lastChild as HTMLElement).textContent = r.room.name;
    this.notify(`Entered ${r.room.name}`, r.room.description);
    if (this.side === 'rooms') this.renderSidebar();
  }

  notify(text: string, detail?: string) {
    const n = h('div', { class: 'notice' }, h('strong', {}, text), detail ? h('span', {}, detail) : null);
    this.notes.append(n);
    while (this.notes.children.length > 3) this.notes.firstElementChild!.remove();
    setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 400); }, 4200);
  }

  setProgress(done: number, total: number) {
    (this.progress.firstElementChild as HTMLElement).style.width = `${total ? (done / total) * 100 : 100}%`;
    this.progress.classList.toggle('done', done >= total);
  }

  drawMap() {
    if (this.minimap.hidden) return;
    const c = this.minimap, ctx = c.getContext('2d')!;
    const { bounds, rooms, passages } = this.g3d.built.plan;
    const pad = 14, W = c.width, H = c.height;
    const s = Math.min((W - pad * 2) / (bounds.maxX - bounds.minX), (H - pad * 2) / (bounds.maxZ - bounds.minZ));
    const ox = (W - (bounds.maxX - bounds.minX) * s) / 2 - bounds.minX * s;
    const oz = (H - (bounds.maxZ - bounds.minZ) * s) / 2 - bounds.minZ * s;
    (c as unknown as { _m: { s: number; ox: number; oz: number } })._m = { s, ox, oz };
    ctx.clearRect(0, 0, W, H);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#007ab8';
    const cur = this.g3d.currentRoom?.room.id;
    ctx.fillStyle = '#d5d9dd';
    for (const p of passages) ctx.fillRect(ox + p.minX * s, oz + p.minZ * s, (p.maxX - p.minX) * s, (p.maxZ - p.minZ) * s);
    for (const r of rooms) {
      ctx.fillStyle = r.room.id === cur ? '#e3eef5' : '#eceff1';
      ctx.strokeStyle = '#9aa3aa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(ox + r.minX * s, oz + r.minZ * s, r.room.width * s, r.room.depth * s, 4);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#5c666e';
    for (const a of this.g3d.built.artworks) ctx.fillRect(ox + a.centre.x * s - 2, oz + a.centre.z * s - 2, 4, 4);
    const sel = this.g3d.selectedArtwork;
    if (sel) { ctx.fillStyle = accent; ctx.fillRect(ox + sel.centre.x * s - 3, oz + sel.centre.z * s - 3, 6, 6); }
    const p = this.g3d.position;
    const yaw = this.g3d.heading;
    const px = ox + p.x * s, pz = oz + p.z * s;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.18;
    const ang = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    ctx.beginPath(); ctx.moveTo(px, pz); ctx.arc(px, pz, 26, ang - 0.5, ang + 0.5); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(px, pz, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }

  private mapClick(e: MouseEvent) {
    const m = (this.minimap as unknown as { _m?: { s: number; ox: number; oz: number } })._m;
    if (!m) return;
    const r = this.minimap.getBoundingClientRect();
    const x = ((e.clientX - r.left) * (this.minimap.width / r.width) - m.ox) / m.s;
    const z = ((e.clientY - r.top) * (this.minimap.height / r.height) - m.oz) / m.s;
    const room = this.g3d.built.plan.rooms.find((pr) => x >= pr.minX && x <= pr.maxX && z >= pr.minZ && z <= pr.maxZ);
    if (room) { this.g3d.walkToRoom(room.room.id); this.notify(`Walking to ${room.room.name}`); }
  }

  setVisible(v: boolean) { this.el.hidden = !v; if (!v) this.closePop(); }
}
