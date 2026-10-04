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

// ------------------------------------------------------------------ fake host

let registration = null;
const dictionaries = new Map();
let definition = null;
let renderer = null;

globalThis.window = {
  __ModuleLoader__: { load: (entry) => (registration = entry) },
  innerWidth: 1280,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.document = {
  createElement: () => ({ dataset: {}, remove() {} }),
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
 * the component can be invoked headlessly and its markup inspected.
 */
const element = (type, props, ...children) => ({
  type,
  props: props ?? {},
  children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
});

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
        definition = candidate;
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
      expect(options.name === 'conversation.chat.node', `unexpected slot "${options.name}"`);
      expect(options.key === definition.kind, `renderer key "${options.key}" does not match definition kind "${definition.kind}"`);
      expect(options.locale !== undefined, 'renderer declares no locale namespace');
      expect(typeof component === 'function', 'renderer is not a component function');
      renderer = component;
      registered.push(`slot ${options.name} key=${options.key}`);
      return noop;
    },
  },
});

if (definition === null) throw new Error('no Conversation Definition was registered');
if (renderer === null) throw new Error('no renderer was registered');
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
expect(textOf(byClass(omittedPanel, 'stu-note')[0] ?? { children: [] }).includes('缓存读取'), 'the footnote does not name the omitted bucket');

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

console.log(`markup        : ${problems.length === 0 ? 'dialog structure, units, omission and retry sections OK' : 'FAILED'}`);

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
