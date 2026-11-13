import { marked } from 'marked';
import type { SiteData } from '@vernissage/schema';
import { h, clear } from '../dom';
import { icons } from './icons';

/** Full-screen loading view shown while the 3D scene is built. */
export class LoadingScreen {
  readonly el: HTMLElement;
  private label = h('p', { class: 'loading-label' }, 'Preparing the gallery…');
  constructor(title: string) {
    this.el = h('div', { class: 'loading-screen', role: 'status' },
      h('div', { class: 'loading-inner' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('h1', {}, title), this.label));
  }
  set(text: string) { this.label.textContent = text; }
  hide() { this.el.classList.add('gone'); setTimeout(() => this.el.remove(), 500); }
}

export interface EntryOptions {
  data: SiteData;
  has3D: boolean;
  /** message shown instead of the join button when 3D is unavailable */
  no3DReason?: string;
  onJoin: () => void;
  onBrowse: () => void;
}

/** The lobby: a room-entry card over the slowly circling first room. */
export class EntryModal {
  readonly el = h('div', { class: 'modal-backdrop entry' });

  constructor(private o: EntryOptions) {}

  showRoom() {
    clear(this.el);
    const g = this.o.data.gallery;
    const firstPara = g.intro?.split(/\n\s*\n/)[0];
    const join = h('button', { class: 'btn primary wide', type: 'button', html: `${icons.enter}<span>Join gallery</span>` });
    const browse = h('button', { class: 'btn accent2 wide', type: 'button', html: `${icons.grid}<span>Browse portfolio</span>` });
    join.addEventListener('click', () => this.o.onJoin());
    browse.addEventListener('click', () => this.o.onBrowse());
    const card = h('div', { class: 'modal entry-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'entry-title' },
      h('div', { class: 'entry-body' },
        h('p', { class: 'eyebrow' }, 'Gallery'),
        h('h1', { id: 'entry-title' }, g.title),
        g.subtitle ? h('p', { class: 'muted' }, g.subtitle) : null,
        h('p', { class: 'counts' },
          h('span', {}, `${g.artworks.length} works`), h('span', {}, `${g.rooms.length} room${g.rooms.length === 1 ? '' : 's'}`)),
        firstPara ? h('div', { class: 'md clamp', html: marked.parse(firstPara, { async: false }) as string }) : null,
        h('div', { class: 'entry-buttons' }, this.o.has3D ? join : null, browse),
        !this.o.has3D && this.o.no3DReason ? h('p', { class: 'muted small' }, this.o.no3DReason) : null));
    this.el.append(card);
    requestAnimationFrame(() => (this.o.has3D ? join : browse).focus());
  }

  hide() { this.el.remove(); }
}
