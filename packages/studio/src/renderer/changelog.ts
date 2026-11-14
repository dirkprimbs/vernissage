// The studio's version and "what's new". CHANGELOG.md (at the repository root) is bundled with the studio:
// someone opening a newer version sees the entries they have not seen yet, once, and the version next to the
// studio's name opens the whole changelog.

export interface Entry { version: string; date: string; title: string; items: string[] }

/** People who used the studio before it kept track have seen at least this version. */
export const BEFORE_NEWS = '0.5.0';

/** Entries from "## 1.2.0 — 2026-11-14 — Title" headings (— or · between the parts) and their "- " items, newest first. */
export function parseChangelog(md: string): Entry[] {
  const out: Entry[] = [];
  for (const line of md.split('\n')) {
    const head = /^##\s+(\d+\.\d+\.\d+)\s*(?:[—·]\s*([^—·]+?))?\s*(?:[—·]\s*(.+?))?\s*$/.exec(line);
    if (head) out.push({ version: head[1], date: head[2] ?? '', title: head[3] ?? '', items: [] });
    else if (/^-\s+/.test(line) && out.length) out[out.length - 1].items.push(line.replace(/^-\s+/, ''));
    else if (/^\s+\S/.test(line) && out.length && out[out.length - 1].items.length) {
      const items = out[out.length - 1].items; // a wrapped item continues
      items[items.length - 1] += ' ' + line.trim();
    }
  }
  return out;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * What to show when the studio opens: nothing the first time it is ever used, otherwise every entry newer than
 * the version seen last (up to the running one).
 */
export function whatsNew(entries: Entry[], seen: string | null | undefined, returning: boolean, current: string): Entry[] {
  const since = seen ?? (returning ? BEFORE_NEWS : null);
  if (!since) return [];
  return entries.filter((e) => compareVersions(e.version, since) > 0 && compareVersions(e.version, current) <= 0);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** an item's bold, italics and code as HTML; everything else is escaped */
export function inline(s: string): string {
  return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}
