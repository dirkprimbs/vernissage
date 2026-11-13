import type { Artwork, SiteData, StyleDef } from '@vernissage/schema';
import { h, clear } from '../dom';
import { formatDimensions } from '../data';
import { icons } from './icons';

export interface LabelEvents {
  onInspect: (id: string) => void;
  onClose: () => void;
}

const SIZES = [16, 18, 21, 24, 28];

/**
 * Close-up of a wall label: the card from the wall, drawn large in the style's label colours and typeface,
 * with the complete provenance. It is to the label what focus mode is to the picture.
 */
export class LabelView {
  readonly el = h('div', { class: 'label-view', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Wall label' });
  private card = h('article', { class: 'label-card' });
  private size = 1;
  private id?: string;

  constructor(private data: SiteData, style: StyleDef, private ev: LabelEvents) {
    this.el.style.setProperty('--label-bg', style.labelBackground);
    this.el.style.setProperty('--label-fg', style.labelText);
    this.el.style.setProperty('--label-font', style.labelFont === 'serif' ? 'var(--serif)' : 'var(--sans)');
    const btn = (label: string, html: string, f: () => void) => {
      const b = h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, html });
      b.addEventListener('click', f);
      return b;
    };
    const bar = h('div', { class: 'label-tools' },
      btn('Smaller text', '<span class="aa small">A</span>', () => this.zoom(-1)),
      btn('Larger text', '<span class="aa">A</span>', () => this.zoom(1)),
      btn('Close', icons.close, () => this.ev.onClose()));
    this.el.append(h('div', { class: 'label-scroll' }, this.card), bar);
    this.el.addEventListener('click', (e) => { if (e.target === this.el || (e.target as HTMLElement).classList.contains('label-scroll')) this.ev.onClose(); });
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.ev.onClose(); }
      else if (e.key === '+' || e.key === '=') this.zoom(1);
      else if (e.key === '-') this.zoom(-1);
    });
  }

  get open() { return !this.el.hidden; }
  get artworkId() { return this.id; }

  private zoom(d: number) {
    this.size = Math.max(0, Math.min(SIZES.length - 1, this.size + d));
    this.card.style.fontSize = `${SIZES[this.size]}px`;
  }

  show(id: string) {
    const art = this.data.gallery.artworks.find((a) => a.id === id);
    if (!art) return;
    this.id = id;
    this.render(art);
    this.zoom(0);
    this.el.hidden = false;
    this.el.classList.remove('in');
    requestAnimationFrame(() => this.el.classList.add('in'));
    (this.el.querySelector('.label-tools button:last-child') as HTMLElement | null)?.focus();
  }

  hide() { this.el.hidden = true; this.el.classList.remove('in'); this.id = undefined; }

  private render(a: Artwork) {
    clear(this.card);
    const life = [a.artist.nationality, a.artist.life].filter(Boolean).join(', ');
    const rows: Array<[string, string | undefined]> = [
      ['Medium', a.medium], ['Dimensions', formatDimensions(a.dimensions)], ['Collection', a.collection], ['Accession', a.accession],
    ];
    const inspect = h('button', { class: 'btn small', type: 'button', html: `${icons.inspect}<span>Inspect the artwork</span>` });
    inspect.addEventListener('click', () => this.ev.onInspect(a.id));
    const parts: Array<HTMLElement | null> = [
      h('header', {},
        h('p', { class: 'l-artist' }, a.artist.name),
        life ? h('p', { class: 'l-life' }, life) : null,
        h('h2', { class: 'l-title' }, a.title, a.date ? h('span', { class: 'l-date' }, `, ${a.date}`) : null)),
      h('dl', { class: 'l-facts' }, rows.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v!)])),
      a.credit ? h('p', { class: 'l-credit' }, a.credit) : null,
      h('section', { class: 'l-prov' },
        h('h3', {}, 'Provenance'),
        a.provenance.length
          ? h('ol', {}, a.provenance.map((p) => h('li', {},
            h('span', { class: 'when' }, p.date ?? '—'),
            h('span', { class: 'what' }, p.event, p.note ? h('small', {}, p.note) : null))))
          : h('p', { class: 'l-none' }, 'No provenance has been recorded for this work.')),
      a.rights || a.source
        ? h('footer', {},
          a.rights ? h('span', {}, a.rights) : null,
          a.source ? h('a', { href: a.source, target: '_blank', rel: 'noopener' }, 'Source record') : null)
        : null,
      h('div', { class: 'l-actions' }, inspect),
    ];
    this.card.append(...parts.filter((p): p is HTMLElement => !!p));
  }
}
