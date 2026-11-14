import type { SiteData } from '@vernissage/schema';
import { h } from '../dom';

/**
 * The site's menu bar: links to other web pages, the same in the gallery and the portfolio. On wide screens the
 * links sit in a row at the top; on narrow ones they fold into a "Menu" button. Links leave the whole page,
 * also when the gallery is embedded in another site. If the gallery has a contact address, the bar ends with
 * a "Contact" link that opens an email to it.
 */
export function siteMenu(data: SiteData): HTMLElement | null {
  const { menu, contact, locale } = data.gallery;
  const links: Array<{ label: string; url: string }> = [...menu];
  if (contact) links.push({ label: /^de\b/i.test(locale) ? 'Kontakt' : 'Contact', url: `mailto:${contact}` });
  if (!links.length) return null;
  // an email link opens the mail program and leaves the page where it is
  const a = (l: { label: string; url: string }) =>
    l.url.startsWith('mailto:') ? h('a', { href: l.url }, l.label) : h('a', { href: l.url, target: '_top', rel: 'noopener' }, l.label);
  const row = h('ul', { class: 'site-menu-links' }, links.map((l) => h('li', {}, a(l))));
  const fold = h('details', { class: 'site-menu-fold' },
    h('summary', { 'aria-label': 'Menu' }, h('span', { 'aria-hidden': 'true' }, '☰'), ' Menu'),
    h('ul', {}, links.map((l) => h('li', {}, a(l)))));
  // a click anywhere else closes the folded menu
  document.addEventListener('pointerdown', (e) => { if (!fold.contains(e.target as Node)) fold.open = false; });
  return h('nav', { class: 'site-menu', 'aria-label': 'Site' }, row, fold);
}
