import { z } from 'zod';

export const SCHEMA_VERSION = 5;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a colour like #a1b2c3');
const id = z.string().min(1).regex(/^[a-z0-9][a-z0-9-_]*$/i, 'ids may contain letters, digits, - and _');

export const WALL_SIDES = ['north', 'east', 'south', 'west'] as const;
export type WallSide = (typeof WALL_SIDES)[number];

export const STYLE_IDS = ['pavilion', 'atrium', 'white-cube', 'classical-salon', 'industrial-loft', 'scandinavian', 'dark-museum'] as const;
export const LIGHTING_IDS = ['daylight', 'gallery-white', 'evening-spots', 'chiaroscuro', 'night-tour'] as const;
export const FOCUS_LAYOUTS = ['side-by-side', 'stacked', 'immersive', 'catalogue'] as const;
export const FRAME_IDS = ['style', 'none', 'thin-black', 'thin-white', 'oak', 'gilt', 'steel', 'float'] as const;
/** time of day outside: Toronto's real time, or a fixed one */
export const TIME_IDS = ['live', 'dawn', 'day', 'dusk', 'night'] as const;
/** weather outside: Toronto's current weather, or a fixed one */
export const WEATHER_IDS = ['live', 'clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const;
export const LANDSCAPE_IDS = ['lake', 'toronto'] as const;
/** instant-photo formats for pictures on a pinboard */
export const PIN_FORMATS = ['mini', 'square', 'wide'] as const;
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'white'] as const;
export type PinFormat = (typeof PIN_FORMATS)[number];
export type NoteColor = (typeof NOTE_COLORS)[number];
export type TimeId = (typeof TIME_IDS)[number];
export type WeatherId = (typeof WEATHER_IDS)[number];
export type Phase = Exclude<TimeId, 'live'>;
export type Weather = Exclude<WeatherId, 'live'>;
export type LandscapeId = (typeof LANDSCAPE_IDS)[number];

export type StyleId = (typeof STYLE_IDS)[number];
export type LightingId = (typeof LIGHTING_IDS)[number];
export type FocusLayout = (typeof FOCUS_LAYOUTS)[number];
export type FrameId = (typeof FRAME_IDS)[number];

export const ProvenanceEntry = z.object({
  date: z.string().optional(),
  event: z.string().min(1),
  note: z.string().optional(),
});

export const Artwork = z.object({
  id,
  /** path relative to the project folder, e.g. assets/mona-lisa.jpg */
  file: z.string().regex(/\.(jpe?g|png|svg)$/i, 'artwork files must be JPG, PNG or SVG'),
  title: z.string().min(1),
  artist: z.object({ name: z.string().min(1), life: z.string().optional(), nationality: z.string().optional() }),
  date: z.string().optional(),
  medium: z.string().optional(),
  /** real-world size in centimetres; drives true scale in 3D */
  dimensions: z.object({ width: z.number().positive(), height: z.number().positive(), depth: z.number().positive().optional() }).optional(),
  collection: z.string().optional(),
  credit: z.string().optional(),
  accession: z.string().optional(),
  provenance: z.array(ProvenanceEntry).default([]),
  source: z.string().url().optional(),
  rights: z.string().optional(),
  /** markdown */
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  frame: z.enum(FRAME_IDS).default('style'),
  mat: z.boolean().optional(),
  label: z.enum(['right', 'below']).default('right'),
  spotlight: z.object({ intensity: z.number().min(0).max(4).optional(), color: hex.optional() }).optional(),
});

export const Placement = z.object({
  artwork: id,
  /** manual centre position along the wall in metres, measured from the wall's left end as seen from inside */
  offset: z.number().optional(),
  /** manual centre-line height in metres */
  height: z.number().optional(),
  /** size relative to the other works (auto sizing), or extra scale on top of true size */
  scale: z.number().positive().max(5).optional(),
  /** on a wall divided by doors: which free stretch the work hangs on, counted from the left (0 = left of the first door). Unset: works fill the stretches in order */
  stretch: z.number().int().min(0).optional(),
});

export const Wall = z.object({
  artworks: z.array(Placement).default([]),
  hang: z.enum(['centred', 'salon', 'grid']).default('centred'),
  maxPerWall: z.number().int().positive().max(40).optional(),
  color: hex.optional(),
  /** picture windows on this wall (where it faces outdoors). Unset: bare outside walls get windows when environment.windows is on */
  windows: z.boolean().optional(),
});

export const Doorway = z.object({
  wall: z.enum(WALL_SIDES),
  /** centre along the wall from its left end (seen from inside), metres */
  offset: z.number().nonnegative(),
  width: z.number().positive().default(1.8),
});

const emptyWall = () => Wall.parse({});

/** where something is pinned: its centre as a fraction of the board (0 0 = top left), and how far it is turned, in degrees (clockwise). Unset: laid out automatically, a little askew */
const pinPlace = { x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), tilt: z.number().min(-180).max(180).optional() };
/** a picture shown as an instant photo, with a short line written on its white border */
export const PinPhoto = z.object({ id, kind: z.literal('photo'), file: z.string().min(1), format: z.enum(PIN_FORMATS).default('mini'), caption: z.string().max(60).optional(), ...pinPlace });
/** a paper note; the text is Markdown, so it can carry links */
export const PinNote = z.object({ id, kind: z.literal('note'), text: z.string().max(2000).default(''), color: z.enum(NOTE_COLORS).default('yellow'), ...pinPlace });
export const PinItem = z.discriminatedUnion('kind', [PinPhoto, PinNote]);
/** a cork board next to the room's door; visitors can move what is pinned to it */
export const Pinboard = z.object({ items: z.array(PinItem).max(60).default([]) });

export const Room = z.object({
  id,
  name: z.string().min(1),
  description: z.string().optional(),
  width: z.number().min(3).max(60).default(10),
  depth: z.number().min(3).max(60).default(8),
  height: z.number().min(2.6).max(12).default(4),
  wallColor: hex.optional(),
  /** used only when layout.mode = custom; room centre in metres */
  position: z.object({ x: z.number(), z: z.number() }).optional(),
  /** potted plants placed by hand, in metres from the room's centre (x east, z south); `size` 1 is about 1.3 m tall. Unset: plants are placed automatically */
  plants: z.array(z.object({ x: z.number(), z: z.number(), size: z.number().min(0.4).max(2.5).optional() })).max(40).optional(),
  /** a pinboard next to the room's door, with instant photos and notes */
  pinboard: Pinboard.optional(),
  /** optional explicit doorways; when omitted, doorways are generated between neighbouring rooms */
  doorways: z.array(Doorway).optional(),
  walls: z
    .object({ north: Wall.default(emptyWall), east: Wall.default(emptyWall), south: Wall.default(emptyWall), west: Wall.default(emptyWall) })
    .default(() => ({ north: emptyWall(), east: emptyWall(), south: emptyWall(), west: emptyWall() })),
});

export const StyleOverrides = z
  .object({
    wall: hex.optional(),
    floor: hex.optional(),
    ceiling: hex.optional(),
    trim: hex.optional(),
    labelBackground: hex.optional(),
    labelText: hex.optional(),
    accent: hex.optional(),
    frame: z.enum(FRAME_IDS).optional(),
  })
  .default({});

export const LightingOverrides = z
  .object({
    ambient: z.number().min(0).max(3).optional(),
    spot: z.number().min(0).max(4).optional(),
    spotColor: hex.optional(),
    warmth: z.number().min(-1).max(1).optional(),
  })
  .default({});

export const Gallery = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  /** markdown shown on the welcome screen */
  intro: z.string().optional(),
  locale: z.string().default('en'),
  basePath: z.string().default('./'),
  style: z.object({ preset: z.enum(STYLE_IDS).default('industrial-loft'), overrides: StyleOverrides }).default(() => ({ preset: 'industrial-loft' as const, overrides: {} })),
  lighting: z
    .object({ scenario: z.enum(LIGHTING_IDS).default('daylight'), overrides: LightingOverrides, allowVisitorChoice: z.boolean().default(true) })
    .default(() => ({ scenario: 'daylight' as const, overrides: {}, allowVisitorChoice: true })),
  layout: z
    .object({ mode: z.enum(['linear', 'grid', 'custom']).default('linear'), columns: z.number().int().min(1).max(10).default(2), gap: z.number().min(0.3).max(10).default(0.4) })
    .default(() => ({ mode: 'linear' as const, columns: 2, gap: 0.4 })),
  focus: z
    .object({ defaultLayout: z.enum(FOCUS_LAYOUTS).default('side-by-side'), layouts: z.array(z.enum(FOCUS_LAYOUTS)).min(1).default([...FOCUS_LAYOUTS]) })
    .default(() => ({ defaultLayout: 'side-by-side' as const, layouts: [...FOCUS_LAYOUTS] })),
  /** how large works, frames and wall labels appear, relative to true size */
  display: z
    .object({
      /** auto: works are sized to suit the wall and the number of works on it; true: real dimensions (cm) times artScale */
      sizing: z.enum(['auto', 'true']).default('auto'),
      /** extra scale on every work (true size often reads small in a virtual room) */
      artScale: z.number().min(0.5).max(3).default(1.2),
      /** scale on frame mouldings and mats */
      frameScale: z.number().min(0.5).max(3).default(1.6),
      /** scale on the wall labels */
      labelScale: z.number().min(0.5).max(3).default(1.35),
      /** show each work's source link to visitors; off: the links stay in the project and are left out of the built site */
      sourceLinks: z.boolean().default(true),
    })
    .default(() => ({ sizing: 'auto' as const, artScale: 1.2, frameScale: 1.6, labelScale: 1.35, sourceLinks: true })),
  /** what lies around and above the rooms */
  environment: z
    .object({
      /** time of day outside; live follows the sun in Toronto (worked out in the browser) */
      time: z.enum(TIME_IDS).default('live'),
      /** weather outside; live asks Environment Canada for Toronto's current conditions (a third-party request from the visitor's browser) */
      weather: z.enum(WEATHER_IDS).default('live'),
      /** glazed roof lantern in the middle of every room */
      skylights: z.boolean().default(true),
      /** picture windows on outside walls that carry no art */
      windows: z.boolean().default(true),
      /** scenery outside the building: a lake shore, or the Toronto skyline across the lake */
      landscape: z.enum(LANDSCAPE_IDS).default('lake'),
      /** potted plants in room corners */
      plants: z.boolean().default(true),
    })
    .default(() => ({ time: 'live' as const, weather: 'live' as const, skylights: true, windows: true, landscape: 'lake' as const, plants: true })),
  /** what visitors see first: the 3D gallery (after the welcome screen) or the 2D portfolio grid */
  startIn: z.enum(['gallery', 'portfolio']).default('gallery'),
  /** links to other web pages, shown as a menu bar in the gallery and the portfolio */
  menu: z
    .array(z.object({ label: z.string().trim().min(1, 'give the link a label').max(40), url: z.string().url('enter a full web address, e.g. https://example.org') }))
    .max(8)
    .default([]),
  /** an email address; the menu bar ends with a "Contact" link that writes to it ("Kontakt" when the locale is German) */
  contact: z.email('enter an email address, e.g. name@example.org').optional(),
  /** the web address the gallery is published at, e.g. https://example.org/gallery/. Needed for the preview that social networks and messengers show for a link: they only load a picture given by its full address */
  url: z.string().url('enter a full web address, e.g. https://example.org/gallery/').optional(),
  /** the work whose picture that preview shows (its id); unset: the first work */
  shareImage: id.optional(),
  /** the entry door: a door in the first room that leads out to a web page when clicked */
  entrance: z
    .object({
      enabled: z.boolean().default(true),
      url: z.string().url().default('https://primbs.ca'),
      /** which wall of the first room; unset: a wall without windows or doorways, the south wall first */
      wall: z.enum(WALL_SIDES).optional(),
    })
    .default(() => ({ enabled: true, url: 'https://primbs.ca' })),
  /** how the visitor gets around (always in first person) */
  navigation: z
    .object({
      /** right-click / long-press teleport with an arc */
      teleport: z.boolean().default(true),
      /** slowly orbit the first room behind the entry screen */
      lobbyOrbit: z.boolean().default(true),
    })
    .default(() => ({ teleport: true, lobbyOrbit: true })),
  artworks: z.array(Artwork).default([]),
  rooms: z.array(Room).min(1),
});

export type ProvenanceEntry = z.infer<typeof ProvenanceEntry>;
export type Artwork = z.infer<typeof Artwork>;
export type Placement = z.infer<typeof Placement>;
export type Wall = z.infer<typeof Wall>;
export type Doorway = z.infer<typeof Doorway>;
export type PinPhoto = z.infer<typeof PinPhoto>;
export type PinNote = z.infer<typeof PinNote>;
export type PinItem = z.infer<typeof PinItem>;
export type Pinboard = z.infer<typeof Pinboard>;
export type Room = z.infer<typeof Room>;
export type Gallery = z.infer<typeof Gallery>;
export type GalleryInput = z.input<typeof Gallery>;

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Cross-reference checks that zod can't express. */
function referentialIssues(g: Gallery): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  g.artworks.forEach((a, i) => {
    if (seen.has(a.id)) issues.push({ path: `artworks.${i}.id`, message: `duplicate artwork id "${a.id}"`, severity: 'error' });
    seen.add(a.id);
  });
  const roomIds = new Set<string>();
  const hung = new Set<string>();
  g.rooms.forEach((r, ri) => {
    if (roomIds.has(r.id)) issues.push({ path: `rooms.${ri}.id`, message: `duplicate room id "${r.id}"`, severity: 'error' });
    roomIds.add(r.id);
    for (const side of WALL_SIDES) {
      const wall = r.walls[side];
      wall.artworks.forEach((p, pi) => {
        if (!seen.has(p.artwork)) issues.push({ path: `rooms.${ri}.walls.${side}.artworks.${pi}.artwork`, message: `unknown artwork "${p.artwork}"`, severity: 'error' });
        else if (hung.has(p.artwork)) issues.push({ path: `rooms.${ri}.walls.${side}.artworks.${pi}.artwork`, message: `"${p.artwork}" is hung more than once`, severity: 'warning' });
        hung.add(p.artwork);
      });
      if (wall.maxPerWall && wall.artworks.length > wall.maxPerWall)
        issues.push({ path: `rooms.${ri}.walls.${side}.artworks`, message: `${wall.artworks.length} works exceed maxPerWall (${wall.maxPerWall})`, severity: 'error' });
    }
    if (g.layout.mode === 'custom' && !r.position) issues.push({ path: `rooms.${ri}.position`, message: 'custom layout needs a room position', severity: 'error' });
  });
  g.artworks.forEach((a, i) => {
    if (!hung.has(a.id)) issues.push({ path: `artworks.${i}`, message: `"${a.title}" is not hung on any wall (portfolio only)`, severity: 'warning' });
    if (!a.provenance.length) issues.push({ path: `artworks.${i}.provenance`, message: `"${a.title}" has no provenance entries`, severity: 'warning' });
    if (!a.dimensions && g.display.sizing === 'true') issues.push({ path: `artworks.${i}.dimensions`, message: `"${a.title}" has no dimensions; size will be guessed`, severity: 'warning' });
  });
  if (!g.focus.layouts.includes(g.focus.defaultLayout))
    issues.push({ path: 'focus.defaultLayout', message: 'default focus layout must be one of the allowed layouts', severity: 'error' });
  return issues;
}

export interface ParseResult {
  gallery?: Gallery;
  issues: ValidationIssue[];
  ok: boolean;
}

export function parseGallery(input: unknown): ParseResult {
  const res = Gallery.safeParse(input);
  if (!res.success) {
    return {
      ok: false,
      issues: res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, severity: 'error' as const })),
    };
  }
  const issues = referentialIssues(res.data);
  return { gallery: res.data, issues, ok: !issues.some((i) => i.severity === 'error') };
}
