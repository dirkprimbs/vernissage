import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BEFORE_NEWS, compareVersions, inline, parseChangelog, whatsNew } from '../src/renderer/changelog';
import { GENERATOR } from '../../generator/src';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const md = read('../../../CHANGELOG.md');
const version = (p: string) => JSON.parse(read(p)).version as string;

describe('changelog', () => {
  const entries = parseChangelog(md);

  it('has an entry for the current version, newest first, and the version agrees everywhere', () => {
    expect(entries[0].version).toBe(version('../../../package.json'));
    expect(version('../package.json')).toBe(entries[0].version);
    expect(GENERATOR).toBe(`Vernissage ${entries[0].version}`);
    expect(entries[0].items.length).toBeGreaterThan(0);
    for (let i = 1; i < entries.length; i++) expect(compareVersions(entries[i - 1].version, entries[i].version)).toBeGreaterThan(0);
    for (const e of entries) expect(e.items.length).toBeGreaterThan(0);
  });

  it('parses headings with either separator, and wrapped items', () => {
    const e = parseChangelog('## 2.1.0 — 2026-12-01 — Big\n\n- one\n  more\n- two\n## 2.0.0 · 2026-11-30\n- old\n## 1.9.0\n- older');
    expect(e).toEqual([
      { version: '2.1.0', date: '2026-12-01', title: 'Big', items: ['one more', 'two'] },
      { version: '2.0.0', date: '2026-11-30', title: '', items: ['old'] },
      { version: '1.9.0', date: '', title: '', items: ['older'] },
    ]);
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('shows nothing the first time, the unseen entries after an update', () => {
    const e = parseChangelog('## 1.2.0\n- c\n## 1.1.0\n- b\n## 1.0.0\n- a\n## 0.5.0\n- before\n## 0.4.0\n- long ago');
    expect(whatsNew(e, null, false, '1.2.0')).toEqual([]);
    expect(whatsNew(e, '1.2.0', true, '1.2.0')).toEqual([]);
    expect(whatsNew(e, '1.0.0', true, '1.2.0').map((x) => x.version)).toEqual(['1.2.0', '1.1.0']);
    expect(whatsNew(e, '1.0.0', true, '1.1.0').map((x) => x.version)).toEqual(['1.1.0']);
    // someone who used the studio before it kept track starts from the last version without news
    expect(BEFORE_NEWS).toBe('0.5.0');
    expect(whatsNew(e, null, true, '1.2.0').map((x) => x.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
  });

  it('marks up emphasis and escapes the rest', () => {
    expect(inline('**Bold:** a `<b>` tag & *more*')).toBe('<b>Bold:</b> a <code>&lt;b&gt;</code> tag &amp; <i>more</i>');
  });
});
