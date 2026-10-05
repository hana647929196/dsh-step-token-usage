/**
 * Host half of the per-step token usage bundle: the dynamic price book.
 *
 * The Client half renders token counts the provider already reported on each
 * durable `assistant/message` event. Turning those counts into money needs two
 * facts the Client cannot own:
 *
 *   1. **Unit prices.** DeepSeek publishes no pricing JSON, and prices change
 *      without this plugin shipping a release, so the numbers are fetched and
 *      normalised at run time rather than compiled in.
 *   2. **The peak / off-peak classification.** Money is not a function of token
 *      counts alone: the same step costs double when it lands in a peak window.
 *      Deciding that needs the provider's published time windows *and* the
 *      Chinese statutory holiday calendar, because peak hours explicitly exclude
 *      Chinese public holidays.
 *
 * Both are fetched over the network, normalised into one small "price book",
 * cached in memory and on disk, and served to the Client from
 * `GET /api/dsh-step-token-usage/pricing`. No price is hardcoded: the only
 * compiled-in price-shaped constant is a last-resort *time window* used when
 * every window source is unreachable, and the book records which source
 * supplied what so the UI can say so. When every source fails, the route
 * answers 503 and the UI reports the price as unknown instead of inventing one.
 *
 * Sources, in the order their answers are trusted:
 *
 *   | id               | what it supplies                                    |
 *   |------------------|-----------------------------------------------------|
 *   | `deepseek-docs-*`| peak **and** off-peak prices, USD (en) and CNY (zh)  |
 *   | `litellm`        | machine-readable off-peak *windows*; USD price backup |
 *   | `holiday-cn`     | the State Council holiday schedule, per year         |
 *
 * This half deliberately imports nothing but Node builtins: the package is
 * installed by symlink into a profile, so its real path sits outside the
 * profile's `node_modules` and no bare specifier would resolve. Staying
 * dependency-free is also what lets the bundle install straight from GitHub.
 *
 * @module dsh-step-token-usage
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Route the Client reads the price book from. Namespaced to avoid collisions. */
export const PRICING_PATH = '/api/dsh-step-token-usage/pricing';

/** Where each fact comes from by default. */
export const DEFAULT_SOURCES = {
  /** Official pricing page, Chinese: prices in CNY. */
  docsZh: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  /** Official pricing page, English: the same rate card in USD. */
  docsEn: 'https://api-docs.deepseek.com/quick_start/pricing',
  /** Model price dataset; the only source that encodes off-peak *windows*. */
  litellm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  /** State Council holiday schedule; `{year}` is substituted. */
  holidays: 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json',
};

/**
 * Last-resort peak windows, used only when neither LiteLLM nor the official
 * pricing page yields a machine-readable window, and cross-checked against the
 * docs page whenever that page is reachable.
 *
 * Verbatim from the official pricing footnote of 2026-10: "Peak hours are
 * 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese
 * public holidays. All other hours are off-peak, including weekends and Chinese
 * public holidays in full." Weekdays are ISO: 1 = Monday … 7 = Sunday.
 */
export const BUILTIN_PEAK = {
  source: 'builtin',
  weekdays: {
    1: [['01:00', '04:00'], ['06:00', '10:00']],
    2: [['01:00', '04:00'], ['06:00', '10:00']],
    3: [['01:00', '04:00'], ['06:00', '10:00']],
    4: [['01:00', '04:00'], ['06:00', '10:00']],
    5: [['01:00', '04:00'], ['06:00', '10:00']],
    6: [],
    7: [],
  },
};

/** How long a book is served before a background refresh is attempted. */
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;
/** Network budget for one source. */
const FETCH_TIMEOUT_MS = 20 * 1000;
/** Delay before the startup warm fetch, so boot is never competing for sockets. */
const WARM_DELAY_MS = 2000;
/** Largest source body accepted, so a hostile redirect cannot exhaust memory. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

// #region small utilities

/**
 * Coerce one provider field to a finite non-negative number.
 * @param value - raw field.
 * @returns the number, or null when absent or unusable.
 */
function num(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/**
 * Read the first number out of a price cell (`$0.003`, `0.02元`).
 * @param text - cell text.
 * @returns the value, or null when the cell carries no number.
 */
function money(text) {
  const match = /-?\d+(?:\.\d+)?/.exec(String(text ?? ''));
  return match === null ? null : num(Number(match[0]));
}

/** @returns `HH:MM` for a minute-of-day offset. */
function fromMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Read one `HH:MM-HH:MM` window as a minute range.
 *
 * An end at or before the start means the window runs to midnight, which is how
 * both sources spell "the rest of the day" (`10:00-00:00`, `00:00-00:00`).
 *
 * @param spec - window text.
 * @returns `[startMinutes, endMinutes]`, or null when unparseable.
 */
export function rangeMinutes(spec) {
  const match = /^(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})$/.exec(String(spec ?? '').trim());
  if (match === null) return null;
  const start = Number(match[1]) * 60 + Number(match[2]);
  let end = Number(match[3]) * 60 + Number(match[4]);
  if (start > 1439 || end > 1440) return null;
  if (end <= start) end = 1440;
  return [start, end];
}

/**
 * Invert a set of minute ranges over one whole day.
 * @param ranges - `[start, end]` minute pairs, possibly overlapping.
 * @returns the complement, sorted, as `[start, end]` pairs.
 */
export function complementRanges(ranges) {
  const sorted = ranges.slice().sort((left, right) => left[0] - right[0]);
  const out = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) out.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < 1440) out.push([cursor, 1440]);
  return out;
}

/** @returns a stable scalar for one weekday's windows, for comparing sources. */
function windowSignature(weekdays) {
  return [1, 2, 3, 4, 5, 6, 7]
    .map((day) => `${day}:${(weekdays[day] ?? []).map(([start, end]) => `${start}-${end}`).join(',')}`)
    .join('|');
}

// #endregion

// #region official pricing page

/** Strip tags, entities and footnote markers from one table cell. */
function cellText(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/\(\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @returns every table row on the page as an array of cleaned cell texts. */
function tableRows(html) {
  const rows = [];
  for (const row of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const cell of row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) cells.push(cellText(cell[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/** Price buckets the official table publishes, in its own row order. */
const BUCKETS = [
  { key: 'inputHit', label: /CACHE HIT|缓存命中/i },
  { key: 'inputMiss', label: /CACHE MISS|缓存未命中/i },
  { key: 'output', label: /OUTPUT|输出/i },
];

/** @returns the bucket a table row's leading cell names, or null. */
function bucketOf(text) {
  for (const bucket of BUCKETS) if (bucket.label.test(text)) return bucket.key;
  return null;
}

/** @returns 'peak' | 'offPeak' for a tier cell, or null. */
function tierOf(text) {
  if (/OFF-PEAK|空闲时段/i.test(text)) return 'offPeak';
  if (/PEAK|高峰时段/i.test(text)) return 'peak';
  return null;
}

/**
 * Read the official pricing table.
 *
 * The table is a `MODEL` header row naming one column per model, followed by
 * three bucket blocks. Each block opens with the bucket name and its OFF-PEAK
 * row and continues with a PEAK row, so the walker keeps the current bucket
 * across rows. Parsing is bounded at the concurrency row, which is the first
 * thing after the rate card, so unrelated tables on the page cannot contribute.
 *
 * @param html - the pricing page.
 * @param currency - currency the page quotes, recorded on the result.
 * @returns `{ currency, models }` where models map id -> `{ peak, offPeak }`.
 */
export function parseDocsPricing(html, currency) {
  const models = {};
  let columns = null;
  let bucket = null;

  for (const cells of tableRows(html)) {
    if (columns === null) {
      const head = cells.findIndex((cell) => /^(MODEL|模型)$/i.test(cell));
      if (head < 0) continue;
      const ids = cells.slice(head + 1).filter((cell) => /^[A-Za-z0-9][\w.\-/:]*$/.test(cell));
      if (ids.length > 0) columns = ids;
      continue;
    }
    if (/Concurrency Limit|并发限制/i.test(cells.join(' '))) break;

    // Labels are located rather than assumed to be first: the rate card's
    // bucket cell shares its row with a rowspanning `PRICING` cell, so the
    // bucket name can sit at any offset.
    const namedAt = cells.findIndex((cell) => bucketOf(cell) !== null);
    const tierAt = cells.findIndex((cell) => tierOf(cell) !== null);
    let values;
    if (namedAt >= 0 && tierAt === namedAt + 1) {
      bucket = bucketOf(cells[namedAt]);
      values = cells.slice(tierAt + 1);
    } else if (namedAt < 0 && tierAt >= 0 && bucket !== null) {
      values = cells.slice(tierAt + 1);
    } else {
      continue;
    }

    const tier = tierOf(cells[tierAt]);
    if (tier === null) continue;

    values.forEach((text, index) => {
      const id = columns[index];
      const value = money(text);
      if (id === undefined || value === null) return;
      models[id] = models[id] ?? { peak: {}, offPeak: {} };
      models[id][tier][bucket] = value;
    });
  }

  // A model is only usable when every bucket of both tiers came through; a
  // partially parsed row would silently bill a missing bucket as zero.
  for (const [id, entry] of Object.entries(models)) {
    const complete = ['peak', 'offPeak'].every((tier) => BUCKETS.every(({ key }) => num(entry[tier][key]) !== null));
    if (!complete) delete models[id];
  }

  return { currency, models };
}

/**
 * Read the published peak rule out of the pricing page footnote.
 *
 * This is a cross-check and a fallback for the window data, not the primary
 * source: LiteLLM states the same rule structurally. Both locales are handled,
 * and the Chinese page states its window in Beijing time, which is shifted back
 * to UTC here.
 *
 * @param html - the pricing page.
 * @returns `{ weekdays, timezone }` or null when the footnote is unrecognised.
 */
export function parsePeakRule(html) {
  const text = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');

  const english = /Peak hours are([^.]*)\./i.exec(text);
  if (english !== null) {
    const ranges = [...english[1].matchAll(/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g)].map((match) =>
      rangeMinutes(match[0]),
    );
    const usable = ranges.filter((range) => range !== null);
    if (usable.length > 0) return { ranges: usable, timezone: 'UTC' };
  }

  const chinese = /北京时间[^；。]*?为高峰时段/.exec(text);
  if (chinese !== null) {
    const ranges = [...chinese[0].matchAll(/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/g)].map((match) =>
      rangeMinutes(match[0]),
    );
    const usable = ranges.filter((range) => range !== null);
    if (usable.length > 0) return { ranges: usable, timezone: 'Asia/Shanghai' };
  }

  return null;
}

/**
 * Project one day's ranges onto the five weekdays the rule names.
 * @param ranges - peak minute ranges in `timezone`.
 * @param timezone - 'UTC' or 'Asia/Shanghai'.
 * @returns ISO-weekday keyed peak windows, or null when the shift is not whole hours.
 */
export function peakWeekdaysFromRanges(ranges, timezone) {
  const shift = timezone === 'Asia/Shanghai' ? -8 * 60 : 0;
  const shifted = [];
  for (const [start, end] of ranges) {
    let nextStart = start + shift;
    let nextEnd = end + shift;
    if (nextStart < 0) nextStart += 1440;
    if (nextEnd < 0) nextEnd += 1440;
    if (nextStart > nextEnd) return null;
    shifted.push([nextStart, nextEnd]);
  }
  const display = shifted
    .sort((left, right) => left[0] - right[0])
    .map(([start, end]) => [fromMinutes(start), fromMinutes(end === 1440 ? 1440 : end)]);
  const weekdays = {};
  for (let day = 1; day <= 7; day += 1) weekdays[day] = day <= 5 ? display.map((range) => range.slice()) : [];
  return weekdays;
}

// #endregion

// #region litellm dataset

/**
 * Read the off-peak *windows* out of a LiteLLM entry and invert them.
 *
 * LiteLLM's `off_peak_pricing.windows` names the slices where the discounted
 * price applies, so peak is the complement. It spells a whole day as
 * `00:00-00:00` and a weekday group as `weekdays: [1..7]` with 1 = Monday.
 *
 * @param windows - the entry's `off_peak_pricing.windows`.
 * @returns ISO-weekday keyed peak windows, or null when nothing usable was found.
 */
export function peakWeekdaysFromWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return null;
  const offPeak = new Map();
  let seen = 0;

  for (const window of windows) {
    if (typeof window !== 'object' || window === null) continue;
    const specs = Array.isArray(window.hours_utc) ? window.hours_utc : [window.hours_utc];
    const ranges = specs.map((spec) => rangeMinutes(spec)).filter((range) => range !== null);
    const days = Array.isArray(window.weekdays) ? window.weekdays : [];
    for (const day of days) {
      if (!Number.isInteger(day) || day < 1 || day > 7) continue;
      offPeak.set(day, [...(offPeak.get(day) ?? []), ...ranges]);
      seen += 1;
    }
  }
  if (seen === 0) return null;

  const weekdays = {};
  for (let day = 1; day <= 7; day += 1) {
    // A weekday the dataset never mentions carries no stated peak window, and
    // the published rule makes every unlisted hour off-peak.
    const ranges = offPeak.get(day) ?? [];
    weekdays[day] = complementRanges(ranges).map(([start, end]) => [fromMinutes(start), fromMinutes(Math.min(end, 1440))]);
  }
  return weekdays;
}

/**
 * Normalise the LiteLLM dataset into this plugin's book shape.
 *
 * Only entries that declare `litellm_provider: 'deepseek'` are read: those are
 * the ones the dataset attributes to the official DeepSeek platform, which is
 * the route this install bills. The dataset's base fields are the **peak**
 * rates and `off_peak_pricing` holds the discounted ones; reading them the
 * other way round would silently halve or double every figure, so the two are
 * kept distinct here and the caller states which it used.
 *
 * @param raw - the parsed dataset.
 * @returns `{ models, windows }`.
 */
export function normalizeLitellm(raw) {
  const models = {};
  let windows = null;

  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value !== 'object' || value === null) continue;
    if (value.litellm_provider !== 'deepseek') continue;

    const id = key.replace(/^deepseek\//, '');
    const peak = {
      inputMiss: num(value.input_cost_per_token) === null ? null : num(value.input_cost_per_token) * 1e6,
      inputHit:
        num(value.cache_read_input_token_cost) === null
          ? num(value.input_cost_per_token_cache_hit) === null
            ? null
            : num(value.input_cost_per_token_cache_hit) * 1e6
          : num(value.cache_read_input_token_cost) * 1e6,
      output: num(value.output_cost_per_token) === null ? null : num(value.output_cost_per_token) * 1e6,
    };
    const discounted = value.off_peak_pricing;
    const offPeak =
      typeof discounted === 'object' && discounted !== null
        ? {
            inputMiss: num(discounted.input_cost_per_token) === null ? null : num(discounted.input_cost_per_token) * 1e6,
            inputHit:
              num(discounted.cache_read_input_token_cost) === null
                ? null
                : num(discounted.cache_read_input_token_cost) * 1e6,
            output: num(discounted.output_cost_per_token) === null ? null : num(discounted.output_cost_per_token) * 1e6,
          }
        : null;

    models[id] = { peak, offPeak };
    if (windows === null) windows = peakWeekdaysFromWindows(discounted?.windows);
  }

  return { models, windows };
}

// #endregion

// #region holidays

/**
 * Read the State Council holiday schedule.
 *
 * DeepSeek's peak windows exclude Chinese public holidays, and holidays are
 * announced as a set of whole days (`isOffDay`), including the调休 make-up
 * working days that are *not* off. The make-up days need no special handling:
 * the published rule makes every Saturday and Sunday off-peak regardless, so
 * only the off days matter here.
 *
 * @param raw - one year file from holiday-cn.
 * @param year - the year the file was requested for.
 * @returns `{ year, offDays }` sorted ascending.
 */
export function normalizeHolidays(raw, year) {
  const days = Array.isArray(raw?.days) ? raw.days : [];
  const offDays = [];
  for (const day of days) {
    if (typeof day !== 'object' || day === null) continue;
    if (day.isOffDay !== true) continue;
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
    offDays.push(day.date);
  }
  return { year, offDays: [...new Set(offDays)].sort() };
}

// #endregion

// #region book assembly

/** @returns whether two bucket tables state the same numbers where both speak. */
function sameTier(left, right) {
  for (const key of ['inputMiss', 'inputHit', 'output']) {
    const a = left?.[key];
    const b = right?.[key];
    // An unstated bucket never blocks a merge; a disagreement always does.
    if (a === null || a === undefined || b === null || b === undefined) continue;
    if (Math.abs(a - b) > 1e-9) return false;
  }
  return true;
}

/**
 * Test whether one model's rate card can be folded into another's.
 *
 * Two ids that state the same prices wherever they overlap are the same
 * billable model; the caller keeps the richer one and records the other as an
 * alias. Requiring at least one shared currency stops a single-currency entry
 * from being absorbed by an unrelated one on no evidence at all.
 *
 * @param left - a model's `prices`.
 * @param right - the candidate model's currency tables.
 * @returns whether the two describe the same rate card.
 */
function compatibleCurrencies(left, right) {
  const shared = Object.keys(right).filter((currency) => left[currency] !== undefined);
  if (shared.length === 0) return false;
  return shared.every((currency) => sameTier(left[currency].peak, right[currency].peak) && sameTier(left[currency].offPeak, right[currency].offPeak));
}

/**
 * Merge every source's answer into the single book the Client consumes.
 *
 * Prices come from the official pages because those are the authoritative rate
 * card and are the only place the off-peak *prices* are published for both
 * currencies. LiteLLM fills any gap, notably if a page's markup changes, and is
 * the primary source of the peak windows. A window disagreement is resolved in
 * favour of the official page, with a warning, because a wrong window is the
 * one error that would misprice silently at exactly 2x.
 *
 * Aliases are derived, not listed: two ids that publish an identical rate card
 * are the same billable model, which is how the retired `deepseek-v4-flash`
 * names stay priced at the Flash rate.
 *
 * @param input - parsed sources plus the caller's overrides.
 * @returns the price book.
 */
export function assembleBook(input) {
  const generatedAt = input.generatedAt ?? Date.now();
  const warnings = [];
  const docsZh = input.docsZh ?? { currency: 'CNY', models: {} };
  const docsEn = input.docsEn ?? { currency: 'USD', models: {} };
  const litellm = input.litellm ?? { models: {}, windows: null };
  const overrides = input.overrides ?? {};

  // ---- window resolution ------------------------------------------------
  const docsRule = input.docsRule ?? null;
  const fromDocs = docsRule === null ? null : peakWeekdaysFromRanges(docsRule.ranges, docsRule.timezone);
  let weekdays;
  let windowSource;
  if (fromDocs !== null && litellm.windows !== null) {
    if (windowSignature(fromDocs) === windowSignature(litellm.windows)) {
      weekdays = fromDocs;
      windowSource = 'litellm+docs';
    } else {
      weekdays = fromDocs;
      windowSource = 'docs';
      warnings.push('price-window-disagreement');
    }
  } else if (fromDocs !== null) {
    weekdays = fromDocs;
    windowSource = 'docs';
  } else if (litellm.windows !== null) {
    weekdays = litellm.windows;
    windowSource = 'litellm';
  } else {
    weekdays = BUILTIN_PEAK.weekdays;
    windowSource = BUILTIN_PEAK.source;
    warnings.push('price-window-fallback-builtin');
  }

  // ---- price merge ------------------------------------------------------
  const ids = new Set([...Object.keys(docsEn.models), ...Object.keys(docsZh.models), ...Object.keys(litellm.models)]);
  const drafts = new Map();
  for (const id of ids) {
    const cny = docsZh.models[id] ?? null;
    const usd = docsEn.models[id] ?? null;
    const backup = litellm.models[id] ?? null;
    if (cny === null && usd === null && backup === null) continue;

    const currencies = {};
    if (cny !== null) currencies.CNY = { peak: cny.peak, offPeak: cny.offPeak, source: 'deepseek-docs-zh' };
    if (usd !== null) currencies.USD = { peak: usd.peak, offPeak: usd.offPeak, source: 'deepseek-docs-en' };
    else if (backup !== null && backup.peak.inputMiss !== null) {
      // Off-peak is published as exactly half of peak, but it is derived here
      // rather than assumed, so a dataset that later states it explicitly wins.
      const halve = (table) =>
        table === null
          ? null
          : Object.fromEntries(Object.entries(table).map(([key, value]) => [key, value === null ? null : value / 2]));
      currencies.USD = { peak: backup.peak, offPeak: backup.offPeak ?? halve(backup.peak), source: 'litellm' };
      warnings.push(`price-usd-from-litellm:${id}`);
    }
    if (Object.keys(currencies).length === 0) continue;
    drafts.set(id, currencies);
  }

  // ---- alias folding ----------------------------------------------------
  const models = {};
  const ordered = [...drafts.keys()].sort((left, right) => {
    const leftDoc = left in docsEn.models || left in docsZh.models ? 0 : 1;
    const rightDoc = right in docsEn.models || right in docsZh.models ? 0 : 1;
    if (leftDoc !== rightDoc) return leftDoc - rightDoc;
    return left.localeCompare(right);
  });

  for (const id of ordered) {
    const currencies = drafts.get(id);
    // A retired name appears only in the fallback dataset, so it carries fewer
    // currencies than the model it aliases. Overlap is therefore compared on
    // the currencies both sides state, and the richer side's other currencies
    // are inherited — which is exactly how `deepseek-v4-flash` keeps the Flash
    // rate card in both currencies.
    let host = null;
    for (const candidate of Object.values(models)) {
      if (compatibleCurrencies(candidate.prices, currencies)) {
        host = candidate;
        break;
      }
    }
    if (host !== null) {
      if (!host.aliases.includes(id)) host.aliases.push(id);
      for (const [currency, table] of Object.entries(currencies)) {
        if (host.prices[currency] === undefined) {
          host.prices[currency] = { peak: table.peak, offPeak: table.offPeak, source: table.source };
        }
      }
      continue;
    }
    const prices = {};
    for (const [currency, table] of Object.entries(currencies)) {
      prices[currency] = { peak: table.peak, offPeak: table.offPeak, source: table.source };
    }
    models[id] = { id, aliases: [id], prices };
  }

  // ---- caller overrides -------------------------------------------------
  for (const [id, table] of Object.entries(overrides.priceOverrides ?? {})) {
    const existing = models[id] ?? { id, aliases: [id], prices: {} };
    for (const [currency, tiers] of Object.entries(table ?? {})) {
      const base = existing.prices[currency] ?? { peak: {}, offPeak: {} };
      existing.prices[currency] = {
        peak: { ...base.peak, ...(tiers?.peak ?? {}) },
        offPeak: { ...base.offPeak, ...(tiers?.offPeak ?? {}) },
        source: 'override',
      };
    }
    if (!existing.aliases.includes(id)) existing.aliases.push(id);
    models[id] = existing;
  }

  const currencySet = new Set();
  for (const model of Object.values(models)) for (const currency of Object.keys(model.prices)) currencySet.add(currency);
  // CNY first: the plugin's default is the currency the rate card is quoted in
  // where the account is billed, and the operator asked for RMB by default.
  const currencies = ['CNY', 'USD'].filter((currency) => currencySet.has(currency)).concat([...currencySet].filter((c) => c !== 'CNY' && c !== 'USD'));
  const holidaySet = new Set(input.holidays ?? []);
  for (const day of overrides.extraHolidays ?? []) {
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) holidaySet.add(day);
  }

  return {
    schema: 1,
    generatedAt,
    stale: false,
    unit: 'per1MTokens',
    /** Prompt tokens are billed in two buckets plus output; the Client needs both. */
    currencies,
    defaultCurrency: currencies.includes('CNY') ? 'CNY' : (currencies[0] ?? 'USD'),
    peakWeekdays: weekdays,
    windowSource,
    holidays: [...holidaySet].sort(),
    holidayYears: input.holidayYears ?? [],
    models,
    sources: input.sources ?? [],
    warnings,
  };
}

// #endregion

// #region fetching

/**
 * Fetch one source as text within a byte budget.
 * @param url - absolute URL.
 * @returns the body, or throws.
 */
async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // Several of these hosts serve different shapes to unknown agents.
      accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      'user-agent': 'dsh-step-token-usage (+https://github.com/hana647929196/dsh-step-token-usage)',
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const length = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error('body too large');
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('body too large');
  return text;
}

/** @returns the parsed body, or null when the source failed. */
async function tryJson(url) {
  try {
    return JSON.parse(await fetchText(url));
  } catch {
    return null;
  }
}

/** @returns the body, or null when the source failed. */
async function tryText(url) {
  try {
    return await fetchText(url);
  } catch {
    return null;
  }
}

/**
 * Fetch and assemble a book from every configured source.
 *
 * Each source fails independently: a dead pricing page costs its currency while
 * the windows and holidays still arrive, and the resulting book records what
 * actually landed so the UI never presents a fallback as the live rate card.
 *
 * @param settings - resolved settings.
 * @returns the assembled book.
 * @throws when not one price could be obtained.
 */
export async function fetchBook(settings) {
  const year = new Date().getUTCFullYear();
  const years = [year - 1, year, year + 1];
  const sources = [];
  const record = (id, url, ok, note) => sources.push({ id, url, ok, ...(note === undefined ? {} : { note }) });

  const [docsZhHtml, docsEnHtml, litellmRaw, ...holidayRaw] = await Promise.all([
    tryText(settings.sources.docsZh),
    tryText(settings.sources.docsEn),
    tryJson(settings.sources.litellm),
    ...years.map((value) => tryJson(settings.sources.holidays.replace('{year}', String(value)))),
  ]);

  const docsZh = docsZhHtml === null ? { currency: 'CNY', models: {} } : parseDocsPricing(docsZhHtml, 'CNY');
  const docsEn = docsEnHtml === null ? { currency: 'USD', models: {} } : parseDocsPricing(docsEnHtml, 'USD');
  record('deepseek-docs-zh', settings.sources.docsZh, docsZhHtml !== null && Object.keys(docsZh.models).length > 0);
  record('deepseek-docs-en', settings.sources.docsEn, docsEnHtml !== null && Object.keys(docsEn.models).length > 0);
  const litellm = litellmRaw === null ? { models: {}, windows: null } : normalizeLitellm(litellmRaw);
  record('litellm', settings.sources.litellm, litellmRaw !== null && Object.keys(litellm.models).length > 0);

  // The English page states the rule in UTC; prefer it as the cross-check.
  const docsRule = (docsEnHtml === null ? null : parsePeakRule(docsEnHtml)) ?? (docsZhHtml === null ? null : parsePeakRule(docsZhHtml));

  const offDays = [];
  const holidayYears = [];
  years.forEach((value, index) => {
    const raw = holidayRaw[index];
    const url = settings.sources.holidays.replace('{year}', String(value));
    const ok = raw !== null;
    record(`holiday-cn-${value}`, url, ok);
    if (!ok) return;
    const parsed = normalizeHolidays(raw, value);
    holidayYears.push(value);
    offDays.push(...parsed.offDays);
  });

  const book = assembleBook({
    generatedAt: Date.now(),
    docsZh,
    docsEn,
    litellm,
    docsRule,
    holidays: offDays,
    holidayYears,
    overrides: settings.overrides,
    sources,
  });

  if (Object.keys(book.models).length === 0) throw new Error('no source supplied any price');
  if (!book.currencies.includes('CNY') && !book.currencies.includes('USD')) throw new Error('no currency resolved');
  return book;
}

// #endregion

// #region settings and cache

/** Read the settings file, ignoring a missing or malformed one. */
async function readSettingsFile(path) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Resolve settings from built-in defaults, then an optional JSON file, then the
 * plugin row's own `config`.
 *
 * A schema is deliberately not declared: cordis would require
 * `@deepseek-ai/schemastery`, which does not resolve from this package's real
 * path, so the file is both the documented and the dependency-free way to
 * override anything.
 *
 * @param config - the plugin row's config, when present.
 * @returns resolved settings.
 */
export function resolveSettings(config) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return {
    home,
    file: process.env.DSH_STEP_TOKEN_USAGE_CONFIG ?? join(home, 'dsh-step-token-usage.json'),
    config: typeof config === 'object' && config !== null ? config : {},
  };
}

/** Merge the layered settings sources into the shape the fetcher wants. */
function mergeSettings(base, file, config) {
  const pick = (...values) => values.find((value) => value !== undefined && value !== null);
  const sources = { ...DEFAULT_SOURCES };
  for (const layer of [file.sources, config.sources]) {
    if (typeof layer !== 'object' || layer === null) continue;
    for (const key of Object.keys(DEFAULT_SOURCES)) if (typeof layer[key] === 'string') sources[key] = layer[key];
  }
  const overrides = {};
  for (const layer of [file, config]) {
    if (Array.isArray(layer.extraHolidays)) overrides.extraHolidays = [...(overrides.extraHolidays ?? []), ...layer.extraHolidays];
    if (typeof layer.priceOverrides === 'object' && layer.priceOverrides !== null) {
      overrides.priceOverrides = { ...(overrides.priceOverrides ?? {}), ...layer.priceOverrides };
    }
  }
  const ttlHours = num(pick(config.ttlHours, file.ttlHours));
  return {
    enabled: pick(config.enabled, file.enabled) !== false,
    ttlMs: ttlHours === null || ttlHours === 0 ? DEFAULT_TTL_MS : ttlHours * 60 * 60 * 1000,
    sources,
    overrides,
    home: base.home,
    file: base.file,
  };
}

/** @returns the on-disk cache path for one DSH home. */
function cachePath(home) {
  return join(home, 'cache', 'dsh-step-token-usage', 'pricing.json');
}

/** Read the last good book, or null. */
async function readCache(path) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    if (typeof raw !== 'object' || raw === null || typeof raw.models !== 'object') return null;
    return { book: raw, fetchedAt: num(raw.generatedAt) ?? 0 };
  } catch {
    return null;
  }
}

/** Persist the book so a restart or an outage still prices history. */
async function writeCache(path, book) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(book), 'utf8');
    await rename(temporary, path);
  } catch {
    // A read-only home only costs the warm start, never correctness.
  }
}

/**
 * The book holder: one cached value, one in-flight fetch, and disk fallback.
 *
 * A refresh never fails the caller while a usable book exists — the previous
 * book is served marked `stale` — and a total outage with no cache surfaces as
 * `null`, which the route reports as unavailable rather than as zero.
 *
 * @param settings - resolved settings.
 * @returns `{ get }`.
 */
export function createPriceBookStore(settings) {
  let current = null;
  let inflight = null;
  const path = cachePath(settings.home);

  const load = async () => {
    if (current === null) {
      const disk = await readCache(path);
      if (disk !== null) current = { ...disk, stale: true };
    }
    try {
      const book = await fetchBook(settings);
      await writeCache(path, book);
      current = { book, fetchedAt: book.generatedAt, stale: false };
      return current;
    } catch (error) {
      if (current === null) return null;
      return { ...current, stale: true, error: String(error?.message ?? error) };
    }
  };

  return {
    /**
     * Read the book, fetching when the cached one is missing or past its TTL.
     * @param options - `force` refetches even within the TTL.
     * @returns the book plus its age, or null when nothing could be obtained.
     */
    async get(options = {}) {
      const age = current === null ? Number.POSITIVE_INFINITY : Date.now() - current.fetchedAt;
      const fresh = current !== null && age < settings.ttlMs;
      if (fresh && options.force !== true) return current;
      if (inflight === null) {
        inflight = load().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
    /** @returns the cached book without touching the network. */
    peek() {
      return current;
    },
    /** Test seam: install a book directly. */
    seed(entry) {
      current = entry;
    },
  };
}

// #endregion

// #region route

/** Write one JSON response. */
function respond(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * Serve the price book.
 *
 * Only public rate-card data is exposed, so no credential check is needed, but
 * the surface is still kept to GET/HEAD and the response is never cached by an
 * intermediary.
 */
async function handlePricing(store, req, res, logger) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respond(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'GET required' } });
    return;
  }
  let force = false;
  try {
    force = new URL(req.url ?? PRICING_PATH, 'http://localhost').searchParams.get('refresh') === '1';
  } catch {
    force = false;
  }

  let entry = null;
  try {
    entry = await store.get({ force });
  } catch (error) {
    logger?.warn?.(`dsh-step-token-usage: price book fetch failed: ${String(error?.message ?? error)}`);
  }

  if (entry === null || entry.book === undefined) {
    respond(res, 503, {
      ok: false,
      error: { code: 'price-unavailable', message: 'no price source could be reached and no cached book exists' },
    });
    return;
  }

  respond(res, 200, {
    ok: true,
    fetchedAt: entry.fetchedAt,
    stale: entry.stale === true,
    ...(entry.error === undefined ? {} : { error: entry.error }),
    book: entry.book,
  });
}

// #endregion

/**
 * Mount the host half.
 *
 * The Client half works without this — it simply reports prices as unknown —
 * so a profile without a web server degrades instead of failing to load.
 *
 * @param ctx - cordis context.
 * @param config - optional plugin row config.
 */
export function apply(ctx, config) {
  const base = resolveSettings(config);

  // The settings file is read once per mount; a reload picks up an edit.
  void readSettingsFile(base.file).then((file) => {
    const settings = mergeSettings(base, file, base.config);
    if (settings.enabled === false) return;
    const store = createPriceBookStore(settings);

    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(
        () =>
          webCtx.webServer.register({
            kind: 'exact',
            path: PRICING_PATH,
            handler: (req, res) => handlePricing(store, req, res, webCtx.logger),
          }),
        'dsh-step-token-usage: price route',
      );
    });

    // Warm the book so the first dialog open is not a cold start, and so a
    // broken source shows up in the log before a user notices it in the UI.
    ctx.effect(() => {
      const timer = setTimeout(() => {
        void store.get({}).then(
          (entry) => {
            if (entry === null) ctx.logger?.warn?.('dsh-step-token-usage: no price source reachable at startup');
            else if (entry.error !== undefined) ctx.logger?.warn?.(`dsh-step-token-usage: serving stale price book: ${entry.error}`);
            else ctx.logger?.info?.(`dsh-step-token-usage: price book ready (${entry.book.currencies.join('/')}, window=${entry.book.windowSource})`);
          },
          () => {},
        );
      }, WARM_DELAY_MS);
      if (typeof timer.unref === 'function') timer.unref();
      return () => clearTimeout(timer);
    }, 'dsh-step-token-usage: warm price book');
  });
}
