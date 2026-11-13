import type { SiteData } from '@vernissage/schema';
import { h, clear } from '../dom';
import { roomOfArtwork } from '../data';
import { icons } from './icons';

export interface PortfolioEvents {
  onOpen: (id: string) => void;
  /** undefined when WebGL is not available */
  onEnter3D?: () => void;
  /** why the 3D gallery is not offered, shown above the grid */
  notice?: string;
}

/** The 2D portfolio: every work grouped by room, with a filter by room. */
export class PortfolioView {
  readonly el = h('div', { class: 'portfolio' });
  private roomFilter = '';
  private grid = h('div', { class: 'pf-sections' });

  constructor(private data: SiteData, private ev: PortfolioEvents) {
    const g = data.gallery;
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by room' },
      [{ id: '', name: 'All' }, ...g.rooms.map((r) => ({ id: r.id, name: r.name }))].map((r) => {
        const b = h('button', { type: 'button', class: `chip${r.id === '' ? ' active' : ''}`, 'data-room': r.id }, r.name);
        b.addEventListener('click', () => {
          this.roomFilter = r.id;
          chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
          this.renderGrid();
        });
        return b;
      }));
    this.el.append(
      h('header', { class: 'pf-head' },
        h('div', {},
          h('h1', {}, g.title),
          g.subtitle ? h('p', { class: 'muted' }, g.subtitle) : null),
        ev.onEnter3D ? h('button', { class: 'primary-btn', type: 'button', onclick: (() => ev.onEnter3D!()) as EventListener, html: `${icons.cube}<span>Walk the gallery</span>` }) : null),
      ev.notice ? h('p', { class: 'pf-notice', role: 'note' }, ev.notice) : h('div'),
      g.rooms.length > 1 ? h('div', { class: 'pf-tools' }, chips) : h('div'),
      this.grid,
    );
    this.renderGrid();
  }

  private renderGrid() {
    clear(this.grid);
    const g = this.data.gallery;
    const sections: Array<{ id: string; name: string; description?: string; works: string[] }> = g.rooms.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      works: (['north', 'east', 'south', 'west'] as const).flatMap((s) => r.walls[s].artworks.map((p) => p.artwork)),
    }));
    const loose = g.artworks.filter((a) => !roomOfArtwork(this.data, a.id)).map((a) => a.id);
    if (loose.length) sections.push({ id: '__loose', name: 'Also in the collection', works: loose });
    let shown = 0;
    for (const s of sections) {
      if (this.roomFilter && s.id !== this.roomFilter) continue;
      const works = s.works;
      if (!works.length) continue;
      shown += works.length;
      this.grid.append(h('section', { class: 'pf-section' },
        h('h2', {}, s.name), s.description ? h('p', { class: 'muted pf-desc' }, s.description) : null,
        h('ul', { class: 'pf-grid' }, works.map((id) => this.card(id)))));
    }
    if (!shown) this.grid.append(h('p', { class: 'muted empty' }, 'No works here yet.'));
  }

  private card(id: string) {
    const a = this.data.gallery.artworks.find((x) => x.id === id)!;
    const asset = this.data.assets[id];
    const ratio = asset ? asset.width / asset.height : 0.8;
    return h('li', {},
      h('button', { type: 'button', class: 'pf-card', onclick: (() => this.ev.onOpen(id)) as EventListener, 'aria-label': `${a.title}, ${a.artist.name}` },
        h('div', { class: 'pf-thumb', style: `aspect-ratio:${ratio};background:${asset?.color ?? '#888'}` },
          asset ? h('img', { src: asset.thumb, alt: '', loading: 'lazy', decoding: 'async' }) : null),
        h('div', { class: 'pf-cap' },
          h('span', { class: 'pf-title' }, a.title),
          h('span', { class: 'pf-meta' }, [a.artist.name, a.date].filter(Boolean).join(', ')))));
  }
}
