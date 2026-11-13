import { SCHEMA_VERSION } from './model';

/** Upgrade older project files in place. Each step takes version n to n+1. */
const steps: Record<number, (g: any) => any> = {
  // 0 → 1: pre-release files had no schemaVersion and used `wallsArt` arrays directly on rooms
  0: (g) => {
    for (const r of g.rooms ?? []) {
      if (r.wallsArt && !r.walls) {
        r.walls = Object.fromEntries(Object.entries(r.wallsArt).map(([side, ids]) => [side, { artworks: (ids as string[]).map((artwork) => ({ artwork })) }]));
        delete r.wallsArt;
      }
    }
    return { ...g, schemaVersion: 1 };
  },
  // 1 → 2: avatars, name tags and reactions were removed (visitors are always in first person);
  // the remaining `social` options moved to `navigation`
  1: (g) => {
    const { avatar: _avatar, social, ...rest } = g;
    const navigation = social ? Object.fromEntries(Object.entries(social).filter(([k]) => k === 'teleport' || k === 'lobbyOrbit')) : undefined;
    return { ...rest, ...(navigation && Object.keys(navigation).length ? { navigation } : {}), schemaVersion: 2 };
  },
  // 2 → 3: the outdoor scenery is now a lake shore or the Toronto skyline; meadow, cliffs, crater and none become the lake shore
  2: (g) => {
    const env = g.environment;
    if (env && env.landscape !== undefined && env.landscape !== 'lake' && env.landscape !== 'toronto') env.landscape = 'lake';
    return { ...g, schemaVersion: 3 };
  },
  // 3 → 4: the fixed `sky` became a time of day and a weather, both live by default
  3: (g) => {
    const env = g.environment;
    if (env && 'sky' in env) {
      const map: Record<string, [string, string]> = { clear: ['day', 'clear'], golden: ['dusk', 'clear'], overcast: ['day', 'cloudy'], night: ['night', 'clear'] };
      const m = map[env.sky];
      if (m) { env.time = m[0]; env.weather = m[1]; }
      delete env.sky;
    }
    return { ...g, schemaVersion: 4 };
  },
  // 4 → 5: older galleries keep what they had: true-size hanging and no entry door
  4: (g) => ({
    ...g,
    display: { sizing: 'true', ...(g.display ?? {}) },
    entrance: g.entrance ?? { enabled: false },
    schemaVersion: 5,
  }),
};

export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let g: any = structuredClone(raw);
  let v: number = typeof g.schemaVersion === 'number' ? g.schemaVersion : 0;
  if (v > SCHEMA_VERSION) throw new Error(`project uses schema v${v}, this Vernissage understands up to v${SCHEMA_VERSION}`);
  while (v < SCHEMA_VERSION) { g = steps[v](g); v++; }
  return g;
}
