import type { SiteData } from '@vernissage/schema';
import { h } from '../dom';

/**
 * The site's menu bar: links to other web pages, the same in the gallery and the portfolio. On wide screens the
 * links sit in a row at the top; on narrow ones they fold into a "Menu" button. Links leave the whole page,
 * also when the gallery is embedded in another site.
 */
export function siteMenu(data: SiteData): HTMLElement | null {
  const links = data.gallery.menu;
  if (!links.length) return null;
  const a = (l: { label: string; url: string }) => h('a', { href: l.url, target: '_top', rel: 'noopener' }, l.label);
  const row = h('ul', { class: 'site-menu-links' }, links.map((l) => h('li', {}, a(l))));
  const fold = h('details', { class: 'site-menu-fold' },
    h('summary', { 'aria-label': 'Menu' }, h('span', { 'aria-hidden': 'true' }, '☰'), ' Menu'),
    h('ul', {}, links.map((l) => h('li', {}, a(l)))));
  // a click anywhere else closes the folded menu
  document.addEventListener('pointerdown', (e) => { if (!fold.contains(e.target as Node)) fold.open = false; });
  return h('nav', { class: 'site-menu', 'aria-label': 'Site' }, row, fold);
}
