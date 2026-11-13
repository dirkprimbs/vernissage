import { describe, expect, it } from 'vitest';
import { moonAge, phaseOf, sunPosition, torontoHour, weatherFromText } from '../src';

describe('sunPosition (Toronto)', () => {
  // Environment Canada gave sunrise 12:09 UTC and sunset 21:54 UTC for 13 November 2026
  it('is on the horizon at sunrise and sunset', () => {
    const rise = sunPosition(Date.UTC(2026, 10, 13, 12, 9));
    const set = sunPosition(Date.UTC(2026, 10, 13, 21, 54));
    expect(Math.abs(rise.elevation + 0.83)).toBeLessThan(1);
    expect(Math.abs(set.elevation + 0.83)).toBeLessThan(1);
    expect(rise.azimuth).toBeGreaterThan(100); expect(rise.azimuth).toBeLessThan(125); // east-south-east in November
    expect(set.azimuth).toBeGreaterThan(235); expect(set.azimuth).toBeLessThan(260);
  });
  it('stands due south at solar noon, at the height the latitude and season give', () => {
    const noon = sunPosition(Date.UTC(2026, 10, 13, 17, 1, 30));
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(2);
    expect(Math.abs(noon.elevation - 28.3)).toBeLessThan(1);
    const june = sunPosition(Date.UTC(2026, 5, 21, 17, 19));
    expect(Math.abs(june.elevation - 69.8)).toBeLessThan(1);
  });
  it('is well below the horizon at local midnight', () => {
    expect(sunPosition(Date.UTC(2026, 10, 13, 5, 0)).elevation).toBeLessThan(-50);
  });
});

describe('phaseOf', () => {
  it('names the time of day', () => {
    expect(phaseOf({ elevation: 40, azimuth: 180 })).toBe('day');
    expect(phaseOf({ elevation: -30, azimuth: 0 })).toBe('night');
    expect(phaseOf({ elevation: 0, azimuth: 110 })).toBe('dawn');
    expect(phaseOf({ elevation: 0, azimuth: 250 })).toBe('dusk');
  });
});

describe('weatherFromText', () => {
  it('maps Environment Canada conditions to six looks', () => {
    const cases: Array<[string, string]> = [
      ['Sunny', 'clear'], ['Mainly Sunny', 'clear'], ['Partly Cloudy', 'clear'], ['A few clouds', 'clear'], ['Clear', 'clear'],
      ['Mostly Cloudy', 'cloudy'], ['Cloudy', 'cloudy'], ['Overcast', 'cloudy'],
      ['Light Rain', 'rain'], ['Drizzle', 'rain'], ['Light Rainshower', 'rain'],
      ['Thunderstorm with light rainshowers', 'storm'],
      ['Light Snow', 'snow'], ['Flurries', 'snow'], ['Freezing Rain', 'snow'], ['Ice Pellets', 'snow'],
      ['Fog', 'fog'], ['Mist', 'fog'], ['Haze', 'fog'],
    ];
    for (const [text, look] of cases) expect(weatherFromText(text), text).toBe(look);
    expect(weatherFromText(undefined)).toBe('clear');
  });
});

describe('moonAge', () => {
  it('is near 0 at a known new moon and near 0.5 at a full moon', () => {
    const nu = moonAge(Date.UTC(2024, 3, 8, 18, 21)); // new moon (the April 2024 eclipse)
    expect(Math.min(nu, 1 - nu)).toBeLessThan(0.02);
    expect(Math.abs(moonAge(Date.UTC(2024, 3, 23, 23, 49)) - 0.5)).toBeLessThan(0.02);
  });
});

describe('torontoHour', () => {
  it("reads Toronto's clock, with and without daylight saving time", () => {
    expect(torontoHour(Date.UTC(2026, 10, 13, 17, 0))).toBe(12); // EST, UTC−5
    expect(torontoHour(Date.UTC(2026, 6, 1, 16, 30))).toBe(12.5); // EDT, UTC−4
    expect(torontoHour(Date.UTC(2026, 10, 14, 4, 15))).toBe(23.25); // late evening, already the next day in UTC
    expect(torontoHour(Date.UTC(2026, 10, 14, 5, 0))).toBe(0);
  });
});
