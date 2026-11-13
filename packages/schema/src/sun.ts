import type { Phase, Weather } from './model';

/** The gallery's sky is Toronto's: downtown, by the harbour. */
export const TORONTO = { lat: 43.6426, lon: -79.3871, name: 'Toronto' };

/** Environment and Climate Change Canada's city page for Toronto (GeoMet API; sends CORS headers). */
export const WEATHER_URL = 'https://api.weather.gc.ca/collections/citypageweather-realtime/items/on-143?f=json';
export const WEATHER_CREDIT = 'Environment and Climate Change Canada';

export interface SunPosition {
  /** degrees above the horizon (negative: below) */
  elevation: number;
  /** degrees clockwise from north */
  azimuth: number;
}

const RAD = Math.PI / 180;

/** Where the sun stands at a moment (ms since epoch) for a place; good to about a degree. */
export function sunPosition(when: number, lat = TORONTO.lat, lon = TORONTO.lon): SunPosition {
  const d = new Date(when);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const day = (when - start) / 864e5; // fractional day of the year
  const g = (2 * Math.PI / 365) * (day - 1);
  // equation of time (minutes) and declination (radians), Spencer's series
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
  const solarMin = utcMin + eot + 4 * lon; // true solar time in minutes
  const ha = (solarMin / 4 - 180) * RAD; // hour angle
  const la = lat * RAD;
  const sinEl = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) + Math.PI;
  return { elevation: el / RAD, azimuth: ((az / RAD) % 360 + 360) % 360 };
}

/** A typical sun position for a chosen time of day (used when the time is not live). */
export const PHASE_SUN: Record<Phase, SunPosition> = {
  dawn: { elevation: -1, azimuth: 95 },
  day: { elevation: 46, azimuth: 165 },
  dusk: { elevation: -1, azimuth: 262 },
  night: { elevation: -32, azimuth: 330 },
};

/** A typical hour on the clock for a chosen time of day (used when the time is not live). */
export const PHASE_HOUR: Record<Phase, number> = { dawn: 6.75, day: 13, dusk: 18.5, night: 1 };

/** The time of day in Toronto as a fractional hour (0 to 24), daylight saving time included. */
export function torontoHour(when: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(when));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') + get('minute') / 60;
}

/** Name the time of day for a sun position. Twilight is dawn before solar noon and dusk after. */
export function phaseOf(sun: SunPosition): Phase {
  if (sun.elevation > 7) return 'day';
  if (sun.elevation < -7) return 'night';
  return sun.azimuth < 180 ? 'dawn' : 'dusk';
}

/** Environment Canada's condition text ("Light Snow", "Mostly Cloudy", …) as one of six looks. */
export function weatherFromText(text: string | undefined | null): Weather {
  const t = (text ?? '').toLowerCase();
  if (/thunder|lightning/.test(t)) return 'storm';
  if (/snow|flurr|ice|blizzard|hail|freezing/.test(t)) return 'snow';
  if (/rain|drizzle|shower|precipitation/.test(t)) return 'rain';
  if (/fog|mist|haze|smoke/.test(t)) return 'fog';
  if (/cloud|overcast/.test(t) && !/partly|mainly (sunny|clear)|a few/.test(t)) return 'cloudy';
  return 'clear';
}

/** The moon's age as a fraction of the lunar month: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonAge(when: number): number {
  const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14), MONTH = 29.530588853 * 864e5;
  return ((((when - NEW_MOON) % MONTH) + MONTH) % MONTH) / MONTH;
}
