import { describe, expect, it } from 'vitest';
import { parseGallery, migrate, publishedGallery } from '../src';
import { art, twoRooms } from './fixtures';

describe('parseGallery', () => {
  it('fills defaults', () => {
    const r = parseGallery(twoRooms());
    expect(r.ok).toBe(true);
    expect(r.gallery!.style.preset).toBe('industrial-loft');
    expect(r.gallery!.lighting.scenario).toBe('daylight');
    expect(r.gallery!.rooms[1].walls.north.artworks).toEqual([]);
    expect(r.gallery!.rooms[0].height).toBe(4);
  });

  it('defaults the navigation options', () => {
    const g = parseGallery(twoRooms()).gallery!;
    expect(g.navigation).toEqual({ teleport: true, lobbyOrbit: true });
    const p = parseGallery({ ...twoRooms(), style: { preset: 'pavilion' }, navigation: { teleport: false } }).gallery!;
    expect(p.style.preset).toBe('pavilion');
    expect(p.navigation).toEqual({ teleport: false, lobbyOrbit: true });
  });

  it('fills display and environment defaults', () => {
    const g = parseGallery(twoRooms()).gallery!;
    expect(g.display).toEqual({ sizing: 'auto', artScale: 1.2, frameScale: 1.6, labelScale: 1.35, sourceLinks: true });
    expect(g.environment).toEqual({ time: 'live', weather: 'live', skylights: true, windows: true, landscape: 'lake', plants: true });
  });

  it('reports schema errors with paths', () => {
    const g: any = twoRooms();
    g.artworks[0].file = 'x.gif';
    const r = parseGallery(g);
    expect(r.ok).toBe(false);
    expect(r.issues[0].path).toBe('artworks.0.file');
  });

  it('reports unknown and duplicate references', () => {
    const g: any = twoRooms();
    g.rooms[0].walls.north.artworks.push({ artwork: 'nope' }, { artwork: 'a' });
    g.artworks.push(art('a'));
    const r = parseGallery(g);
    expect(r.ok).toBe(false);
    const msgs = r.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/unknown artwork "nope"/);
    expect(msgs).toMatch(/duplicate artwork id "a"/);
    expect(msgs).toMatch(/hung more than once/);
  });

  it('enforces maxPerWall', () => {
    const g: any = twoRooms();
    g.rooms[0].walls.north.maxPerWall = 1;
    expect(parseGallery(g).issues.some((i) => /maxPerWall/.test(i.message))).toBe(true);
  });

  it('warns about unhung works and missing provenance', () => {
    const g: any = twoRooms();
    g.artworks.push({ ...art('loose'), provenance: [] });
    const r = parseGallery(g);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.severity === 'warning').length).toBeGreaterThanOrEqual(2);
  });
});

describe('migrate', () => {
  it('upgrades v0 wallsArt', () => {
    const g: any = twoRooms();
    g.rooms[0].wallsArt = { north: ['a'] };
    delete g.rooms[0].walls;
    const m: any = migrate(g);
    expect(m.schemaVersion).toBe(5);
    expect(m.rooms[0].walls.north.artworks).toEqual([{ artwork: 'a' }]);
    expect(parseGallery(m).ok).toBe(true);
  });
  it('upgrades v1: drops avatars, name tags and reactions, keeps teleport and lobby orbit', () => {
    const g: any = { ...twoRooms(), schemaVersion: 1, avatar: { default: 'curator', startView: 'third' }, social: { nameTags: true, reactions: false, teleport: false, lobbyOrbit: true } };
    const m: any = migrate(g);
    expect(m.schemaVersion).toBe(5);
    expect(m.avatar).toBeUndefined();
    expect(m.social).toBeUndefined();
    expect(m.navigation).toEqual({ teleport: false, lobbyOrbit: true });
    expect(parseGallery(m).gallery!.navigation.teleport).toBe(false);
  });
  it('upgrades v2: retired landscapes become the lake shore, the skyline stays', () => {
    for (const [from, to] of [['meadow', 'lake'], ['cliffs', 'lake'], ['crater', 'lake'], ['none', 'lake'], ['toronto', 'toronto']]) {
      const m: any = migrate({ ...twoRooms(), schemaVersion: 2, environment: { landscape: from } });
      expect(m.environment.landscape, from).toBe(to);
      expect(parseGallery(m).ok).toBe(true);
    }
  });
  it('upgrades v3: a fixed sky becomes a time of day and a weather', () => {
    const cases: Array<[string, string, string]> = [['golden', 'dusk', 'clear'], ['overcast', 'day', 'cloudy'], ['night', 'night', 'clear'], ['auto', 'live', 'live']];
    for (const [sky, time, weather] of cases) {
      const m: any = migrate({ ...twoRooms(), schemaVersion: 3, environment: { sky, landscape: 'toronto' } });
      const g = parseGallery(m).gallery!;
      expect([g.environment.time, g.environment.weather], sky).toEqual([time, weather]);
      expect(g.environment.landscape).toBe('toronto');
    }
  });
  it('upgrades v4: older galleries keep true-size hanging and get no entry door', () => {
    const g = parseGallery(migrate({ ...twoRooms(), schemaVersion: 4 })).gallery!;
    expect(g.display.sizing).toBe('true');
    expect(g.entrance.enabled).toBe(false);
    const fresh = parseGallery(twoRooms()).gallery!;
    expect(fresh.display.sizing).toBe('auto');
    expect(fresh.entrance).toEqual({ enabled: true, url: 'https://primbs.ca' });
  });
  it('opens in the gallery by default and checks menu links', () => {
    const g = parseGallery(twoRooms()).gallery!;
    expect(g.startIn).toBe('gallery');
    expect(g.menu).toEqual([]);
    const ok = parseGallery({ ...twoRooms(), startIn: 'portfolio', menu: [{ label: 'Home', url: 'https://primbs.ca' }] });
    expect(ok.ok).toBe(true);
    expect(ok.gallery!.startIn).toBe('portfolio');
    const bad = parseGallery({ ...twoRooms(), menu: [{ label: ' ', url: 'primbs.ca' }] });
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.path).sort()).toEqual(['menu.0.label', 'menu.0.url']);
  });
  it('takes an optional contact address and checks it', () => {
    expect(parseGallery(twoRooms()).gallery!.contact).toBeUndefined();
    expect(parseGallery({ ...twoRooms(), contact: 'someone@example.org' }).gallery!.contact).toBe('someone@example.org');
    const bad = parseGallery({ ...twoRooms(), contact: 'not an address' });
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.path)).toEqual(['contact']);
  });
  it('keeps source links unless the gallery hides them', () => {
    const raw = twoRooms();
    raw.artworks![0].source = 'https://example.org/work';
    const shown = parseGallery(raw).gallery!;
    expect(shown.display.sourceLinks).toBe(true);
    expect(publishedGallery(shown).artworks[0].source).toBe('https://example.org/work');
    const hidden = parseGallery({ ...raw, display: { sourceLinks: false } }).gallery!;
    expect(JSON.stringify(publishedGallery(hidden))).not.toContain('example.org/work');
    expect(hidden.artworks[0].source).toBe('https://example.org/work'); // the project itself keeps it
  });
  it('rejects newer files', () => {
    expect(() => migrate({ schemaVersion: 99 })).toThrow(/v99/);
  });
});
