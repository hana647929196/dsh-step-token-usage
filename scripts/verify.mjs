#!/usr/bin/env node
/**
 * Offline verification for dsh-step-token-usage.
 *
 * Mounts the Client half against a fake module loader and Cordis context, then
 * drives the registered Definition over every stored session log on this
 * machine. It checks the things that are hard to eyeball in the browser:
 *
 *   - the Definition and the renderer cell register under one agreeing kind
 *   - both locale dictionaries carry the same key set
 *   - every row is anchored where the ordering rules require
 *   - provider usage never contradicts itself (total = sum of the buckets)
 *   - a bucket the provider omitted stays null instead of becoming a zero
 *
 * Usage:  npm run verify
 *         DSH_HOME=/path/to/dsh_home npm run verify
 *
 * Defaults to $DSH_HOME/sessions, then ~/.dsh/sessions. Exits non-zero when a
 * hard invariant breaks.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');

// ------------------------------------------------------------------ fake host

let registration = null;
globalThis.window = { __ModuleLoader__: { load: (entry) => (registration = entry) } };
globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } };

const ReactStub = {
  createElement: () => null,
  useState: (value) => [value, () => {}],
  useId: () => 'id',
  memo: (component) => component,
};

await import(join(repo, 'lib', 'client.js'));
if (registration === null) throw new Error('lib/client.js registered no module');

const mod = registration.factory((name) => {
  if (name === 'react') return ReactStub;
  throw new Error(`unexpected require(${JSON.stringify(name)})`);
});

const problems = [];
const registered = [];
const noop = () => {};
let definition = null;

mod.apply({
  effect: (fn) => {
    const disposer = fn();
    return typeof disposer === 'function' ? disposer : noop;
  },
  locale: {
    register: (ns, dicts) => {
      registered.push(`locale ${ns}`);
      const dictionaries = Object.values(dicts);
      const first = dictionaries[0] ?? {};
      for (const dictionary of dictionaries.slice(1)) {
        const onlyFirst = Object.keys(first).filter((key) => !(key in dictionary));
        const onlyOther = Object.keys(dictionary).filter((key) => !(key in first));
        if (onlyFirst.length > 0 || onlyOther.length > 0) {
          problems.push(`locale dictionaries disagree for "${ns}": only-one-side=${[...onlyFirst, ...onlyOther]}`);
        }
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
      if (options.name !== 'conversation.chat.node') problems.push(`unexpected slot "${options.name}"`);
      if (options.key !== definition.kind) {
        problems.push(`renderer key "${options.key}" does not match definition kind "${definition.kind}"`);
      }
      if (options.locale === undefined) problems.push('renderer declares no locale namespace');
      if (typeof component !== 'function') problems.push('renderer is not a component function');
      registered.push(`slot ${options.name} key=${options.key}`);
      return noop;
    },
  },
});

if (definition === null) throw new Error('no Conversation Definition was registered');

console.log(`module id     : ${registration.id}`);
console.log(`definition    : kind=${definition.kind} target=${definition.target}`);
console.log(`registrations : ${registered.join(' | ')}`);
if (typeof definition.buildViewNode !== 'function') problems.push('definition exposes no buildViewNode');

// -------------------------------------------------------------- session sweep

const sessionsRoot = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'sessions')
  : join(homedir(), '.dsh', 'sessions');

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
    text = execFileSync('zstd', ['-dc', '--', target], {
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
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
  console.log(`\nNo session logs under ${sessionsRoot} — registration checks only.`);
} else {
  for (const dir of sessionDirs) {
    const events = readEvents(dir);
    if (events === null) continue;
    stats.files += 1;

    // Group exactly as the Definition's match() would.
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

      if (node.key !== context.key) problems.push(`unstable node key "${node.key}" for "${context.key}"`);
      if (node.target !== definition.target) problems.push(`node target "${node.target}" is not "${definition.target}"`);

      // An omitted bucket must stay null rather than be reported as a zero.
      for (const key of ['input', 'cacheRead', 'cacheWrite', 'output']) {
        const omitted = data.missingCoreBuckets.includes(key) || data.missingOptionalBuckets.includes(key);
        if (omitted && data.requestCount > 0 && data.hasUsage === false && data.buckets[key] !== null) {
          problems.push(`step ${id} reported bucket "${key}" although no usage sample existed`);
        }
      }

      const settled = matches
        .filter((match) => match.event.type === 'assistant/message' && match.event.surfaceOp === 'append')
        .at(-1);

      if (settled === undefined) {
        stats.noSettledMessage += 1;
      } else if (node.anchorSeq !== settled.event.seq) {
        // Any other anchor is either folded into the Turn's collapsed process
        // group or read as later transcript by the shipped Turn tail, which
        // disables its branch action. Both are regressions.
        stats.anchorBad += 1;
      }

      const usage = settled?.event?.data?.usage;
      if (usage && data.buckets.total !== null) {
        const sum =
          (usage.inputTokens ?? 0) +
          (usage.cacheReadTokens ?? 0) +
          (usage.cacheWriteTokens ?? 0) +
          (usage.outputTokens ?? 0);
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

console.log(problems.length === 0 ? '\nOK — no invariant broken.' : `\nFAILED:\n  - ${problems.join('\n  - ')}`);
process.exit(problems.length === 0 ? 0 : 1);
