import {
  PHASE_HOUR, PHASE_SUN, WEATHER_URL, phaseOf, sunPosition, torontoHour, weatherFromText,
  type Phase, type SunPosition, type TimeId, type Weather, type WeatherId,
} from '@vernissage/schema';

export interface ConditionsChoice { time: TimeId; weather: WeatherId }

export interface ConditionsNow {
  sun: SunPosition;
  phase: Phase;
  /** the hour on Toronto's clock (0–24): the real one, or a typical one for a chosen time of day */
  hour: number;
  weather: Weather;
  /** what Toronto reports right now, when it has been asked: "4 °C, Light Snow" */
  report?: string;
  /** the live weather could not be fetched */
  failed: boolean;
}

const REFRESH = 15 * 60e3;

/**
 * The conditions outside: Toronto's sun, worked out here from the clock, and Toronto's weather, asked from
 * Environment Canada every 15 minutes, but only while the weather is set to "live". Either can be fixed instead.
 */
export class Conditions {
  private liveWeather: Weather = 'clear';
  private report?: string;
  private failed = false;
  private fetched = 0;
  private timer?: number;
  private busy = false;

  constructor(public choice: ConditionsChoice, private onChange: (now: ConditionsNow) => void) {}

  now(): ConditionsNow {
    const sun = this.choice.time === 'live' ? sunPosition(Date.now()) : PHASE_SUN[this.choice.time];
    return {
      sun, phase: this.choice.time === 'live' ? phaseOf(sun) : this.choice.time,
      hour: this.choice.time === 'live' ? torontoHour(Date.now()) : PHASE_HOUR[this.choice.time],
      weather: this.choice.weather === 'live' ? this.liveWeather : this.choice.weather,
      report: this.report, failed: this.failed,
    };
  }

  start() {
    // the sun moves a quarter of a degree a minute; the weather is re-read when it is stale
    this.timer = window.setInterval(() => this.tick(), 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
    this.tick();
  }

  set(choice: ConditionsChoice) {
    this.choice = choice;
    this.tick();
  }

  private tick() {
    if (this.choice.weather === 'live' && !document.hidden && Date.now() - this.fetched > REFRESH) void this.fetchWeather();
    this.onChange(this.now());
  }

  private async fetchWeather() {
    if (this.busy) return;
    this.busy = true;
    this.fetched = Date.now();
    try {
      const res = await fetch(WEATHER_URL, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const p = (await res.json()).properties;
      const cc = p?.currentConditions ?? {};
      const text: string | undefined = cc.condition?.en;
      const temp = cc.temperature?.value?.en;
      this.liveWeather = weatherFromText(text);
      this.report = [temp !== undefined && temp !== null && temp !== '' && !isNaN(Number(temp)) ? `${Math.round(Number(temp))} °C` : '', text ?? ''].filter(Boolean).join(', ') || undefined;
      this.failed = false;
    } catch {
      // blocked or offline: the sky stays clear and follows the time of day
      this.failed = true;
      this.fetched = Date.now() - REFRESH + 2 * 60e3; // try again in a couple of minutes
    }
    this.busy = false;
    this.onChange(this.now());
  }
}
