# dsh-step-token-usage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![DSH](https://img.shields.io/badge/DSH-0.1.7--rc.2-4c6ef5)](#compatibility)

An always-visible token pill on **every** assistant reply in the DeepSeek Harness (DSH) Web GUI, expanding into that step's exact per-request ledger — retries included — **priced in RMB or USD at the peak or off-peak rate in force when each request was sent**. **No shipped package is patched.**

> 中文说明见 [README.md](README.md)。

---

## The problem

With **Settings → Performance & usage** set to *detailed*, DSH shows exactly one usage pill, at the **end of each turn**, and it stays hover-revealed. The dozens of intermediate tool-calling requests inside a turn are invisible.

That is where the cost actually lives. In one measured session:

| Turn | Requests | Uncached input | Cache read | Output | Total |
|---|---|---|---|---|---|
| 1 | 38 | 59,254 | 1,815,936 | 6,995 | **1,882,185** |
| 2 | 14 | 13,817 | 980,864 | 2,947 | **997,628** |

38 requests and ~1.9M tokens in a single turn — real, because every tool call resends the context. The turn-end pill alone never tells you that. This plugin pushes the accounting down to **each assistant step**.

## Features

- 📌 **Always visible** — one pill per assistant reply, no hovering
- 🧮 **Per reply** — uncached input, cache read, output for that request
- 💰 **Per-step cost** — the amount for that step, with each request carrying its own amount and tier
- 🧾 **Per-turn cost** — its own line at the end of each completed turn, with the pricing tier
- 🔍 **Click to expand** — provider/model, cache-hit ratio, and each token bucket's own amount
- 🔁 **Retries shown** — each `llm/retry` gets its own row with its failure code and message
- 🚫 **Missing data is marked, never zeroed** — omitted provider fields read *not reported*, and a cost that cannot be priced reads *unknown* rather than being estimated
- ⚙️ **Terse by default, detail on demand** — the calculation rule, the price source and the currency switch all start hidden and can be turned on in Settings → General
- 🌐 **Chinese + English**, following the DSH locale
- 🧩 **Non-conflicting** — the session-level pills and the shipped turn summary stay exactly as they were

## Settings

Three switches live in Settings → General, all off by default:

| Switch | What turning it on reveals |
|---|---|
| **Show the calculation rule** | The pricing formula and the peak-window basis, inside the cost detail |
| **Show the unit-price source** | Which rate card the unit prices came from (zh page / en page / LiteLLM / local override) |
| **Show the currency switch** | The ¥ / $ control inside the cost detail; when off, the book default (RMB) is always used |

**Terse by default is deliberate.** The formula and the peak-window basis together run to ten lines — noise once you have read them once — and the price source only matters when auditing a figure. Neither should be deleted, so they moved into Settings rather than being cut. The choices are kept in browser `localStorage` and survive refreshes and restarts.

The rows register into the shipped `settings.general.item` slot, documented as the additive seat for "a single setting that needs no page of its own": the section only stacks rows, and a row owns its label, its current value and its write path. That is why this plugin needs no config schema — declaring one would pull in `@deepseek-ai/schemastery`, which does not resolve for a package installed by symlink.

## Where the money comes from

No unit price is compiled into this plugin. The Host half fetches the sources below, normalises them into one small price book, caches it on disk and serves it to the UI; the UI then classifies each request by **its own timestamp** and prices it at that tier.

| Source | What it supplies |
|---|---|
| [DeepSeek official rate card (zh)](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) | CNY peak and off-peak prices |
| [DeepSeek official rate card (en)](https://api-docs.deepseek.com/quick_start/pricing) | USD peak and off-peak prices |
| [LiteLLM price dataset](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json) | **machine-readable peak/off-peak windows**; USD price backup |
| [holiday-cn](https://github.com/NateScarlet/holiday-cn) | the State Council holiday schedule, for "peak hours exclude Chinese public holidays" |

As of 2026-10 the published rule is: **peak = 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday** (09:00–12:00 and 14:00–18:00 Beijing, excluding Chinese public holidays); **off-peak is exactly half**, and every other hour — plus all weekend — is off-peak.

The windows are confirmed by **two independent sources**: LiteLLM encodes them structurally in `off_peak_pricing.windows`, and the rate card states them in a footnote. The plugin reads both, takes them only when they agree, prefers the official page when they disagree (recording `price-window-disagreement` in the book), and falls back to a built-in copy of the published rule only when neither is available (recording that too). Each source's success is recorded, and the dialog names where the unit price came from.

```
amount = uncached input x miss price + cache read x hit price + output x output price
```

- **Priced per request, never blended per step.** A step that straddles a peak boundary, or that fell back to another model, bills each request at its own tier and model — the step total never multiplies a rate it never paid.
- **Auditable per bucket.** Every token bucket carries its own amount (`2,264 tok · ¥0.002264`), so the total can be added up from the rows. The rate that produced that amount is the arithmetic, not the answer, so it is deliberately not printed. The amount appears only when the row can be attributed to one rate card and one tier; a step spanning tiers or models pushes it down into the per-request sections, where the attribution is unambiguous.
- **The turn total is the sum of its steps**, and each step is still priced per request, so neither boundary crossings nor model fallbacks get flattened.
- **Cache writes** are charged at the miss price (DeepSeek publishes no separate write premium). Across 10,034 usage samples on this machine `cacheWriteTokens` was **always 0**, so in practice the term never contributes.
- An amount keeps its places (`¥0.005539`, `$0.0008308`, `¥123.46`, or `<0.00000001` below the supported precision rather than a false zero), so a sub-cent figure never reads as zero.
- A total that is only a **lower bound** (some request could not be priced) is prefixed `≥` and the footnote names how many requests went unpriced.

### When a price cannot be obtained

The book is cached on disk with its fetch time (12 h TTL by default), so:

- **Fetch fails but a cached book exists** → amounts still render, marked as a cached copy with its refresh time.
- **No price was ever obtained** → the UI reads *unknown* and explains why, and shows **no number at all**.
- **The model is not in the book** → *unknown*; another model's rate card is never substituted.

## Configuration (optional)

The plugin declares no config schema — that would pull in `@deepseek-ai/schemastery`, which does not resolve for a package installed by symlink. To override anything, write a JSON file:

```bash
$DSH_HOME/dsh-step-token-usage.json     # or point DSH_STEP_TOKEN_USAGE_CONFIG at one
```

```json
{
  "ttlHours": 6,
  "sources": { "litellm": "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json" },
  "extraHolidays": ["2026-02-16"],
  "priceOverrides": {
    "deepseek-flash": { "CNY": { "peak": { "inputMiss": 2, "inputHit": 0.04, "output": 8 } } }
  }
}
```

`priceOverrides` win over anything fetched, and their source reads *local override*. The same keys may be written under the plugin row's `config:` in the profile.

## Screenshots

Both from real sessions (DSH 0.1.7-rc.2, dark theme), showing the **two granularities side by side**. This plugin does **not** replace the shipped view — they coexist.

**Shipped view (turn level)**: one pill at the end of a turn, whose dialog covers the **whole turn** — 273,628 tok here. Which of the hundred-odd requests inside it cost what is not visible.

![Official turn-level usage](./docs/official-turn-usage.jpg)

**Added by this plugin (step level)**: every assistant reply carries an always-visible pill, expanding into that step's per-request ledger. Below, turn 2 step 2 totals 82,810 tok = uncached input 2,264 + cache read 80,128 + cache write 0 + output 418. The very next step in the same turn (84.5K) gets its own row.

![Per-step pills and per-request ledger](./docs/step-usage-detail.jpg)

> In the expanded panel `2,264 + 80,128 + 0 + 418 = 82,810` — the invariant `scripts/verify.mjs` asserts, visible on screen.

## Install

```bash
# from GitHub
dsh plugin --profile web add github:hana647929196/dsh-step-token-usage

# pinned to a release tag (recommended)
dsh plugin --profile web add github:hana647929196/dsh-step-token-usage#v1.5.0
```

Then **refresh the page** for the pills and the settings rows. Amounts need the Host half's pricing route, so **installing or upgrading requires one plugin remount** — see the note below.

> The plugin is **plain JavaScript with no build step**. The Client half is served to the browser under a content-hash `rev=`, so editing it takes effect on a page refresh — `pnpm run dev:web` is not needed.
>
> The **Host half does not reload on its own**. DSH's HMR watches profile configuration only (`hmr.root: []`), not plugin sources. Any plugin remount picks the new module up — change any `cordis.patch.yml`, toggle the plugin off and on in the GUI's plugin market, or restart `dsh web`. On remount `dsh-hmr` calls `ctx.loader.import(...)` and re-imports the module (which is the point of that package), so the new code really does load; measured on this machine, touching a patch file after a Host-half edit took the route from 404 to serving normally, with no process restart.
>
> Editing only the Client half needs no remount at all — just refresh.

From source:

```bash
npm pack
dsh plugin --profile web add dsh-step-token-usage-1.5.0.tgz
```

Manual install (no pnpm): copy the package to `~/.dsh/profiles/web/node_modules/dsh-step-token-usage`, append `"dsh-step-token-usage"` to `dsh.profile.bundles` in the profile `package.json`, and add this to the profile `cordis.patch.yml`:

```yaml
- insert:
    - id: step-token-usage
      name: 'dsh-step-token-usage'
```

## Usage

No configuration. Each assistant reply gains a strip above it:

```
🗄 Usage 27.4K  ▾   · uncached 26.1K · cache read 1.2K · output 174 · ¥0.005539
```

Clicking it expands that step's ledger:

```
Per-request detail                              Turn 3 · Step 59
───────────────────────────────────────────────────────────────
Turn / step                                     Turn 3 · Step 59
Cache hit                                             97.3%
Uncached input                                        2,264
Cache read                                           80,128
Cache write                                               0
Output                                                  418
Total                                            82,810 tok
Cost                                          ¥0.005539
Pricing tier                                      Off-peak
```

The amount sits directly under the token rows, with no divider between them — it belongs to those rows.

Every bucket's amount is always shown; the **unit-price source**, the **currency switch** and the two **calculation-rule** footnotes are hidden by default. With them turned on in Settings → General it reads:

```
Uncached input                2,264 tok · ¥0.002264
Cache read                 80,128 tok · ¥0.001603
Cache write                    0 tok · ¥0.00
Output                      418 tok · ¥0.001672
Total                                            82,810 tok
Cost                                          ¥0.005539
Pricing tier                                      Off-peak
Unit price from                DeepSeek official rate card (zh)
Currency                                       ¥ CNY | $ USD
  Amount = uncached input x miss price + cache read x hit price
         + output x output price, each request priced at the tier
         in force when it was sent.
  Peak windows from: LiteLLM and the official rate card (agreeing);
  adjusted for the Chinese public holiday calendar.
```

The bucket amounts are always there, and the three of them sum to the total: `0.002264 + 0.001603 + 0.001672 = 0.005539`.

When a step bills more than one request, each request gets its own section carrying its own amount and tier:

```
Per-request detail                              Turn 3 · Step 59
───────────────────────────────────────────────────────────────
…step totals above, elided…
───────────────────────────────────────────────────────────────
Request 1   deepseek-official / deepseek-flash
  Uncached input                1,354 tok · ¥0.002708
  Cache read                167,808 tok · ¥0.006712
  Output                          330 tok · ¥0.002640
  Total                                           169,492
  Cost                                         ¥0.012060
  Pricing tier                                    Peak
───────────────────────────────────────────────────────────────
Retry 1/5   deepseek-official   TRANSPORT
  DeepSeek Messages transport failed
  Usage was not reported for this request
```

**Each completed turn** gains its own money line (a turn spanning both tiers reads *Peak + off-peak*):

```
Turn cost   ¥0.187342   Peak + off-peak
```

It sits immediately **before** the shipped turn footer, because it anchors on the turn's last settled assistant message and never past it — anchoring past it would make the shipped footer grey out its branch action.

Intermediate (tool-calling) steps fold into the turn's **work process** group together with their text, matching the shipped folding behaviour — expand that group to see each step's pill. The final answer step's pill is always directly visible.

## Data provenance

Everything comes from the `data.usage` the provider already reported on each durable `assistant/message` event. Nothing is estimated or extrapolated.

- One step is normally one billed request: across 7936 measured steps, no step ever carried more than one `assistant/message`.
- The total prefers the provider's own `totalTokens`; it is summed from the buckets only when that field is absent, and the UI then says so.
- `total = uncached input + cache read + cache write + output` held in **every** stored sample (10,034 usage samples, 0 violations).
- *Uncached input* is `inputTokens` and excludes the cached part — confirmed by that identity: if `inputTokens` were already the full prompt, the sum could not hold.
- **Amounts are never estimated.** They are the reported token counts times a unit price that was actually obtained. If any part is unavailable the UI reads *unknown*; it never substitutes zero, another model, or another tier.

## Three design decisions worth knowing

**The pill sits above the reply text, and `anchorSeq` cannot be nudged.** It must equal the settled `assistant/message` sequence exactly. Slightly smaller and the engine folds the node into the turn's collapsed work-process group — hiding the pill on the final answer, which defeats the whole point. Slightly larger and the shipped turn tail treats it as later transcript (`hasLaterChatNode`) and **disables its branch/fork action**. Equality threads both; ordering then falls to the engine's context-key comparison, which places the pill before the assistant row.

**Missing data is marked, not zeroed.** Only absent `input`/`output` raise a warning; absent `cacheRead`/`cacheWrite` get a neutral note; absent `reasoningTokens` is ignored entirely — providers essentially never break it out, so counting it as missing would warn on every single row and drown the real signal.

**Prices are fetched, never compiled in.** A hardcoded rate card has one inevitable outcome: the day a price changes, the plugin keeps reporting wrong numbers with full confidence. So prices are fetched at run time. That introduces a network dependency and several failure modes, handled as follows:

- **Independent sources.** One rate card going down costs only its currency; the windows and holidays still arrive. Each source's outcome is recorded in the book.
- **Two-source window agreement.** LiteLLM is structural, the rate card is prose; they are taken only when they agree. This is the one parameter where being wrong is exactly a factor of two.
- **Disk cache as fallback,** explicitly labelled as a cached copy with its refresh time rather than passed off as current.
- **Total failure refuses to serve.** Not zero, not an estimate: the route answers 503 and the UI reads *unknown*. **No number is better than a wrong number.**
- **No dependencies.** Installed by symlink, this package's real path sits outside the profile's `node_modules`, so no bare specifier would resolve; the Host half therefore uses Node builtins only. Configuration is a JSON file rather than a schema for the same reason.

## Compatibility

- Measured on **DSH 0.1.7-rc.2**.
- Uses **documented public extension points only**, and no private implementation: a turn-scoped Chat Definition for the per-turn money line, and:
  - `ctx.uiConversation.events.register()` for the node Definition;
  - the keyed `conversation.chat.node` slot for its renderer (whose contract states *"a kind with no occupant renders no row"* — adding a kind cannot collide with the shipped UI);
  - the `settings.general.item` list slot for the settings rows, documented as the seat for "a single setting that needs no page of its own".
- Amounts add one Host route (`ctx.inject(['webServer'])` + `webServer.register({ kind: 'exact', path, handler })`, the same shape shipped and third-party plugins use). In a profile without a web server the plugin still mounts and simply reports prices as unknown.
- Imports **no DSH client package**; only `react` from the browser module table, so shipped-package upgrades cannot break it via import paths. `dsh.client.inject` has always been empty.
- The **Host half imports no third-party package**, only Node builtins — required, because a symlinked install cannot resolve the profile's `node_modules`.
- Styles use only `--dsw-alias-*` / `--dsh-*` theme tokens, all with fallbacks, and adapt to light and dark. The settings rows copy the shipped `EnterBehaviorRow` metrics, so a contributed row is indistinguishable from a built-in one.
- **Network**: the Host half contacts the four sources above every 12 hours (configurable). A fetch failure affects amounts only, never token counts.
- **Upgrade notes**:
  - If a future DSH changes the work-process folding or the turn-tail branch rules, re-check the pill's placement. `scripts/verify.mjs` asserts the `anchorSeq` rule, so one run surfaces it.
  - If a future DSH withdraws the General settings slot, those three rows are not registered (the detail cannot be opened; the amounts still render). The per-step and per-turn amounts are ordinary chat nodes and are unaffected. `npm run verify` asserts the shape of every registration.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No pills at all | Check the plugin mounted: `step-usage` should appear among the occupants of `conversation.chat.node`. Refresh, then restart `dsh web`. |
| Only the newest turn has pills | Earlier turns are not in the loaded window yet — scroll up to page them in. |
| A reply says *usage not reported* | That step genuinely has no provider usage (interrupted or failed request). Reported as-is. |
| No amount on a turn total | That turn's steps are not in the loaded window yet (scroll up), or the pricing route is unavailable. The per-step pills are unaffected. |
| The three switches are not in Settings | They live at the end of the **General** section (orders 30–32), not on the Plugins page. |
| The dialog says the price data could not be read | The pricing route is not registered — usually an install/upgrade without a plugin remount. `curl -s localhost:28000/api/dsh-step-token-usage/pricing \| head -c 200` should return JSON; a 404 means remount the plugin or restart `dsh web`. |
| The dialog says *unknown* but the route is fine | That model is not in the book, or the request is missing a required usage bucket. The dialog names the model. |
| Amounts look high | Check the *Pricing tier* row first: peak is **twice** off-peak. Then check the holiday classification. |
| A holiday is still billed at peak | That year's schedule may not be published yet (holiday-cn usually adds it in Nov–Dec of the prior year); add it via `extraHolidays`. |
| No network access wanted | Point `sources` at your own mirror, or supply `priceOverrides`; the disk cache also keeps serving while offline. |
| After installing, the shipped turn-tail buttons need hovering | Known cosmetic side effect; it settles after a page refresh. **The branch/fork action is unaffected.** |

## How it works

**Host half (`lib/index.js`)** fetches the unit prices and the peak/off-peak windows, normalises them into one small price book, caches it in memory and on disk, and serves it over `GET /api/dsh-step-token-usage/pricing`. It uses Node builtins only (`fetch`, `node:fs`) and has no dependencies. Fetching happens in the background and never blocks UI load; the book carries a TTL and refreshes behind the scenes; a total failure answers 503 rather than a fabricated zero.

**Client half (`lib/client.js`)** registers a lazy factory via `window.__ModuleLoader__.load` (React from the browser module table; no JSX, no build). Its `apply`:

1. registers the zh/en dictionaries on `ctx.locale`;
2. registers a Definition of kind `step-usage` via `ctx.uiConversation.events.register()`, matching `step/start`, `assistant/message` (append) and `llm/retry`, keyed by `${turn}:${step}`;
3. registers the renderer cell under the same string in the keyed `conversation.chat.node` slot;
4. registers three rows into `settings.general.item`.

The Definition's state holds only `turn`/`step` identity; the whole ledger is folded from `context.matches` at materialization time, so it stays correct even when the loaded window begins mid-step with no `step/start`.

**The per-turn amount** is a **turn-scoped Definition** (kind `turn-cost`), not a slot contribution. It matches the whole turn, so `context.matches` already holds every piece of that turn's evidence — the same evidence the shipped footer uses. It folds and renders the row itself, depending neither on whether step rows happen to have been materialized nor on any cross-component notification. `publication` is `immediate` only at `turn/end`, so a running turn never shows a half-formed figure. Its anchor is the turn's last settled `assistant/message`: the shipped footer treats any row anchored past that as later transcript and greys out its branch action, so that line cannot be crossed.

On load the Client also fetches the price book once for the whole page and subscribes to it. **Tier classification and pricing live in the Client half**, because only the Client holds both a request's `time` and its own `route` — which is what "the rate in force when it was sent" needs. Pricing is a pure function on the same chain (`priceStep` per step, `priceTurn` per turn); none of them depend on React.

`lib/client.js` ends with a `__internals` object exposing that pure chain to `npm run verify`: tier boundaries and holidays are inputs that occur a handful of times a year and cannot be asserted through a browser. The UI never reads it.

## Development & verification

```bash
npm run verify
# equivalent when npm is unavailable:
node scripts/verify.mjs
DSH_HOME=/path/to/dsh_home node scripts/verify.mjs
```

The script mounts the Client half against a fake module loader and Cordis context, then drives the Definition over every session log on the machine, asserting the properties that are hard to eyeball: the slot registration shapes (a `key` for `conversation.chat.node`, an `id` for `settings.general.item`), matching locale key sets, the exact `anchorSeq`, self-consistent usage samples, and omitted buckets staying `null` rather than becoming `0`. It additionally asserts:

- **Amounts**: both window edges (start inclusive, end exclusive), weekends and public holidays off-peak all day, peak exactly twice off-peak, per-request addition across a boundary, alias resolution, *unknown* instead of a number when a bucket is missing, lower-bound semantics when only part of a step can be priced, and amount rendering precision.
- **Per-bucket amounts**: all three buckets print their own amount, and those amounts sum to the step total.
- **The turn ledger**: keyed `turn:step` (a re-materialized step is not double-counted; a retry-only step is not recorded at all), the turn total equals the sum of its steps, turns do not leak into one another, a tier-spanning turn reads *peak + off-peak*, a wholly unpriced turn says so, and a turn with no ledger row or no book stays silent.
- **Rendering**: the amount appears on both the pill and the dialog, an unpriced model produces no currency-symbol-bearing digits at all, a missing book explains itself, and all twelve states render.
- **Settings**: every preference has a row with copy in both locales, ids and orders are unique, each switch starts off, clicking it writes through to the dialog, and clearing it returns to the default.
- **Host parsers** against offline fixtures reproducing the real page structure: both rate cards, both footnotes parsing to the *same* window (one in UTC, one in Beijing time), LiteLLM's `off_peak_pricing.windows` inverting to the same peak set, holidays taken only from `isOffDay`, third-party provider entries never leaking into the official rate card, a source disagreement not being resolved silently, and the built-in window fallback both applying and being declared.

Author's machine (82 sessions, 10,034 usage samples) — a snapshot; the counts keep growing with use:

```
steps 7936 | materialized 7930 | withUsage 7926 | withoutUsage 4
requests 7928 | retries 11
missingCore 0 | missingOptional 11
invariantOk 7926 | invariantBad 0 | anchorBad 0
OK — no assertion failed.
```

A mount-level check was also run against a real HTTP server: route registration shape, a 200 book fetch, a cache hit, 405 for non-GET, serving the cached book marked `stale` while offline, and 503 when there is no book and no network. The live route was then exercised in place — `GET` 200, `POST` 405, and `?refresh=1` re-fetching and rewriting the on-disk book.

## License

[MIT](./LICENSE)
