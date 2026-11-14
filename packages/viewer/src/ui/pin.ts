import { marked } from 'marked';
import { pinAssetKey, type SiteData } from '@vernissage/schema';
import { h, clear } from '../dom';
import { icons } from './icons';
import { NOTE_PAPER } from '../scene/pinboard';

/**
 * Close-up of something on a pinboard: an instant photo with the line written on it, or a note with its text
 * set from Markdown, links and all.
 */
export class PinView {
  readonly el = h('div', { class: 'pin-view', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pinboard' });
  private body = h('div', { class: 'pin-scroll' });

  constructor(private data: SiteData, private onClose: () => void) {
    const close = h('button', { class: 'icon-btn pin-close', type: 'button', 'aria-label': 'Close', title: 'Close', html: icons.close });
    close.addEventListener('click', () => this.onClose());
    this.el.append(this.body, close);
    this.el.addEventListener('click', (e) => { if (e.target === this.el || e.target === this.body) this.onClose(); });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.onClose(); } });
  }

  get open() { return !this.el.hidden; }

  show(roomId: string, id: string) {
    const item = this.data.gallery.rooms.find((r) => r.id === roomId)?.pinboard?.items.find((p) => p.id === id);
    if (!item) return;
    clear(this.body);
    if (item.kind === 'photo') {
      const asset = this.data.assets[pinAssetKey(roomId, id)];
      this.body.append(h('figure', { class: `instax instax-${item.format}` },
        h('div', { class: 'instax-img' }, asset ? h('img', { src: asset.full, alt: item.caption ?? '' }) : null),
        h('figcaption', {}, item.caption ?? '')));
    } else {
      const text = h('div', { class: 'note-text', html: marked.parse(item.text, { async: false }) as string });
      // links on a note lead away from the gallery: open them beside it
      for (const a of text.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener'; }
      const card = h('article', { class: 'note-card' }, text);
      card.style.background = NOTE_PAPER[item.color];
      this.body.append(card);
    }
    this.el.hidden = false;
    this.el.classList.remove('in');
    requestAnimationFrame(() => this.el.classList.add('in'));
    (this.el.querySelector('.pin-close') as HTMLElement | null)?.focus();
  }

  hide() { this.el.hidden = true; this.el.classList.remove('in'); }
}
