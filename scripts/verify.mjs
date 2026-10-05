#!/usr/bin/env node
/**
 * Offline verification for dsh-step-token-usage.
 *
 * Mounts the Client half against a fake module loader and Cordis context, then
 * performs two passes:
 *
 *   1. A headless render of the registered renderer, invoking the component
 *      directly so the produced element tree can be inspected. This asserts the
 *      dialog is shaped like the shipped Turn-usage dialog, that values carry
 *      the shipped unit suffix, and that an omitted bucket is never printed as
 *      a zero.
 *   2. A sweep over every stored session log, driving the registered Definition
 *      and checking the properties that are hard to eyeball in the browser.
 *
 * Usage:  npm run verify
 *         DSH_HOME=/path/to/dsh_home npm run verify
 *
 * Defaults to $DSH_HOME/sessions, then ~/.dsh/sessions. Exits non-zero when an
 * assertion fails.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

const problems = [];
const expect = (condition, message) => {
  if (!condition) problems.push(message);
};

/** Every stylesheet the plugin injected, as `[pluginCss id, css text]`. */
const injectedCss = [];

// ------------------------------------------------------------------ fake host

let registration = null;
const dictionaries = new Map();
let definition = null;
let renderer = null;
let turnRenderer = null;
let composerChip = null;
let turnDefinition = null;
let settingsRows = [];

globalThis.window = {
  __ModuleLoader__: { load: (entry) => (registration = entry) },
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = {
  createElement: () => ({
    dataset: {},
    remove() {},
    set textContent(value) {
      injectedCss.push([this.dataset.pluginCss, value]);
    },
  }),
  head: { appendChild() {} },
  body: { nodeType: 1 },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

/**
 * A React stand-in that records the element tree instead of rendering it, so
 * the component can be invoked headlessly and its markup inspected. Function
 * components are expanded in place, so the markup a nested component produces
 * is inspected rather than the component reference that produced it.
 */
const element = (type, props, ...children) => {
  const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false);
  if (typeof type === 'function') return type({ ...(props ?? {}), children: flat });
  return { type, props: props ?? {}, children: flat };
};

const ReactStub = {
  createElement: element,
  // The component owns exactly one piece of state: the open flag. Reporting a
  // boolean initial value as already-true renders the dialog without a real
  // reconciler, which is what the markup assertions need.
  useState: (value) => (typeof value === 'boolean' ? [true, () => {}] : [value, () => {}]),
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useId: () => 'id',
  memo: (component) => component,
  Fragment: 'Fragment',
};
const ReactDOMStub = {
  createPortal: (node, container) => ({ type: 'portal', props: {}, children: [node], container }),
};

await import(join(repo, 'lib', 'client.js'));
if (registration === null) throw new Error('lib/client.js registered no module');

const mod = registration.factory((name) => {
  if (name === 'react') return ReactStub;
  if (name === 'react-dom') return ReactDOMStub;
  throw new Error(`unexpected require(${JSON.stringify(name)})`);
});

const noop = () => {};
const registered = [];

mod.apply({
  effect: (fn) => {
    const disposer = fn();
    return typeof disposer === 'function' ? disposer : noop;
  },
  locale: {
    register: (ns, dicts) => {
      registered.push(`locale ${ns}`);
      dictionaries.set(ns, dicts);
      const all = Object.values(dicts);
      const first = all[0] ?? {};
      for (const dictionary of all.slice(1)) {
        const onlyFirst = Object.keys(first).filter((key) => !(key in dictionary));
        const onlyOther = Object.keys(dictionary).filter((key) => !(key in first));
        expect(onlyFirst.length === 0 && onlyOther.length === 0, `locale dictionaries disagree for "${ns}": ${[...onlyFirst, ...onlyOther]}`);
      }
      return noop;
    },
  },
  uiConversation: {
    events: {
      register: (candidate) => {
        if (definition === null) definition = candidate;
        else turnDefinition = candidate;
        registered.push(`definition ${candidate.kind}`);
        return noop;
      },
    },
  },
  slots: {
    inject: (key, callback) => {
      registered.push(`inject ${key}`);
      callback();
      return noop;
    },
    register: (options, component) => {
      expect(typeof component === 'function', 'a registration is not a component function');
      expect(options.locale !== undefined, `slot "${options.name}" declares no locale namespace`);
      if (options.name === 'conversation.chat.node') {
        expect(options.key === definition.kind || options.key === turnDefinition.kind, `unexpected chat node kind "${options.key}"`);
        if (options.key === definition.kind) renderer = component;
        else turnRenderer = component;
        registered.push(`slot ${options.name} key=${options.key}`);
        return noop;
      }
      if (options.name === 'conversation.composer.dock') {
        // A list slot: contributions are addressed by `id`, and each resolves
        // its own data instead of a chain match.
        expect(typeof options.id === 'string' && options.id !== '', 'a composer-dock contribution declares no id');
        expect(options.key === undefined, 'a list-slot contribution must use id, not key');
        composerChip = component;
        registered.push(`slot ${options.name} id=${options.id} order=${options.order}`);
        return noop;
      }
      if (options.name === 'settings.general.item') {
        expect(typeof options.id === 'string' && options.id !== '', 'a settings row declares no id');
        expect(typeof options.order === 'number', 'a settings row declares no order');
        expect(options.key === undefined, 'a settings row must use id, not key');
        settingsRows.push({ options, component });
        registered.push(`slot ${options.name} id=${options.id} order=${options.order}`);
        return noop;
      }
      expect(false, `unexpected slot "${options.name}"`);
      return noop;
    },
  },
});

if (definition === null) throw new Error('no Conversation Definition was registered');
if (renderer === null) throw new Error('no renderer was registered');
if (turnRenderer === null) throw new Error('no per-turn row renderer was registered');
if (composerChip === null) throw new Error('no composer-dock chip was registered');
if (turnDefinition === null) throw new Error('no per-turn Definition was registered');
if (settingsRows.length === 0) throw new Error('no settings rows were registered');
expect(typeof definition.buildViewNode === 'function', 'definition exposes no buildViewNode');

console.log(`module id     : ${registration.id}`);
console.log(`definition    : kind=${definition.kind} target=${definition.target}`);
console.log(`registrations : ${registered.join(' | ')}`);

// ------------------------------------------------------- markup assertions

/** Flatten a recorded element tree. */
function walk(node, out = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') return out;
  out.push(node);
  for (const child of node.children ?? []) walk(child, out);
  return out;
}

/** Every node carrying one exact class token. */
function byClass(root, token) {
  return walk(root).filter((node) => typeof node.props?.className === 'string' && node.props.className.split(/\s+/).includes(token));
}

/** Concatenated text of a node. */
function textOf(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node === null || node === undefined || typeof node !== 'object') return '';
  return (node.children ?? []).map(textOf).join('');
}

/** A translate seat over one captured dictionary, with the same `{x}` syntax. */
function makeT(dict) {
  return (key, params) => {
    const template = dict[key];
    if (template === undefined) return key;
    return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
  };
}

const zh = dictionaries.get('step-token-usage')?.zh;
if (zh === undefined) throw new Error('no zh dictionary captured');
const enDict = dictionaries.get('step-token-usage')?.en ?? {};
const t = makeT(zh);

const sampleBuckets = { input: 2264, cacheRead: 80128, cacheWrite: 0, output: 418, reasoning: null, total: 82810 };
const usage = (overrides = {}) => ({ ...sampleBuckets, ...overrides });

/** A step ledger shaped exactly as deriveStepUsage returns one. */
const probe = (overrides = {}) => ({
  turn: 2,
  step: 2,
  anchorSeq: 10,
  attempts: [{ kind: 'request', seq: 10, index: 1, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() }],
  requestCount: 1,
  retryCount: 0,
  hasUsage: true,
  buckets: usage(),
  totalTokens: 82810,
  derivedTotal: false,
  missingBuckets: [],
  missingCoreBuckets: [],
  missingOptionalBuckets: [],
  routes: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
  interrupted: false,
  cacheHitPercent: 97.3,
  ...overrides,
});

const tree = renderer({ node: { data: probe() }, t });

// trigger
const root = byClass(tree, 'stu-root');
expect(root.length === 1, `expected one stu-root, found ${root.length}`);
const toggle = byClass(tree, 'stu-toggle');
expect(toggle.length === 1, `expected one stu-toggle, found ${toggle.length}`);
expect(toggle[0]?.props['aria-haspopup'] === 'dialog', 'trigger is missing aria-haspopup="dialog"');
expect(toggle[0]?.props['aria-expanded'] === true, 'trigger is missing aria-expanded');

// dialog is portaled, and carries the shipped dialog's class composition
const portal = walk(tree).find((node) => node.type === 'portal');
expect(portal !== undefined, 'no portal was produced; the dialog must not render inline');
const panel = byClass(tree, 'stu-panel');
expect(panel.length === 1, `expected one stu-panel, found ${panel.length}`);
expect(panel[0]?.props.role === 'dialog', 'panel is missing role="dialog"');
expect(panel[0]?.props['aria-label'] === zh['panel.title'], 'panel aria-label is not the dialog title');
expect(byClass(panel[0], 'stu-panelTitle').length === 1, 'panel is missing its title row');
expect(byClass(panel[0], 'stu-panelLabel').length >= 1, 'panel title is missing its label');
expect(byClass(panel[0], 'stu-panelValue').length >= 1, 'panel title is missing its right-hand value');
expect(byClass(panel[0], 'stu-panelRule').length >= 1, 'panel is missing its title rule');
const details = byClass(panel[0], 'stu-details');
expect(details.length === 1, `expected one details grid for a single-request step, found ${details.length}`);

// values, in the shipped dialog's shape: exact digits + unit
const cells = details[0] ? walk(details[0]).filter((node) => node.type === 'dd') : [];
const cellText = cells.map(textOf);
expect(cellText.includes('2,264 tok'), `uncached input cell missing; got ${JSON.stringify(cellText)}`);
expect(cellText.includes('80,128 tok'), `cache read cell missing; got ${JSON.stringify(cellText)}`);
expect(cellText.includes('418 tok'), `output cell missing; got ${JSON.stringify(cellText)}`);
expect(textOf(byClass(panel[0], 'stu-panelValue')[0]) === '82,810 tok', 'title value is not the exact total with its unit');
expect(cellText.includes('97.3%'), 'cache-hit row is missing');
expect(cellText.some((text) => text.includes('第 2 轮 · 第 2 步')), 'step identity row is missing');

// an omitted bucket must never be reported as a confident zero
const omitted = renderer({
  node: {
    data: probe({
      attempts: [{ kind: 'request', seq: 10, index: 1, route: { provider: 'p', model: 'm' }, usage: usage({ cacheRead: null, cacheWrite: null }) }],
      buckets: usage({ cacheRead: null, cacheWrite: null }),
      routes: [{ provider: 'p', model: 'm' }],
      missingOptionalBuckets: ['cacheRead', 'cacheWrite'],
      cacheHitPercent: null,
    }),
  },
  t,
});
const omittedPanel = byClass(omitted, 'stu-panel')[0];
const omittedCells = walk(omittedPanel).filter((node) => node.type === 'dd').map(textOf);
expect(!omittedCells.includes('0 tok') || omittedCells.includes('0 tok') === false, 'an omitted bucket was printed');
expect(!omittedCells.some((text) => text.includes('缓存读取')), 'an omitted cache bucket got a cell');
expect(textOf(byClass(omittedPanel, 'stu-tokenNotes')[0] ?? { children: [] }).includes('缓存读取'), 'the footnote does not name the omitted bucket');

// a retry gets its own section, with the failure and an explicit "not reported"
const retried = renderer({
  node: {
    data: probe({
      attempts: [
        { kind: 'retry', seq: 9, attempt: 1, maxRetries: 5, failure: { code: 'TRANSPORT', message: 'DeepSeek Messages transport failed' }, route: { provider: 'deepseek-official', model: null }, usage: null },
        { kind: 'request', seq: 10, index: 1, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() },
      ],
      retryCount: 1,
    }),
  },
  t,
});
const retriedPanel = byClass(retried, 'stu-panel')[0];
const retriedText = walk(retriedPanel).map(textOf).join(' ');
expect(walk(retriedPanel).some((node) => node.type === 'dt' && textOf(node) === zh['field.failure']), 'retry section is missing its failure row');
expect(retriedText.includes('TRANSPORT'), 'retry section is missing its failure code');
expect(retriedText.includes('DeepSeek Messages transport failed'), 'retry section is missing its failure message');
expect(retriedText.includes(zh['value.missing']), 'retry section does not mark usage as not reported');

// a step with no usage at all still explains itself
const empty = renderer({ node: { data: probe({ attempts: [{ kind: 'retry', seq: 9, attempt: 1, maxRetries: 2, failure: { code: 'TIMEOUT', message: null }, route: null, usage: null }], requestCount: 0, retryCount: 1, hasUsage: false, buckets: { input: null, cacheRead: null, cacheWrite: null, output: null, reasoning: null, total: null }, totalTokens: null, routes: [], cacheHitPercent: null, interrupted: true }) }, t });
const emptyPanel = byClass(empty, 'stu-panel')[0];
expect(textOf(byClass(emptyPanel, 'stu-panelValue')[0]) === zh['value.missing'], 'a usage-less step does not mark its total as missing');
expect(walk(emptyPanel).map(textOf).join(' ').includes(zh['note.noUsage']), 'a usage-less step does not explain itself');

// The fee is one more line of the delivered field table: it must not restyle
// itself (an overridden colour makes its label brighter than every label above
// it), and because it sits in its own `dl` it has to repeat the grid's row gap
// itself or it meets the output row at zero distance.
const css = injectedCss.map(([, text]) => text).join('\n');
const feeRule = /\.stu-cost\{([^}]*)\}/.exec(css);
expect(feeRule !== null, 'no .stu-cost rule is injected');
expect(feeRule !== null && /margin-top:6px/.test(feeRule[1]), `the fee table does not repeat the grid's 6px row gap; got ${JSON.stringify(feeRule?.[1])}`);
expect(feeRule === null || !/color:/.test(feeRule[1]), `the fee table overrides the field-row colour; got ${JSON.stringify(feeRule?.[1])}`);

// The composer chip borrows the shipped pills' shape: the same type scale and
// line box, a 14px seat for the sign where they put their icon, and the amount
// in the label.
const chipRule = /\.stu-turnCost\{([^}]*)\}/.exec(css);
const iconRule = /\.stu-turnIcon\{([^}]*)\}/.exec(css);
expect(chipRule !== null && /font-size:calc\(var\(--dsh-content-font-size-secondary/.test(chipRule[1]), `the chip does not take the pills' type size; got ${JSON.stringify(chipRule?.[1])}`);
expect(chipRule !== null && /line-height:calc\(20px \+ var\(--dsh-content-font-delta-secondary/.test(chipRule[1]), `the chip does not take the pills' line box; got ${JSON.stringify(chipRule?.[1])}`);
expect(iconRule !== null && /width:14px;height:14px/.test(iconRule[1]), `the currency sign has no 14px icon seat; got ${JSON.stringify(iconRule?.[1])}`);

console.log(`markup        : ${problems.length === 0 ? 'dialog structure, units, omission, retry sections and styles OK' : 'FAILED'}`);

// ------------------------------------------------------------ cost and tiers

const internals = mod.__internals;
if (internals === undefined) throw new Error('lib/client.js exposes no __internals verification seam');

/** A book shaped exactly as the Host half assembles one. */
const syntheticBook = () => ({
  schema: 1,
  generatedAt: Date.UTC(2026, 9, 5, 0, 0, 0),
  stale: false,
  unit: 'per1MTokens',
  currencies: ['CNY', 'USD'],
  defaultCurrency: 'CNY',
  peakWeekdays: {
    1: [['01:00', '04:00'], ['06:00', '10:00']],
    2: [['01:00', '04:00'], ['06:00', '10:00']],
    3: [['01:00', '04:00'], ['06:00', '10:00']],
    4: [['01:00', '04:00'], ['06:00', '10:00']],
    5: [['01:00', '04:00'], ['06:00', '10:00']],
    6: [],
    7: [],
  },
  windowSource: 'litellm+docs',
  holidays: ['2026-10-01'],
  holidayYears: [2026],
  models: {
    'deepseek-flash': {
      id: 'deepseek-flash',
      aliases: ['deepseek-flash', 'deepseek-v4-flash'],
      prices: {
        CNY: { peak: { inputMiss: 2, inputHit: 0.04, output: 8 }, offPeak: { inputMiss: 1, inputHit: 0.02, output: 4 }, source: 'deepseek-docs-zh' },
        USD: { peak: { inputMiss: 0.3, inputHit: 0.006, output: 1.2 }, offPeak: { inputMiss: 0.15, inputHit: 0.003, output: 0.6 }, source: 'deepseek-docs-en' },
      },
    },
  },
  sources: [],
  warnings: [],
});

// Fixed instants, so the tier assertions do not depend on when this runs.
const MONDAY_PEAK = Date.UTC(2026, 9, 5, 2, 0, 0);
const MONDAY_OFFPEAK = Date.UTC(2026, 9, 5, 5, 0, 0);
const MONDAY_PEAK_EDGE = Date.UTC(2026, 9, 5, 1, 0, 0);
const MONDAY_PEAK_END = Date.UTC(2026, 9, 5, 4, 0, 0);
const SATURDAY_PEAK_HOURS = Date.UTC(2026, 9, 3, 2, 0, 0);
const HOLIDAY_THURSDAY = Date.UTC(2026, 9, 1, 2, 0, 0);

const book = syntheticBook();
internals.priceStore.seed(book);
internals.setCurrency('CNY');

// tier classification, including both window edges and the holiday carve-out
expect(internals.tierAt(MONDAY_PEAK, book) === 'peak', 'a Monday 02:00 UTC request was not classified as peak');
expect(internals.tierAt(MONDAY_OFFPEAK, book) === 'offPeak', 'a Monday 05:00 UTC request was not classified as off-peak');
expect(internals.tierAt(MONDAY_PEAK_EDGE, book) === 'peak', 'the 01:00 UTC window start is not inclusive');
expect(internals.tierAt(MONDAY_PEAK_END, book) === 'offPeak', 'the 04:00 UTC window end is not exclusive');
expect(internals.tierAt(SATURDAY_PEAK_HOURS, book) === 'offPeak', 'a Saturday peak-hour instant was not off-peak');
expect(internals.tierAt(HOLIDAY_THURSDAY, book) === 'offPeak', 'a Chinese public holiday was not excluded from peak hours');
expect(internals.tierAt(Number.NaN, book) === null, 'an unusable timestamp was classified instead of refused');

// amounts: 2264 uncached + 80128 cached + 418 out, per the probe's sample
const pricedAt = (time) => internals.priceStep({ ...probe(), attempts: [{ kind: 'request', seq: 10, index: 1, time, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() }] }, book, 'CNY');
const offPeak = pricedAt(MONDAY_OFFPEAK);
const peak = pricedAt(MONDAY_PEAK);
expect(Math.abs(offPeak.total - (2264 * 1 + 80128 * 0.02 + 418 * 4) / 1e6) < 1e-12, `off-peak CNY amount is wrong: ${offPeak.total}`);
expect(Math.abs(peak.total - (2264 * 2 + 80128 * 0.04 + 418 * 8) / 1e6) < 1e-12, `peak CNY amount is wrong: ${peak.total}`);
expect(Math.abs(peak.total / offPeak.total - 2) < 1e-9, 'peak did not cost exactly twice the off-peak rate');
expect(internals.moneyText(offPeak.total, 'CNY') === '\u00a50.005539', `unexpected CNY rendering: ${internals.moneyText(offPeak.total, 'CNY')}`);
const usdOffPeak = internals.priceStep({ ...probe(), attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() }] }, book, 'USD');
expect(Math.abs(usdOffPeak.total - (2264 * 0.15 + 80128 * 0.003 + 418 * 0.6) / 1e6) < 1e-12, `off-peak USD amount is wrong: ${usdOffPeak.total}`);
expect(internals.moneyText(usdOffPeak.total, 'USD') === '$0.0008308', `unexpected USD rendering: ${internals.moneyText(usdOffPeak.total, 'USD')}`);
expect(internals.moneyText(0, 'CNY') === '\u00a50.00', 'a zero amount is not rendered as zero');
expect(internals.moneyText(123.456, 'CNY') === '\u00a5123.46', 'a large amount is not rendered to two places');
expect(internals.moneyText(1e-9, 'CNY').startsWith('\u00a5<'), 'a sub-precision amount was rounded to a flat zero');

// per-request tiering: one step, one request in each tier
const mixed = internals.priceStep(
  {
    ...probe(),
    attempts: [
      { kind: 'request', seq: 9, index: 1, time: MONDAY_PEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() },
      { kind: 'request', seq: 10, index: 2, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() },
    ],
    requestCount: 2,
  },
  book,
  'CNY',
);
expect(mixed.tiers.size === 2, 'a step spanning both tiers did not record both');
expect(internals.tierLabel(mixed.tiers, t) === zh['tier.mixed'], 'a mixed-tier step is not labelled as mixed');
expect(Math.abs(mixed.total - (peak.total + offPeak.total)) < 1e-12, 'a mixed-tier step did not sum both requests');
expect(mixed.requests[0].tier === 'peak' && mixed.requests[1].tier === 'offPeak', 'per-request tiers were not resolved independently');

// a retired alias must resolve to the model that inherited its rate card
expect(internals.lookupModel(book, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })?.id === 'deepseek-flash', 'a retired model alias did not resolve');
expect(internals.lookupModel(book, { provider: 'deepseek-official', model: 'deepseek/deepseek-flash' })?.id === 'deepseek-flash', 'a provider-qualified model id did not resolve');
expect(internals.lookupModel(book, { provider: 'deepseek-official', model: 'gpt-9' }) === null, 'an unknown model resolved to something');

// an unreported bucket must yield "unknown", never a confident number
const noUsage = internals.priceStep({ ...probe(), attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage({ cacheRead: null }) }] }, book, 'CNY');
expect(noUsage.total === null, 'a sample with no cache-read count was priced anyway');
expect(noUsage.partial === true, 'an unpriceable request did not mark the step partial');

// a partially priceable step reports a lower bound, not a total
const partly = internals.priceStep(
  {
    ...probe(),
    attempts: [
      { kind: 'request', seq: 9, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() },
      { kind: 'request', seq: 10, index: 2, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'gpt-9' }, usage: usage() },
    ],
    requestCount: 2,
  },
  book,
  'CNY',
);
expect(partly.unpriced === 1 && partly.priced === 1, 'a partly priceable step miscounted its requests');
expect(partly.partial === true, 'a partly priceable step is not marked partial');

// rendering
const costTree = renderer({
  node: {
    data: probe({
      attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() }],
    }),
  },
  t,
});
const costPanel = byClass(costTree, 'stu-panel')[0];
const costText = walk(costPanel).map(textOf).join(' ');
expect(costText.includes('\u00a50.005539'), 'the dialog does not show the step amount');
expect(costText.includes(zh['cost.section']), 'the dialog has no cost section');
expect(costText.includes(zh['tier.offPeak']), 'the dialog does not name the off-peak tier');
expect(textOf(byClass(costTree, 'stu-root')[0]).includes('\u00a50.005539'), 'the collapsed pill does not show the amount');

const rerender = () => {
  const tree = renderer({
    node: {
      data: probe({
        attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'deepseek-flash' }, usage: usage() }],
      }),
    },
    t,
  });
  return { tree, panel: byClass(tree, 'stu-panel')[0], text: walk(byClass(tree, 'stu-panel')[0]).map(textOf).join(' ') };


// per-bucket unit prices and contributions: the amount must be readable as the
// sum of the rows above it, not taken on trust
// per-bucket prices are off by default like the other detail sections
expect(byClass(costPanel, 'stu-unitPrice').length === 0, 'per-bucket unit prices are visible by default');
internals.setPreference('showRowPrices', true);
const pricedPanel = byClass(rerender().tree, 'stu-panel')[0];
const bucketPrices = byClass(pricedPanel, 'stu-unitPrice');
expect(bucketPrices.length >= 3, `expected a unit price on each bucket row, found ${bucketPrices.length}`);
const priceTexts = bucketPrices.map(textOf);
expect(priceTexts.some((text) => text.includes('\u00a51/1M')), `the uncached-input unit price is missing: ${JSON.stringify(priceTexts)}`);
expect(priceTexts.some((text) => text.includes('\u00a50.02/1M')), `the cache-read unit price is missing: ${JSON.stringify(priceTexts)}`);
expect(priceTexts.some((text) => text.includes('\u00a54/1M')), `the output unit price is missing: ${JSON.stringify(priceTexts)}`);
expect(priceTexts.some((text) => text.includes('\u00a50.002264')), `the uncached-input contribution is missing: ${JSON.stringify(priceTexts)}`);
expect(priceTexts.some((text) => text.includes('\u00a50.001603')), `the cache-read contribution is missing: ${JSON.stringify(priceTexts)}`);
expect(priceTexts.some((text) => text.includes('\u00a50.001672')), `the output contribution is missing: ${JSON.stringify(priceTexts)}`);
// the rows must add up to the total the section header states
const contributions = [0.002264, 0.001603, 0.001672];
expect(Math.abs(contributions.reduce((sum, value) => sum + value, 0) - 0.005539) < 1e-9, 'the per-bucket contributions do not sum to the step total');
expect(walk(pricedPanel).map(textOf).join(' ').includes('\u00a50.005539'), 'the per-bucket rows and the step total disagree');

// the three heavy sections are hidden by default, and the preferences bring
// each one back
expect(!costText.includes(zh['source.deepseek-docs-zh']), 'the unit-price source is visible by default');
expect(!costText.includes(zh['note.costBasis']), 'the derivation note is visible by default');
expect(!costText.includes(zh['note.costWindowSource'].replace('{source}', zh['sourceName.litellm+docs'])), 'the peak-window note is visible by default');
expect(byClass(costPanel, 'stu-costToggle').length === 0, 'the currency control is visible by default');

};

internals.setPreference('showSource', true);
internals.setPreference('showBasis', true);
internals.setPreference('showCurrency', true);
const revealed = rerender();
expect(revealed.text.includes(zh['source.deepseek-docs-zh']), 'showSource did not reveal the unit-price source');
expect(revealed.text.includes(zh['note.costBasis']), 'showBasis did not reveal the derivation note');
expect(revealed.text.includes(zh['note.costWindowSource'].replace('{source}', zh['sourceName.litellm+docs'])), 'showBasis did not reveal the peak-window note');
expect(byClass(revealed.panel, 'stu-costToggle').length === 1, 'showCurrency did not reveal the currency control');
expect(revealed.text.includes('CNY') && revealed.text.includes('USD'), 'the currency control does not offer both currencies');
expect(revealed.text.includes('\u00a50.005539'), 'revealing the sections changed the amount');

// the currency control switches the rendered currency
internals.setCurrency('USD');
const usdText = rerender().text;
expect(usdText.includes('$0.0008308'), 'switching to USD did not re-price the step');
internals.setPreference('showRowPrices', true);
expect(rerender().text.includes('$0.15/1M'), 'switching to USD did not switch the unit prices');
internals.setPreference('showRowPrices', false);
expect(usdText.includes(zh['source.deepseek-docs-en']), 'switching to USD did not switch the unit-price source');
internals.setCurrency('CNY');
expect(rerender().text.includes('\u00a50.005539'), 'the default currency is not CNY');

// back to the defaults the rest of the suite assumes
internals.setPreference('showRowPrices', false);
internals.setPreference('showSource', false);
internals.setPreference('showBasis', false);
internals.setPreference('showCurrency', false);

// an unpriced model says so instead of showing a number
const unknownTree = renderer({
  node: {
    data: probe({
      attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'deepseek-official', model: 'gpt-9' }, usage: usage() }],
      routes: [{ provider: 'deepseek-official', model: 'gpt-9' }],
    }),
  },
  t,
});
const unknownText = walk(byClass(unknownTree, 'stu-panel')[0]).map(textOf).join(' ');
expect(unknownText.includes(zh['cost.unknown']), 'an unpriced model did not report an unknown amount');
expect(unknownText.includes(zh['note.costUnknownModel'].replace('{model}', 'gpt-9')), 'an unpriced model is not explained');
expect(!/\u00a5\d/.test(unknownText), 'an unpriced model still produced a currency amount');

// with no book at all, the dialog says why rather than staying silent
internals.priceStore.seed(null, { status: 'unavailable' });
const noBookText = walk(byClass(renderer({ node: { data: probe() }, t }), 'stu-panel')[0]).map(textOf).join(' ');
expect(noBookText.includes(zh['note.costNoBook']), 'a missing price book is not explained');

// still loading: stay silent rather than claim "unknown" for a reason that is
// merely "not yet" — and the token caveats must be unaffected
internals.priceStore.seed(null, { status: 'loading' });
const loadingPanel = byClass(
  renderer({
    node: {
      data: probe({
        attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage({ cacheWrite: null }) }],
        buckets: usage({ cacheWrite: null }),
        missingOptionalBuckets: ['cacheWrite'],
      }),
    },
    t,
  }),
  'stu-panel',
)[0];
const loadingText = walk(loadingPanel).map(textOf).join(' ');
expect(!loadingText.includes(zh['cost.section']), 'a cost section appears while the price book is still loading');
expect(byClass(loadingPanel, 'stu-costNotes').length === 0, 'a cost note appears while the price book is still loading');
expect(byClass(loadingPanel, 'stu-tokenNotes').length === 1, 'the token notes vanished while the price book loads');

// a step with no reported usage cannot be priced, and already says why
internals.priceStore.seed(book);
const emptyBuckets = { input: null, cacheRead: null, cacheWrite: null, output: null, reasoning: null, total: null };
const noUsagePanel = byClass(renderer({ node: { data: probe({ attempts: [], requestCount: 0, hasUsage: false, buckets: emptyBuckets, totalTokens: null, routes: [] }) }, t }), 'stu-panel')[0];
const noUsageText = walk(noUsagePanel).map(textOf).join(' ');
expect(!noUsageText.includes(zh['cost.section']), 'a cost section appears on a step with no reported usage');
expect(!noUsageText.includes(zh['note.costUnknownModel'].replace('{model}', '')), 'a usage-less step blames a missing unit price');

// every state renders without throwing, and never prints a bare currency sign
const renderMatrix = [
  ['priced off-peak', book, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() }] })],
  ['priced peak', book, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_PEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() }] })],
  ['priced on a holiday', book, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: HOLIDAY_THURSDAY, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() }] })],
  ['priced through an alias', book, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_PEAK, route: { provider: 'p', model: 'deepseek-v4-flash' }, usage: usage() }] })],
  ['multi-request mixed tiers', book, probe({ requestCount: 2, attempts: [
    { kind: 'request', seq: 9, index: 1, time: MONDAY_PEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() },
    { kind: 'request', seq: 10, index: 2, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() },
  ] })],
  ['partial: one unpriced request', book, probe({ requestCount: 2, attempts: [
    { kind: 'request', seq: 9, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() },
    { kind: 'request', seq: 10, index: 2, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'gpt-9' }, usage: usage() },
  ] })],
  ['unknown model', book, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'gpt-9' }, usage: usage() }] })],
  ['missing cache bucket', book, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage({ cacheRead: null }) }] })],
  ['retry plus request', book, probe({ retryCount: 1, attempts: [
    { kind: 'retry', seq: 9, attempt: 1, maxRetries: 3, failure: { code: 'TRANSPORT', message: 'boom' }, route: { provider: 'p', model: null }, usage: null },
    { kind: 'request', seq: 10, index: 1, time: MONDAY_PEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() },
  ] })],
  ['no usage at all', book, probe({ attempts: [], requestCount: 0, hasUsage: false, buckets: emptyBuckets, totalTokens: null, routes: [] })],
  ['stale book', { ...book, stale: true }, probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() }] })],
  ['no book', null, probe()],
  ['loading book', null, probe()],
];
/** Concatenated text of a tree, skipping any subtree carrying one class token. */
function textSkipping(node, skipToken, out = []) {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (node === null || node === undefined || typeof node !== 'object') return out;
  const classes = typeof node.props?.className === 'string' ? node.props.className.split(/\s+/) : [];
  if (classes.includes(skipToken)) return out;
  for (const child of node.children ?? []) textSkipping(child, skipToken, out);
  return out;
}

for (const [label, matrixBook, data] of renderMatrix) {
  const status = matrixBook === null ? (label === 'loading book' ? 'loading' : 'unavailable') : 'ready';
  internals.priceStore.seed(matrixBook, { status, fetchedAt: Date.now() });
  let tree = null;
  try {
    tree = renderer({ node: { data }, t });
  } catch (error) {
    expect(false, `rendering the "${label}" state threw: ${error.message}`);
    continue;
  }
  const panel = byClass(tree, 'stu-panel')[0];
  expect(panel !== undefined, `the "${label}" state produced no dialog`);
  if (panel === undefined) continue;
  // A currency sign must never appear without a number (or a bound) after it.
  // The currency control's own labels ("¥ CNY") are a menu, not an amount.
  const text = textSkipping(panel, 'stu-costToggle').join(' ');
  for (const token of text.match(/[\u00a5$][^\d<]/g) ?? []) expect(false, `the "${label}" state printed a bare currency sign: ${JSON.stringify(token)}`);
}
internals.priceStore.seed(book);

// --------------------------------------------------------------- turn total

// The per-turn row is its own Definition over the turn's whole evidence, so it
// is driven here exactly the way the engine drives it.
const turnMatch = (event) => turnDefinition.match(event);
const turnContext = (events, id) => {
  const matches = events
    .map((event) => ({ event, role: turnMatch(event)?.role, location: { kind: 'unresolved' } }))
    .filter((match) => match.role !== undefined);
  return {
    key: `${turnDefinition.kind.length}:${turnDefinition.kind}${id}`,
    kind: turnDefinition.kind,
    id,
    matches,
    start: matches.find((match) => match.role === 'start'),
    state: undefined,
    current: new Map(),
  };
};
const assistantEvent = (turn, step, seq, time, model = 'deepseek-flash', input = 2264, cacheRead = 80128, output = 418) => ({
  type: 'assistant/message',
  seq,
  time,
  surfaceOp: 'append',
  data: {
    turn,
    step,
    usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: 0, totalTokens: input + cacheRead + output },
    message: { source: { provider: 'deepseek-official', model } },
  },
});
const turnStart = (turn, seq) => ({ type: 'turn/start', seq, time: 0, data: { turn } });
const turnEnd = (turn, seq) => ({ type: 'turn/end', seq, time: 0, data: { turn, reason: { kind: 'completed' } } });

// turn 1 spans both tiers across two steps
const turnOneEvents = [
  turnStart(1, 1),
  assistantEvent(1, 1, 2, MONDAY_OFFPEAK, 'deepseek-flash', 2264, 80128, 418),
  assistantEvent(1, 2, 3, MONDAY_PEAK, 'deepseek-flash', 2264, 80128, 418),
  turnEnd(1, 4),
];
const turnOneNode = turnDefinition.buildViewNode(turnContext(turnOneEvents, '1'));
expect(turnOneNode !== null, 'a completed turn produced no money row');
const turnOneData = turnOneNode?.data;
expect(turnOneData?.steps.length === 2, `the turn row folded ${turnOneData?.steps.length} steps, expected 2`);
expect(turnOneNode?.anchorSeq === 3, `the turn row anchored at ${turnOneNode?.anchorSeq}, expected the last settled message (3)`);
expect(turnOneNode?.kind === internals.TURN_KIND, 'the turn row is not the turn-cost kind');

const turnOneCost = internals.priceSteps(turnOneData.steps, book, 'CNY');
expect(turnOneCost.priced === 2, `the turn priced ${turnOneCost.priced} requests, expected 2`);
expect(Math.abs(turnOneCost.total - (offPeak.total + peak.total)) < 1e-12, `the turn total ${turnOneCost.total} is not the sum of its steps`);
expect(turnOneCost.tiers.size === 2, 'a turn spanning both tiers did not record both');
expect(turnOneCost.partial === false, 'a fully priced turn was marked partial');

// the anchor must never pass the closing message, or the shipped footer greys
// out its branch action
for (const node of [turnOneNode]) {
  const closing = turnOneEvents.filter((event) => event.type === 'assistant/message').at(-1).seq;
  expect(node.anchorSeq <= closing, `the turn row anchored past the closing message (${node.anchorSeq} > ${closing})`);
}

// turns must not leak into each other
const turnTwoNode = turnDefinition.buildViewNode(turnContext([turnStart(2, 10), assistantEvent(2, 1, 11, MONDAY_OFFPEAK), turnEnd(2, 12)], '2'));
const turnTwoCost = internals.priceSteps(turnTwoNode.data.steps, book, 'CNY');
expect(Math.abs(turnTwoCost.total - offPeak.total) < 1e-12, `turn 2 picked up turn 1's requests: ${turnTwoCost.total}`);

// a turn with nothing billed yields no row at all
expect(turnDefinition.buildViewNode(turnContext([turnStart(9, 20), turnEnd(9, 21)], '9')) === null, 'a turn with no billed request produced a row');

// an unpriced model makes the turn a lower bound, not a wrong number
const turnThreeNode = turnDefinition.buildViewNode(turnContext([turnStart(3, 30), assistantEvent(3, 1, 31, MONDAY_OFFPEAK, 'gpt-9'), turnEnd(3, 32)], '3'));
const turnThreeCost = internals.priceSteps(turnThreeNode.data.steps, book, 'CNY');
expect(turnThreeCost.total === null && turnThreeCost.partial === true, 'a wholly unpriced turn did not report itself as unpriced');

// rendering the row
internals.priceStore.seed(book);
internals.setCurrency('CNY');
const turnTree = turnRenderer({ node: turnOneNode, t });
const turnText = textOf(turnTree);
const expectedTurnTotal = internals.moneyText(offPeak.total + peak.total, 'CNY');
expect(turnText.includes(expectedTurnTotal), `the turn row does not show ${expectedTurnTotal}; got ${JSON.stringify(turnText)}`);
expect(turnText.includes(zh['tier.mixed']), 'a mixed-tier turn is not labelled as mixed');
expect(turnText.includes(zh['cost.turnTotal']), 'the turn row does not label itself');
expect(turnTree?.props?.['data-turn-cost'] === 1, 'the turn row is not tagged with its turn');

// a turn whose requests are all unpriced says so rather than vanishing
const unpricedTurnText = textOf(turnRenderer({ node: turnThreeNode, t }));
expect(unpricedTurnText.includes(zh['pill.priceUnknown']), 'an unpriced turn shows nothing instead of saying so');

// with no book the row stays silent
internals.priceStore.seed(null, { status: 'unavailable' });
expect(turnRenderer({ node: turnOneNode, t }) === null, 'the turn row rendered without a price book');
internals.priceStore.seed(book);

// the composer chip totals every turn row that has been materialized
internals.turnIndex.clear();
internals.recordTurn(1, turnOneData.steps);
internals.recordTurn(2, turnTwoNode.data.steps);
internals.recordTurn(2, turnTwoNode.data.steps);
expect(internals.turnIndex.size === 2, `the turn index holds ${internals.turnIndex.size} turns, expected 2 — a turn was double-counted`);
const chipText = textOf(composerChip({ t }));
expect(chipText.includes(internals.moneyText(offPeak.total * 2 + peak.total, 'CNY')), `the composer chip does not total every loaded turn; got ${JSON.stringify(chipText)}`);

// The chip is shaped like the pills it sits beside: the currency sign on the
// icon seat (where they put a 14px svg) and the amount on the label, so the two
// take the same type size and line box instead of the sign dragging the chip
// off the row.
const chip = composerChip({ t });
const chipIcons = byClass(chip, 'stu-turnIcon');
const chipValues = byClass(chip, 'stu-turnValue');
expect(chipIcons.length === 1 && textOf(chipIcons[0]) === '\u00a5', `the chip has no icon seat holding the currency sign; got ${JSON.stringify(chipIcons.map(textOf))}`);
expect(
  chipValues.length === 1 && textOf(chipValues[0]) === chipText.replace('\u00a5', ''),
  `the chip's value does not hold the amount on its own; got ${JSON.stringify(chipValues.map(textOf))}`,
);

// with no turn seen yet, the chip renders nothing rather than zero
internals.turnIndex.clear();
expect(composerChip({ t }) === null, 'the composer chip rendered a total before any turn was recorded');
internals.priceStore.seed(null, { status: 'unavailable' });
expect(composerChip({ t }) === null, 'the composer chip rendered without a price book');
internals.priceStore.seed(book);
internals.turnIndex.clear();

console.log(`turn total    : ${problems.length === 0 ? 'per-turn fold, anchor safety, tier mix, composer total and unpriced turns OK' : 'FAILED'}`);

// ----------------------------------------------------------------- settings

// Every preference the cost detail can hide must have a row that brings it
// back, with copy in both locales and a switch that actually writes through.
const preferenceNames = Object.keys(internals.PREFERENCE_DEFAULTS);
expect(settingsRows.length === preferenceNames.length, `${settingsRows.length} settings rows for ${preferenceNames.length} preferences`);
expect(new Set(settingsRows.map((row) => row.options.id)).size === settingsRows.length, 'two settings rows share an id');
expect(
  new Set(settingsRows.map((row) => row.options.order)).size === settingsRows.length,
  'two settings rows share an order',
);

for (const name of preferenceNames) {
  const row = settingsRows.find((candidate) => candidate.options.id === `step-token-usage-${name}`);
  expect(row !== undefined, `preference "${name}" has no settings row`);
  if (row === undefined) continue;
  expect(row.options.locale === 'step-token-usage', `settings row for "${name}" declares locale "${row.options.locale}"`);
  expect(typeof zh[`preference.${name}.title`] === 'string', `no zh title for preference "${name}"`);
  expect(typeof zh[`preference.${name}.description`] === 'string', `no zh description for preference "${name}"`);
  expect(typeof enDict[`preference.${name}.title`] === 'string', `no en title for preference "${name}"`);
  expect(typeof enDict[`preference.${name}.description`] === 'string', `no en description for preference "${name}"`);

  internals.setPreference(name, false);
  const offTree = row.component({ t });
  const offText = walk(offTree).map(textOf).join(' ');
  expect(offText.includes(zh[`preference.${name}.title`]), `the "${name}" row does not render its title`);
  expect(offText.includes(zh[`preference.${name}.description`]), `the "${name}" row does not render its description`);
  expect(offTree?.props?.['data-preference'] === name, `the "${name}" row is not tagged with its preference`);

  const switchOff = walk(offTree).find((node) => node.props?.role === 'switch');
  expect(switchOff !== undefined, `the "${name}" row has no switch`);
  expect(switchOff?.props?.['aria-checked'] === false, `the "${name}" switch does not start off`);
  expect(switchOff?.props?.['aria-label'] === zh[`preference.${name}.title`], `the "${name}" switch has no accessible label`);

  switchOff?.props?.onClick();
  expect(internals.preferenceStore.values[name] === true, `flipping the "${name}" switch did not set the preference`);
  const onTree = row.component({ t });
  expect(walk(onTree).find((node) => node.props?.role === 'switch')?.props?.['aria-checked'] === true, `the "${name}" switch did not re-render as on`);

  // and the row's switch must move the dialog, which is the whole point
  internals.priceStore.seed(book);
  internals.setPreference(name, false);
  const hiddenText = walk(byClass(renderer({ node: { data: probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() }] }) }, t }), 'stu-panel')[0]).map(textOf).join(' ');
  internals.setPreference(name, true);
  const shownText = walk(byClass(renderer({ node: { data: probe({ attempts: [{ kind: 'request', seq: 10, index: 1, time: MONDAY_OFFPEAK, route: { provider: 'p', model: 'deepseek-flash' }, usage: usage() }] }) }, t }), 'stu-panel')[0]).map(textOf).join(' ');
  const marker =
    name === 'showBasis' ? zh['note.costBasis']
    : name === 'showSource' ? zh['source.deepseek-docs-zh']
    : name === 'showRowPrices' ? '\u00a51/1M'
    : 'USD';
  expect(!hiddenText.includes(marker), `"${name}" is visible while off`);
  expect(shownText.includes(marker), `turning "${name}" on did not reveal it`);
  internals.setPreference(name, false);
}

expect(internals.preferenceStore.values.showRowPrices === false, 'showRowPrices did not return to its default');
expect(internals.preferenceStore.values.showBasis === false, 'showBasis did not return to its default');
expect(internals.preferenceStore.values.showSource === false, 'showSource did not return to its default');
expect(internals.preferenceStore.values.showCurrency === false, 'showCurrency did not return to its default');

console.log(`settings      : ${problems.length === 0 ? 'every hidden section has a row, both locales, and a switch that writes through' : 'FAILED'}`);

console.log(`cost          : ${problems.length === 0 ? 'amounts, tiers, holiday carve-out, currency, unknowns and every render state OK' : 'FAILED'}`);

// ------------------------------------------------------------- host sources

// The two pricing pages are parsed as tables, and the peak rule as prose. The
// fixtures reproduce the shipped markup exactly, including the rowspanning
// `PRICING` cell that shifts the bucket label off the first column.
const EN_PRICING_HTML = `<table><tr><td colspan="3" style="text-align:center">MODEL</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr>
<tr><td colspan="3">MODEL VERSION</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro-0813</td></tr>
<tr><td rowspan="7">PRICING<sup>(2)</sup></td><td rowspan="2">1M INPUT TOKENS<br>(CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
<tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
<tr><td rowspan="2">1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
<tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr>
<tr><td colspan="3">Concurrency Limit<sup>(3)</sup></td><td>2500</td><td>500</td></tr></table>
<div>(2) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.</div>`;

const ZH_PRICING_HTML = `<table><tr><td colspan="3" style="text-align:center">模型</td><td>deepseek-flash<sup>(1)</sup></td><td>deepseek-v4-pro</td></tr>
<tr><td rowspan="7">价格<sup>(2)</sup></td><td rowspan="2">百万tokens输入<br>（缓存命中）</td><td>空闲时段</td><td>0.02元</td><td>0.15元</td></tr>
<tr><td>高峰时段</td><td>0.04元</td><td>0.30元</td></tr>
<tr><td rowspan="2">百万tokens输入<br>（缓存未命中）</td><td>空闲时段</td><td>1元</td><td>4.5元</td></tr>
<tr><td>高峰时段</td><td>2元</td><td>9.0元</td></tr>
<tr><td rowspan="2">百万tokens输出</td><td>空闲时段</td><td>4元</td><td>13.5元</td></tr>
<tr><td>高峰时段</td><td>8元</td><td>27.0元</td></tr>
<tr><td colspan="3">并发限制<sup>(3)</sup></td><td>2500</td><td>500</td></tr></table>
<div>(2) 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。</div>`;

const LITELLM_FIXTURE = {
  'deepseek-flash': {
    litellm_provider: 'deepseek',
    input_cost_per_token: 3e-7,
    output_cost_per_token: 1.2e-6,
    cache_read_input_token_cost: 6e-9,
    off_peak_pricing: {
      input_cost_per_token: 1.5e-7,
      output_cost_per_token: 6e-7,
      cache_read_input_token_cost: 3e-9,
      windows: [
        { hours_utc: ['00:00-01:00', '04:00-06:00', '10:00-00:00'], weekdays: [1, 2, 3, 4, 5] },
        { hours_utc: '00:00-00:00', weekdays: [6, 7] },
      ],
    },
  },
  // Retired name, USD only: it must fold into the model that inherited the card.
  'deepseek/deepseek-v4-flash': {
    litellm_provider: 'deepseek',
    input_cost_per_token: 3e-7,
    output_cost_per_token: 1.2e-6,
    cache_read_input_token_cost: 6e-9,
  },
  // A different vendor's model must never leak into the DeepSeek rate card.
  'openrouter/deepseek/deepseek-chat': { litellm_provider: 'openrouter', input_cost_per_token: 9e-7, output_cost_per_token: 9e-7 },
};

const HOLIDAY_FIXTURE = {
  year: 2026,
  days: [
    { name: '国庆节', date: '2026-10-01', isOffDay: true },
    { name: '国庆节', date: '2026-10-02', isOffDay: true },
    { name: '调休', date: '2026-10-10', isOffDay: false },
  ],
};

const host = await import(join(repo, 'lib', 'index.js'));

const en = host.parseDocsPricing(EN_PRICING_HTML, 'USD');
expect(Object.keys(en.models).length === 2, `the English rate card parsed ${Object.keys(en.models).length} models, expected 2`);
expect(en.models['deepseek-flash']?.peak.inputMiss === 0.3, 'the English peak input price is wrong');
expect(en.models['deepseek-flash']?.offPeak.inputMiss === 0.15, 'the English off-peak input price is wrong');
expect(en.models['deepseek-flash']?.peak.output === 1.2, 'the English peak output price is wrong');
expect(en.models['deepseek-v4-pro']?.offPeak.output === 1.98, 'the English off-peak pro output price is wrong');

const zhCard = host.parseDocsPricing(ZH_PRICING_HTML, 'CNY');
expect(zhCard.models['deepseek-flash']?.peak.inputMiss === 2, 'the Chinese peak input price is wrong');
expect(zhCard.models['deepseek-flash']?.offPeak.inputMiss === 1, 'the Chinese off-peak input price is wrong');
expect(zhCard.models['deepseek-flash']?.peak.inputHit === 0.04, 'the Chinese peak cache-hit price is wrong');
expect(zhCard.models['deepseek-v4-pro']?.peak.output === 27, 'the Chinese pro output price is wrong');
expect(Object.keys(host.parseDocsPricing('<table></table>', 'USD').models).length === 0, 'an empty page parsed into models');

// both footnotes state the same window, in different clocks
const enRule = host.parsePeakRule(EN_PRICING_HTML);
const zhRule = host.parsePeakRule(ZH_PRICING_HTML);
expect(JSON.stringify(enRule.ranges) === '[[60,240],[360,600]]', `the English peak rule parsed as ${JSON.stringify(enRule.ranges)}`);
expect(JSON.stringify(zhRule.ranges) === '[[540,720],[840,1080]]', `the Chinese peak rule parsed as ${JSON.stringify(zhRule.ranges)}`);
expect(host.parsePeakRule('<p>no rule here</p>') === null, 'an absent peak rule was invented');
const enWeekdays = host.peakWeekdaysFromRanges(enRule.ranges, enRule.timezone);
const zhWeekdays = host.peakWeekdaysFromRanges(zhRule.ranges, zhRule.timezone);
expect(JSON.stringify(enWeekdays) === JSON.stringify(zhWeekdays), 'the two locales disagree about the peak window');
expect(JSON.stringify(enWeekdays[1]) === '[["01:00","04:00"],["06:00","10:00"]]', `the derived weekday window is wrong: ${JSON.stringify(enWeekdays[1])}`);
expect(JSON.stringify(enWeekdays[6]) === '[]' && JSON.stringify(enWeekdays[7]) === '[]', 'weekends were given a peak window');

// LiteLLM's off-peak windows invert to the same peak set
const litellm = host.normalizeLitellm(LITELLM_FIXTURE);
expect(!('openrouter/deepseek/deepseek-chat' in litellm.models), 'a third-party route leaked into the official rate card');
expect(litellm.models['deepseek-flash'].peak.inputMiss === 0.3, 'LiteLLM peak prices were misread (they are the base fields)');
expect(JSON.stringify(host.peakWeekdaysFromWindows(LITELLM_FIXTURE['deepseek-flash'].off_peak_pricing.windows)) === JSON.stringify(enWeekdays), 'LiteLLM windows do not invert to the documented peak set');
expect(host.peakWeekdaysFromWindows([]) === null, 'empty windows produced a window instead of nothing');

const holidays = host.normalizeHolidays(HOLIDAY_FIXTURE, 2026);
expect(JSON.stringify(holidays.offDays) === '["2026-10-01","2026-10-02"]', `holiday off-days parsed as ${JSON.stringify(holidays.offDays)}`);
expect(host.normalizeHolidays(null, 2026).offDays.length === 0, 'a missing holiday file produced days');

const assembled = host.assembleBook({ generatedAt: 0, docsZh: zhCard, docsEn: en, litellm, docsRule: enRule, holidays: holidays.offDays, holidayYears: [2026] });
expect(assembled.defaultCurrency === 'CNY', 'the assembled book does not default to CNY');
expect(assembled.currencies.join(',') === 'CNY,USD', `the assembled book publishes ${assembled.currencies.join(',')}`);
expect(assembled.windowSource === 'litellm+docs', `the window source is "${assembled.windowSource}" instead of litellm+docs`);
expect(assembled.peakWeekdays[6].length === 0, 'the assembled book gives weekends a peak window');
expect(assembled.holidays.includes('2026-10-01'), 'the assembled book lost its holidays');
expect(assembled.models['deepseek-flash'].aliases.includes('deepseek-v4-flash'), 'the retired alias did not fold into deepseek-flash');
expect(assembled.models['deepseek-flash'].prices.CNY.source === 'deepseek-docs-zh', 'the CNY prices did not come from the Chinese rate card');
expect(assembled.models['deepseek-flash'].prices.USD.source === 'deepseek-docs-en', 'the USD prices did not come from the English rate card');
expect(assembled.models['deepseek-flash'].prices.CNY.offPeak.inputMiss === 1, 'the folded entry lost its CNY off-peak price');

// a disagreement between the two window sources must not be resolved silently
const contradicting = host.assembleBook({
  generatedAt: 0,
  docsZh: zhCard,
  docsEn: en,
  litellm: { models: litellm.models, windows: host.peakWeekdaysFromRanges([[0, 1440]], 'UTC') },
  docsRule: enRule,
  holidays: [],
});
expect(contradicting.windowSource === 'docs', 'a window disagreement did not fall back to the official page');
expect(contradicting.warnings.includes('price-window-disagreement'), 'a window disagreement was not reported');

// with no window source at all, the built-in rule applies and is declared
const bare = host.assembleBook({ generatedAt: 0, docsEn: en, litellm: { models: litellm.models, windows: null } });
expect(bare.windowSource === 'builtin', `a window-less book reported "${bare.windowSource}"`);
expect(bare.warnings.includes('price-window-fallback-builtin'), 'the built-in window fallback was not declared');
expect(JSON.stringify(bare.peakWeekdays) === JSON.stringify(host.BUILTIN_PEAK.weekdays), 'the built-in fallback window is not the published rule');

console.log(`host sources  : ${problems.length === 0 ? 'both rate cards, both footnotes, windows, holidays and merging OK' : 'FAILED'}`);

// -------------------------------------------------------------- session sweep

const sessionsRoot = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'sessions') : join(homedir(), '.dsh', 'sessions');

const stats = {
  files: 0,
  steps: 0,
  materialized: 0,
  withUsage: 0,
  withoutUsage: 0,
  requests: 0,
  retries: 0,
  missingCore: 0,
  missingOptional: 0,
  invariantOk: 0,
  invariantBad: 0,
  anchorBad: 0,
  noSettledMessage: 0,
  unmaterialized: 0,
};

/** Decompress one session log; `--` keeps a dashed path from parsing as a flag. */
function readEvents(dir) {
  const modern = join(dir, 'session.v4.jsonl.zstd');
  const legacy = join(dir, 'session.jsonl.zstd');
  const target = existsSync(modern) ? modern : existsSync(legacy) ? legacy : null;
  if (target === null) return null;
  let text;
  try {
    text = execFileSync('zstd', ['-dc', '--', target], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return null;
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function collectSessionDirs() {
  if (!existsSync(sessionsRoot)) return [];
  return readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((workspace) => {
      const base = join(sessionsRoot, workspace.name);
      try {
        return readdirSync(base, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
          .map((entry) => join(base, entry.name));
      } catch {
        return [];
      }
    });
}

const sessionDirs = collectSessionDirs();

if (sessionDirs.length === 0) {
  console.log(`\nNo session logs under ${sessionsRoot} — registration and markup checks only.`);
} else {
  for (const dir of sessionDirs) {
    const events = readEvents(dir);
    if (events === null) continue;
    stats.files += 1;

    const byStep = new Map();
    for (const event of events) {
      const matched = definition.match(event);
      if (matched === null) continue;
      const list = byStep.get(matched.id) ?? [];
      list.push({ event, role: matched.role, location: { kind: 'unresolved' } });
      byStep.set(matched.id, list);
    }

    for (const [id, matches] of byStep) {
      stats.steps += 1;
      const context = {
        key: `${definition.kind.length}:${definition.kind}${id}`,
        kind: definition.kind,
        id,
        matches,
        start: matches.find((match) => match.role === 'start'),
        state: undefined,
        current: new Map(),
      };

      const node = definition.buildViewNode(context);
      if (node === null) {
        stats.unmaterialized += 1;
        continue;
      }
      stats.materialized += 1;

      const data = node.data;
      if (data.hasUsage) stats.withUsage += 1;
      else stats.withoutUsage += 1;
      stats.requests += data.requestCount;
      stats.retries += data.retryCount;
      if (data.missingCoreBuckets.length > 0) stats.missingCore += 1;
      if (data.missingOptionalBuckets.length > 0) stats.missingOptional += 1;

      expect(node.key === context.key, `unstable node key "${node.key}" for "${context.key}"`);
      expect(node.target === definition.target, `node target "${node.target}" is not "${definition.target}"`);

      const settled = matches.filter((match) => match.event.type === 'assistant/message' && match.event.surfaceOp === 'append').at(-1);

      if (settled === undefined) {
        stats.noSettledMessage += 1;
      } else if (node.anchorSeq !== settled.event.seq) {
        // Any other anchor is either folded into the Turn's collapsed process
        // group or read as later transcript by the shipped Turn tail, which
        // disables its branch action. Both are regressions.
        stats.anchorBad += 1;
      }

      const raw = settled?.event?.data?.usage;
      if (raw && data.buckets.total !== null) {
        const sum = (raw.inputTokens ?? 0) + (raw.cacheReadTokens ?? 0) + (raw.cacheWriteTokens ?? 0) + (raw.outputTokens ?? 0);
        if (sum === data.buckets.total) stats.invariantOk += 1;
        else stats.invariantBad += 1;
      }
    }
  }
}

console.log('\n--- sweep ---');
console.log(JSON.stringify(stats, null, 1));

if (stats.invariantBad > 0) problems.push(`${stats.invariantBad} usage samples contradict total = sum of buckets`);
if (stats.anchorBad > 0) problems.push(`${stats.anchorBad} rows anchored away from their settled message`);

console.log(problems.length === 0 ? '\nOK — no assertion failed.' : `\nFAILED:\n  - ${problems.join('\n  - ')}`);
process.exit(problems.length === 0 ? 0 : 1);
