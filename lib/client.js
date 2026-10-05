/**
 * Per-step token usage — an always-visible pill on every Assistant step that
 * expands in place into that step's exact per-request ledger.
 *
 * Why a new Conversation Node kind (rather than touching the shipped UI):
 * `conversation.chat.node` is a keyed Slot, so a kind with no occupant renders
 * no row. Registering `step-usage` adds a row without replacing, patching, or
 * shadowing anything the shipped `@deepseek-ai/dsh-client-ui-chat` bundle owns.
 *
 * The two halves below must agree on one string, `KIND`:
 *   1. the event Definition registered on `ctx.uiConversation.events`
 *   2. the renderer cell registered in the keyed `conversation.chat.node` Slot
 */
window.__ModuleLoader__.load({
  id: 'dsh-step-token-usage',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'step-token-usage';
    /** Chat Node kind; also the renderer key and the Location-data key. */
    const KIND = 'step-usage';
    /** Chat Node kind of the per-turn money row. */
    const TURN_KIND = 'turn-cost';
    /** The shipped Chat view target this Definition materializes into. */
    const TARGET = 'chat';

    // #region locale

    const zh = {
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'number.groupSeparator': ',',
      'pill.usage': '用量 {total}',
      'pill.count': '{count} tok',
      'pill.input': '未缓存 {count}',
      'pill.cacheRead': '缓存读 {count}',
      'pill.output': '输出 {count}',
      'pill.noUsage': '用量未上报',
      'pill.priceUnknown': '价格未知',
      'preference.showBasis.title': '显示计算规则',
      'preference.showBasis.description': '在费用明细里展开计价公式与高峰时段的判定依据。',
      'preference.showSource.title': '显示单价来源',
      'preference.showSource.description': '在费用明细里标出所用单价来自哪个价目表。',
      'preference.showCurrency.title': '显示币种切换',
      'preference.showCurrency.description': '在费用明细里提供人民币 / 美元切换；关闭时固定使用价格册的默认币种（人民币）。',

      'pill.retried': '重试 {count} 次',
      'pill.expand': '展开逐次请求明细',
      'pill.collapse': '收起逐次请求明细',
      'panel.title': '逐次模型请求',
      'panel.step': '第 {turn} 轮 · 第 {step} 步',
      'panel.request': '请求 {index}',
      'panel.retry': '重试 {attempt}/{max}',
      'panel.retryNoMax': '重试 {attempt}',
      'panel.noUsageForRequest': '该次请求未上报用量',
      'panel.requestCount': '{count} 次请求',
      'field.model': '提供方 / 模型',
      'field.step': '轮次 / 步',
      'field.failure': '失败原因',
      'field.usage': '用量',
      'field.cacheHit': '缓存命中',
      'field.input': '未缓存输入',
      'field.cacheRead': '缓存读取',
      'field.cacheWrite': '缓存写入',
      'field.output': '输出',
      'field.reasoning': '（其中推理 {tokens}）',
      'field.total': '合计',
      'value.missing': '未上报',
      'note.partial': '部分字段未上报：{fields}。缺失项按未知处理，不计入合计。',
      'note.partialOptional': '提供方未上报：{fields}。',
      'note.derivedTotal': '合计为各分项加和。',
      'note.interrupted': '该步未正常结束，用量可能不完整。',
      'note.noUsage': '本步没有任何一次请求上报用量，因此无法给出 token 数。',
      'cost.section': '费用',
      'cost.turnTotal': '本轮费用',
      'cost.sessionTotal': '会话已加载部分费用',
      'cost.overTurns': '{count} 轮',
      'preference.showRowPrices.title': '显示逐桶单价',
      'preference.showRowPrices.description': '在费用明细里给每一个 token 桶标出单价与该桶小计。',
      'cost.unknown': '未知',
      'field.cost': '费用',
      'field.tier': '计价时段',
      'field.priceSource': '单价来源',
      'field.currency': '币种',
      'tier.peak': '高峰时段',
      'tier.offPeak': '空闲时段',
      'tier.mixed': '高峰 + 空闲',
      'source.deepseek-docs-zh': 'DeepSeek 官方价目表（中文）',
      'source.deepseek-docs-en': 'DeepSeek 官方价目表（英文）',
      'source.litellm': 'LiteLLM 价格数据集',
      'source.override': '本地覆盖配置',
      'note.costPartial': '有 {count} 次请求无法定价，上面的合计只是已定价部分之和。',
      'note.costUnknownModel': '价格来源里没有 {model} 的单价，因此不估算金额。',
      'note.costNoBook': '未能读取价格数据，因此不显示金额。请确认插件主机端已加载且能访问价格来源。',
      'note.costStale': '价格为缓存副本（最近一次刷新：{time}），本次未能联网更新。',
      'note.costWindowSource': '高峰时段判定依据：{source}；已按中国法定节假日日历修正。',
      'note.costBasis': '金额 = 未缓存输入 × 未命中单价 + 缓存读取 × 命中单价 + 输出 × 输出单价，按每次请求发生时刻的峰谷价格分别计算。',
      'sourceName.deepseek-docs-zh': 'DeepSeek 官方中文价目表',
      'sourceName.deepseek-docs-en': 'DeepSeek 官方英文价目表',
      'sourceName.litellm': 'LiteLLM 价格数据集',
      'sourceName.litellm+docs': 'LiteLLM 与官方价目表（一致）',
      'sourceName.docs': 'DeepSeek 官方价目表附注',
      'sourceName.builtin': '内置回退规则',
    };

    const en = {
      'number.thousand': '{value}K',
      'number.million': '{value}M',
      'number.groupSeparator': ',',
      'pill.usage': 'Usage {total}',
      'pill.count': '{count} tok',
      'pill.input': 'uncached {count}',
      'pill.cacheRead': 'cache read {count}',
      'pill.output': 'output {count}',
      'pill.noUsage': 'usage not reported',
      'pill.priceUnknown': 'price unknown',
      'preference.showBasis.title': 'Show the calculation rule',
      'preference.showBasis.description': 'Expand the pricing formula and the peak-window basis inside the cost detail.',
      'preference.showSource.title': 'Show the unit-price source',
      'preference.showSource.description': 'Name which rate card the unit prices came from inside the cost detail.',
      'preference.showCurrency.title': 'Show the currency switch',
      'preference.showCurrency.description': 'Offer the RMB / USD switch inside the cost detail; when off, the book default (RMB) is always used.',

      'pill.retried': '{count} retries',
      'pill.expand': 'Show per-request detail',
      'pill.collapse': 'Hide per-request detail',
      'panel.title': 'Per-request detail',
      'panel.step': 'Turn {turn} · Step {step}',
      'panel.request': 'Request {index}',
      'panel.retry': 'Retry {attempt}/{max}',
      'panel.retryNoMax': 'Retry {attempt}',
      'panel.noUsageForRequest': 'Usage was not reported for this request',
      'panel.requestCount': '{count} request(s)',
      'field.model': 'Provider / model',
      'field.step': 'Turn / step',
      'field.failure': 'Failure',
      'field.usage': 'Usage',
      'field.cacheHit': 'Cache hit',
      'field.input': 'Uncached input',
      'field.cacheRead': 'Cache read',
      'field.cacheWrite': 'Cache write',
      'field.output': 'Output',
      'field.reasoning': '({tokens} reasoning)',
      'field.total': 'Total',
      'value.missing': 'not reported',
      'note.partial': 'Some fields were not reported: {fields}. Missing fields are treated as unknown and are excluded from totals.',
      'note.partialOptional': 'Not reported by the provider: {fields}.',
      'note.derivedTotal': 'Total summed from the reported buckets.',
      'note.interrupted': 'This step did not finish normally, so its usage may be incomplete.',
      'note.noUsage': 'No request in this step reported usage, so no token count is available.',
      'cost.section': 'Cost',
      'cost.turnTotal': 'Turn cost',
      'cost.sessionTotal': 'Cost over loaded turns',
      'cost.overTurns': '{count} turn(s)',
      'preference.showRowPrices.title': 'Show per-bucket unit prices',
      'preference.showRowPrices.description': 'Annotate every token bucket in the cost detail with its unit price and contribution.',
      'cost.unknown': 'unknown',
      'field.cost': 'Cost',
      'field.tier': 'Pricing tier',
      'field.priceSource': 'Unit price from',
      'field.currency': 'Currency',
      'tier.peak': 'Peak',
      'tier.offPeak': 'Off-peak',
      'tier.mixed': 'Peak + off-peak',
      'source.deepseek-docs-zh': 'DeepSeek official rate card (Chinese)',
      'source.deepseek-docs-en': 'DeepSeek official rate card (English)',
      'source.litellm': 'LiteLLM price dataset',
      'source.override': 'Local override',
      'note.costPartial': '{count} request(s) could not be priced; the total above sums only the priced ones.',
      'note.costUnknownModel': 'No unit price is published for {model} in the price sources, so no amount is estimated.',
      'note.costNoBook': 'Price data could not be read, so no amount is shown. Check that the plugin host half is loaded and can reach the price sources.',
      'note.costStale': 'These are cached prices (last refreshed {time}); this run could not reach the network.',
      'note.costWindowSource': 'Peak windows from: {source}; adjusted for the Chinese public holiday calendar.',
      'note.costBasis': 'Amount = uncached input x miss price + cache read x hit price + output x output price, each request priced at the tier in force when it was sent.',
      'sourceName.deepseek-docs-zh': 'DeepSeek official rate card (zh)',
      'sourceName.deepseek-docs-en': 'DeepSeek official rate card (en)',
      'sourceName.litellm': 'LiteLLM price dataset',
      'sourceName.litellm+docs': 'LiteLLM and the official rate card (agreeing)',
      'sourceName.docs': 'DeepSeek official rate card footnote',
      'sourceName.builtin': 'built-in fallback rule',
    };

    // #endregion

    // #region formatting

    /**
     * Read one non-negative integer count.
     * @param value - raw provider field.
     * @returns the floored count, or null when the provider omitted it.
     */
    function count(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
    }

    /**
     * Compact token count, mirroring the shipped pill (`27419` -> `27.4K`).
     * @param value - token count, or null when unknown.
     * @param t - translate seat.
     * @returns display string.
     */
    function compact(value, t) {
      if (value === null) return t('value.missing');
      const scaled = (candidate) => (candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10));
      if (value < 1e3) return String(value);
      if (value < 1e6) return t('number.thousand', { value: scaled(value / 1e3) });
      return t('number.million', { value: scaled(value / 1e6) });
    }

    /**
     * Exact token count with locale-owned digit grouping.
     * @param value - token count, or null when unknown.
     * @param t - translate seat.
     * @returns display string.
     */
    function exact(value, t) {
      if (value === null) return t('value.missing');
      const digits = String(value);
      const groups = [];
      for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end));
      return groups.join(t('number.groupSeparator'));
    }

    /**
     * Cache-read share of the prompt, to one decimal place.
     * @param cacheRead - cache-read tokens, or null.
     * @param prompt - prompt tokens (total minus output), or null.
     * @returns the percentage text, or null when it cannot be derived.
     */
    function cacheHit(cacheRead, prompt) {
      if (cacheRead === null || prompt === null || prompt <= 0) return null;
      const units = Math.round((cacheRead / prompt) * 1000);
      return units >= 1000 ? '100' : String(units / 10);
    }

    // #endregion

    // #region usage reading

    /** Token buckets carried by one provider usage sample. */
    const BUCKETS = ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'total'];
    /**
     * Buckets whose absence means the accounting itself is incomplete, as
     * opposed to `cacheRead`/`cacheWrite` (optional provider reporting) and
     * `reasoning` (a normal output subset that providers usually omit).
     */
    const CORE_BUCKETS = ['input', 'output'];
    /** Buckets reported only by some providers; absence is informational. */
    const OPTIONAL_BUCKETS = ['cacheRead', 'cacheWrite'];

    /**
     * Read one provider-reported usage sample without inventing values.
     * An absent bucket stays null so the disclosure can say "not reported"
     * instead of reporting a confident zero.
     * @param raw - the event's `data.usage`.
     * @returns normalized buckets, or null when the sample carries nothing usable.
     */
    function readUsage(raw) {
      if (typeof raw !== 'object' || raw === null) return null;
      const usage = {
        input: count(raw.inputTokens),
        cacheRead: count(raw.cacheReadTokens),
        cacheWrite: count(raw.cacheWriteTokens),
        output: count(raw.outputTokens),
        reasoning: count(raw.reasoningTokens),
        total: count(raw.totalTokens),
      };
      if (usage.input === null && usage.output === null && usage.total === null) return null;
      return usage;
    }

    /**
     * Read the route attribution of one settled Assistant message.
     * Both provider and model must be present, matching the shipped rule.
     * @param event - an `assistant/message` event.
     * @returns the route, or null when unattributed.
     */
    function readRoute(event) {
      const source = event && event.data ? event.data.message && event.data.message.source : null;
      if (typeof source !== 'object' || source === null) return null;
      const provider = typeof source.provider === 'string' && source.provider !== '' ? source.provider : null;
      const model = typeof source.model === 'string' && source.model !== '' ? source.model : null;
      return provider !== null && model !== null ? { provider, model } : null;
    }

    /**
     * Read one `llm/retry` failure descriptor.
     * @param event - an `llm/retry` event.
     * @returns the failure code and message, each possibly null.
     */
    function readFailure(event) {
      const data = event && event.data ? event.data : {};
      const failure = data.failure && typeof data.failure === 'object' ? data.failure : {};
      return {
        code: typeof failure.code === 'string' && failure.code !== '' ? failure.code : null,
        message: typeof failure.message === 'string' && failure.message !== '' ? failure.message : null,
      };
    }

    /** @returns whether the value is a durable session event with a sequence. */
    function isSessionEvent(event) {
      return typeof event === 'object' && event !== null && typeof event.seq === 'number';
    }

    // #endregion

    // #region pricing

    /** Host route that serves the price book. Kept in sync with `lib/index.js`. */
    const PRICING_URL = '/api/dsh-step-token-usage/pricing';
    /** Where the operator's currency choice is remembered. */
    const CURRENCY_KEY = 'dsh-step-token-usage/currency';
    /** Currency symbols this plugin can render. */
    const SYMBOLS = { CNY: '\u00a5', USD: '$' };
    /** Chain of clocks: the last 15 minutes ride the peak window edge. */
    const HOUR_MS = 60 * 60 * 1000;

    /**
     * The price book holder.
     *
     * Module-scoped rather than per-component so one fetch serves every row on
     * the transcript, and so the operator's currency choice survives the
     * transcript virtualising rows in and out. `status` is what lets the UI
     * distinguish "still loading" from "loaded, and this model is unpriced" —
     * the difference between a silent gap and an honest "unknown".
     */
    const priceStore = {
      status: 'idle',
      book: null,
      stale: false,
      fetchedAt: null,
      currency: null,
      listeners: new Set(),
      /**
       * @param listener - called on every state change.
       * @returns an unsubscribe function.
       */
      subscribe(listener) {
        priceStore.listeners.add(listener);
        return () => priceStore.listeners.delete(listener);
      },
      /** Wake every subscriber. */
      notify() {
        for (const listener of [...priceStore.listeners]) listener();
      },
      /**
       * Test seam: install a book without touching the network.
       * @param book - a price book.
       * @param meta - optional `{ stale, fetchedAt, status }`.
       */
      seed(book, meta = {}) {
        priceStore.book = book;
        priceStore.status = meta.status ?? 'ready';
        priceStore.stale = meta.stale === true;
        priceStore.fetchedAt = meta.fetchedAt ?? null;
        priceStore.notify();
      },
    };

    /**
     * Fetch the book once per page load.
     *
     * A failure is terminal for the session rather than retried on every row:
     * re-requesting a route that just answered 503 would turn one broken source
     * into a storm, and the Host half already refreshes on its own schedule.
     */
    function loadPriceBook() {
      if (priceStore.status !== 'idle') return;
      if (typeof fetch !== 'function') {
        priceStore.status = 'unavailable';
        priceStore.notify();
        return;
      }
      priceStore.status = 'loading';
      void (async () => {
        try {
          const response = await fetch(PRICING_URL, { headers: { accept: 'application/json' } });
          const payload = response.ok ? await response.json() : null;
          if (payload !== null && payload.ok === true && typeof payload.book === 'object' && payload.book !== null) {
            priceStore.book = payload.book;
            priceStore.stale = payload.stale === true;
            priceStore.fetchedAt = payload.fetchedAt ?? null;
            priceStore.status = 'ready';
          } else {
            priceStore.status = 'unavailable';
          }
        } catch {
          priceStore.status = 'unavailable';
        }
        priceStore.notify();
      })();
    }

    /** Subscribe one component to the book and start the fetch on first mount. */
    function usePriceBook() {
      const [, bump] = React.useState(0);
      React.useEffect(() => {
        loadPriceBook();
        return priceStore.subscribe(() => bump((value) => value + 1));
      }, []);
      return priceStore;
    }

    /** @returns the remembered currency, or null. Storage may be unavailable. */
    function readStoredCurrency() {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage.getItem(CURRENCY_KEY);
      } catch {
        return null;
      }
    }

    /**
     * Resolve the currency to render in.
     * @param book - the price book.
     * @returns a currency the book actually publishes.
     */
    function currencyOf(book) {
      const wanted = priceStore.currency ?? readStoredCurrency();
      if (wanted !== null && book.currencies.includes(wanted)) return wanted;
      return book.defaultCurrency;
    }

    /**
     * Remember the operator's currency choice.
     * @param code - a currency the book publishes.
     */
    function setCurrency(code) {
      priceStore.currency = code;
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(CURRENCY_KEY, code);
      } catch {
        // A blocked storage only costs the preference across reloads.
      }
      priceStore.notify();
    }

    /** @returns minutes past UTC midnight for an `HH:MM` window edge. */
    function minutesOfDay(text) {
      const [hours, minutes] = String(text).split(':');
      return Number(hours) * 60 + Number(minutes);
    }

    /**
     * Classify one instant as peak or off-peak.
     *
     * The two halves of the rule live in different calendars on purpose: the
     * windows are published in UTC against a Monday-to-Friday week, while the
     * holiday exclusion is a Chinese statutory fact and therefore a Beijing
     * calendar date. Every peak window lands between 01:00 and 10:00 UTC, which
     * is 09:00 to 18:00 in Beijing, so the two always name the same date.
     *
     * @param timeMs - the request time, in epoch milliseconds.
     * @param book - the price book.
     * @returns 'peak' | 'offPeak', or null when the time is unusable.
     */
    function tierAt(timeMs, book) {
      if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return null;
      const at = new Date(timeMs);
      const beijingDate = new Date(timeMs + 8 * HOUR_MS).toISOString().slice(0, 10);
      if (book.holidays.includes(beijingDate)) return 'offPeak';

      const weekday = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
      const ranges = book.peakWeekdays[String(weekday)] ?? [];
      const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
      for (const [start, end] of ranges) {
        if (minute >= minutesOfDay(start) && minute < minutesOfDay(end)) return 'peak';
      }
      return 'offPeak';
    }

    /**
     * Price one provider usage sample under one tier's rate card.
     *
     * The provider bills prompt tokens in two buckets — cached reads at the hit
     * price, everything else at the miss price — and DeepSeek publishes no
     * separate cache-write premium, so a reported cache write is charged as
     * ordinary uncached input.
     *
     * A bucket the provider left unreported makes the amount unknown rather
     * than zero: claiming a confident number from a partial sample is the one
     * failure mode this plugin exists to avoid. A missing cache-write count is
     * the exception, being an addend that can only raise the total, so it is
     * reported as a lower bound instead.
     *
     * @param usage - one normalized usage sample.
     * @param prices - one currency's `{ peak, offPeak }` tables, per million tokens.
     * @param tier - 'peak' | 'offPeak'.
     * @returns `{ amount, exact }`, or null when it cannot be priced at all.
     */
    function costOfUsage(usage, prices, tier) {
      const table = prices?.[tier];
      if (usage === null || table === undefined) return null;
      if (usage.input === null || usage.cacheRead === null || usage.output === null) return null;
      const missTokens = usage.input + (usage.cacheWrite ?? 0);
      const perMillion = missTokens * table.inputMiss + usage.cacheRead * table.inputHit + usage.output * table.output;
      return { amount: perMillion / 1e6, exact: usage.cacheWrite !== null };
    }

    /**
     * Find the book entry a billed route is priced by.
     *
     * Matching is by alias rather than by name so a retired id keeps its
     * model's rate card, and a provider-qualified id still resolves.
     *
     * @param book - the price book.
     * @param route - the attempt's `{ provider, model }`, or null.
     * @returns the model entry, or null when nothing matches.
     */
    function lookupModel(book, route) {
      const wanted = route === null ? null : route.model;
      if (typeof wanted !== 'string' || wanted === '') return null;
      const tail = wanted.includes('/') ? wanted.slice(wanted.lastIndexOf('/') + 1) : null;
      const entries = Object.values(book.models);
      for (const model of entries) if (model.aliases.includes(wanted)) return model;
      if (tail !== null) for (const model of entries) if (model.aliases.includes(tail)) return model;
      return null;
    }

    /**
     * Price every billed request in one step, each at its own tier.
     *
     * Pricing per request rather than per step total is what keeps a step that
     * straddles a peak boundary — or that fell back to another model — from
     * being billed at a single blended rate it never actually paid.
     *
     * @param data - the step ledger.
     * @param book - the price book.
     * @param currency - the currency to price in.
     * @returns the step's cost picture, or null when nothing can be priced.
     */
    function priceStep(data, book, currency) {
      if (book === null || data.hasUsage !== true) return null;
      const requests = [];
      let total = 0;
      let priced = 0;
      let unpriced = 0;
      let lowerBound = false;
      const tiers = new Set();
      let lastModel = null;

      for (const attempt of data.attempts) {
        if (attempt.kind !== 'request') continue;
        const model = lookupModel(book, attempt.route);
        const tier = model === null ? null : tierAt(attempt.time, book);
        const cost = model === null || tier === null ? null : costOfUsage(attempt.usage, model.prices[currency], tier);
        if (model !== null) lastModel = model.id;
        if (cost === null) {
          unpriced += 1;
          requests.push({ index: attempt.index, model: model?.id ?? null, tier, amount: null, exact: false });
          continue;
        }
        priced += 1;
        total += cost.amount;
        if (!cost.exact) lowerBound = true;
        tiers.add(tier);
        requests.push({ index: attempt.index, model: model.id, tier, amount: cost.amount, exact: cost.exact });
      }

      return {
        currency,
        requests,
        total: priced === 0 ? null : total,
        priced,
        unpriced,
        lowerBound,
        /** Some billed request is unpriceable, so the total is a lower bound. */
        partial: unpriced > 0,
        tiers,
        model: lastModel,
        source: lastModel === null ? null : (book.models[lastModel]?.prices[currency]?.source ?? null),
      };
    }

    /**
     * Render an amount at a precision that stays informative across the range
     * this plugin actually produces — a single step can cost a fraction of a
     * fen or several yuan.
     *
     * @param value - amount in `currency`.
     * @returns the decimal text.
     */
    function decimalString(value) {
      if (!Number.isFinite(value)) return '\u2014';
      if (value === 0) return '0.00';
      const magnitude = Math.floor(Math.log10(Math.abs(value)));
      const places = Math.min(8, Math.max(2, 3 - magnitude));
      const text = value.toFixed(places);
      // Below the supported precision, say so instead of printing a flat zero.
      return Number(text) === 0 ? `<${(10 ** -places).toFixed(places)}` : text;
    }

    /**
     * @param amount - amount, or null when unknown.
     * @param currency - currency code.
     * @returns the symbol-prefixed amount, or null.
     */
    function moneyText(amount, currency) {
      if (amount === null || amount === undefined) return null;
      return `${SYMBOLS[currency] ?? `${currency} `}${decimalString(amount)}`;
    }

    /**
     * Render a unit price.
     *
     * Distinct from {@link decimalString}, which is tuned for amounts and keeps
     * its places so a sub-cent total never reads as zero. A published rate is
     * the opposite case: it is a short, exact figure, and `¥1.000/1M` reads far
     * worse than `¥1/1M`. So this trims to the shortest exact form.
     *
     * @param value - price per million tokens.
     * @returns the trimmed decimal text.
     */
    function priceString(value) {
      if (!Number.isFinite(value)) return '\u2014';
      if (value === 0) return '0';
      const places = Math.min(8, Math.max(0, 2 - Math.floor(Math.log10(Math.abs(value)))));
      const text = value.toFixed(places);
      // Trailing zeros only, and only after a decimal point: a bare "1000" must
      // keep its zeros.
      return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
    }

    /**
     * Unit price of one bucket, per million tokens, as `¥2/1M`.
     * @param value - price per million tokens, or null when unpublished.
     * @param currency - currency code.
     * @returns the unit-price text, or null.
     */
    function unitPriceText(value, currency) {
      if (value === null || value === undefined) return null;
      return `${SYMBOLS[currency] ?? `${currency} `}${priceString(value)}/1M`;
    }

    // #endregion

    // #region preferences

    /**
     * Display preferences, and who owns them.
     *
     * Three parts of the cost disclosure are noise to most readers — the
     * derivation formula, which source supplied the unit price, and the
     * currency control — so all three start hidden. Nothing is removed: the
     * Settings surface turns each back on, and the choices persist.
     *
     * `values` is the single source of truth the renderers read. Whichever
     * backing store exists (the Settings service, else `localStorage`) only
     * feeds it and receives writes.
     */
    const PREFERENCE_DEFAULTS = Object.freeze({ showRowPrices: false, showBasis: false, showSource: false, showCurrency: false });
    /** The preference keys, in the order the Settings surface lists them. */
    const PREFERENCE_KEYS = Object.keys(PREFERENCE_DEFAULTS);
    /** localStorage key used when the Settings service is unavailable. */
    const PREFERENCES_KEY = 'dsh-step-token-usage/preferences';

    const preferenceStore = {
      values: { ...PREFERENCE_DEFAULTS },
      listeners: new Set(),
      /**
       * @param listener - called whenever a preference changes.
       * @returns an unsubscribe function.
       */
      subscribe(listener) {
        preferenceStore.listeners.add(listener);
        return () => preferenceStore.listeners.delete(listener);
      },
      /** Wake every subscriber. */
      notify() {
        for (const listener of [...preferenceStore.listeners]) listener();
      },
      /**
       * Merge one snapshot over the current values.
       * @param next - partial preference values.
       * @returns whether anything actually changed.
       */
      assign(next) {
        let changed = false;
        for (const key of PREFERENCE_KEYS) {
          const value = next?.[key];
          if (typeof value !== 'boolean' || preferenceStore.values[key] === value) continue;
          preferenceStore.values[key] = value;
          changed = true;
        }
        if (changed) preferenceStore.notify();
        return changed;
      },
    };

    /** @returns the persisted preference object, or null. */
    function readStoredPreferences() {
      try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(PREFERENCES_KEY);
        return raw === null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    }

    /** Persist the current preferences. A blocked store only costs the choice. */
    function writeStoredPreferences() {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferenceStore.values));
      } catch {
        // The in-memory value still applies for this page.
      }
    }

    /**
     * Flip one preference and persist it.
     * @param name - a preference key.
     * @param value - the new boolean.
     */
    function setPreference(name, value) {
      if (!PREFERENCE_KEYS.includes(name)) return;
      preferenceStore.assign({ [name]: value === true });
      writeStoredPreferences();
      if (settingsBridge !== null) settingsBridge.push(preferenceStore.values);
    }

    /**
     * The Settings-surface bridge, installed once that surface resolves.
     *
     * Declared as a mutable seam so the preference store never depends on
     * whether Settings is available: when it is, it installs `{ push }` to
     * persist outward and calls `preferenceStore.assign()` to push inward.
     * Until then preferences live in `localStorage` only.
     */
    let settingsBridge = null;

    /** Load the stored preferences once, at module initialisation. */
    function loadPreferences() {
      const stored = readStoredPreferences();
      if (stored !== null) preferenceStore.assign(stored);
    }

    /** Subscribe a component to the preferences. */
    function usePreferences() {
      const [, bump] = React.useState(0);
      React.useEffect(() => preferenceStore.subscribe(() => bump((value) => value + 1)), []);
      return preferenceStore.values;
    }

    // #endregion

    // #region turn pricing

    /**
     * Pricing for one turn's steps, and the index the composer chip totals.
     *
     * Attempts are priced on read rather than stored priced: the amount depends
     * on the currency the reader chose, and the tier on each request's own
     * timestamp, so the same steps yield different numbers for different
     * readers.
     */

    /**
     * Price every billed request across a turn's steps.
     * @param steps - the turn's per-step ledgers.
     * @param book - the price book.
     * @param currency - the currency to price in.
     * @returns the turn's cost picture.
     */
    function priceSteps(steps, book, currency) {
      let seen = 0;
      let priced = 0;
      let unpriced = 0;
      let total = 0;
      let lowerBound = false;
      const tiers = new Set();
      for (const step of steps) {
        for (const attempt of step.attempts) {
          if (attempt.kind !== 'request') continue;
          seen += 1;
          const model = lookupModel(book, attempt.route);
          const tier = model === null ? null : tierAt(attempt.time, book);
          const cost = model === null || tier === null ? null : costOfUsage(attempt.usage, model.prices[currency], tier);
          if (cost === null) {
            unpriced += 1;
            continue;
          }
          priced += 1;
          total += cost.amount;
          if (!cost.exact) lowerBound = true;
          tiers.add(tier);
        }
      }
      return {
        currency,
        seen,
        total: priced === 0 ? null : total,
        priced,
        unpriced,
        lowerBound,
        partial: unpriced > 0,
        tiers,
      };
    }

    /**
     * Completed turns seen so far, keyed by turn number.
     *
     * The composer chip totals the whole transcript, which no single turn row can
     * see. Every materialized turn row deposits its steps here, keyed by turn so
     * a re-materialization overwrites instead of double-counting. It therefore
     * covers the turns the window has loaded — the same scope the composer's own
     * fallback totals use — and the chip says so in its tooltip.
     */
    const turnIndex = new Map();
    const turnIndexStore = {
      listeners: new Set(),
      /**
       * @param listener - called whenever the index changes.
       * @returns an unsubscribe function.
       */
      subscribe(listener) {
        turnIndexStore.listeners.add(listener);
        return () => turnIndexStore.listeners.delete(listener);
      },
      /** Wake every subscriber. */
      notify() {
        for (const listener of [...turnIndexStore.listeners]) listener();
      },
    };

    /**
     * Record one completed turn's steps.
     * @param turn - the turn number.
     * @param steps - its per-step ledgers.
     */
    function recordTurn(turn, steps) {
      const bare = steps.map((step) => ({
        turn: step.turn,
        step: step.step,
        // `kind` is kept: priceSteps filters on it, and a retry attempt must
        // stay out of the money even after the fold is re-recorded.
        attempts: step.attempts
          .filter((attempt) => attempt.kind === 'request')
          .map((attempt) => ({ kind: 'request', time: attempt.time, route: attempt.route, usage: attempt.usage })),
      }));
      // Deterministic fold, so an unchanged turn must not wake every reader.
      if (JSON.stringify(turnIndex.get(turn)) === JSON.stringify(bare)) return;
      turnIndex.set(turn, bare);
      turnIndexStore.notify();
    }

    /** @returns every recorded turn's steps, flattened. */
    function indexedSteps() {
      const all = [];
      for (const steps of turnIndex.values()) all.push(...steps);
      return all;
    }

    /** Subscribe a component to the completed-turn index. */
    function useTurnIndex() {
      const [, bump] = React.useState(0);
      React.useEffect(() => turnIndexStore.subscribe(() => bump((value) => value + 1)), []);
      return turnIndexStore;
    }

    // #endregion

    // #region derivation

    /**
     * Fold one step's matched events into an exact attempt ledger.
     *
     * A step normally bills exactly one request, so the common ledger holds one
     * `request` row. `llm/retry` events add one `retry` row each; a retried
     * attempt that never reached a usage report therefore contributes a row
     * with no token count rather than a fabricated zero.
     *
     * This is deliberately lenient where the shipped turn-level fold is strict:
     * a step whose evidence is incomplete still renders, marked as incomplete.
     * The identity invariant `total = input + cacheRead + cacheWrite + output`
     * was verified against every `assistant/message` usage sample in this
     * installation's stored sessions, and is used only to notice a sample that
     * disagrees with itself.
     *
     * @param matches - the Definition's matched events, in ascending sequence order.
     * @returns the step ledger, or undefined when there is nothing to show yet.
     */
    function deriveStepUsage(matches) {
      const attempts = [];
      let turn = null;
      let step = null;
      let anchorSeq = null;
      let settledSeq = null;
      let interrupted = false;

      for (const match of matches) {
        const event = match.event;
        if (!isSessionEvent(event)) continue;
        const data = event.data ?? {};
        if (turn === null && typeof data.turn === 'number') turn = data.turn;
        if (step === null && typeof data.step === 'number') step = data.step;

        if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
          const usage = readUsage(data.usage);
          attempts.push({
            kind: 'request',
            seq: event.seq,
            time: event.time,
            route: readRoute(event),
            usage,
            interrupted: data.interrupted === true,
          });
          settledSeq = event.seq;
          if (data.interrupted === true) interrupted = true;
        } else if (event.type === 'llm/retry') {
          attempts.push({
            kind: 'retry',
            seq: event.seq,
            time: event.time,
            route: typeof data.provider === 'string' && data.provider !== '' ? { provider: data.provider, model: null } : null,
            usage: null,
            attempt: count(data.retry),
            maxRetries: count(data.maxRetries),
            failure: readFailure(event),
          });
        }
      }

      if (turn === null || step === null) return undefined;
      // Nothing billed and no failure recorded yet: stay unmaterialized so a
      // still-streaming step does not grow an empty row.
      if (attempts.length === 0) return undefined;

      attempts.sort((left, right) => left.seq - right.seq);

      let requestIndex = 0;
      let requestCount = 0;
      let retryCount = 0;
      const routes = [];
      for (const attempt of attempts) {
        if (attempt.kind === 'request') {
          requestIndex += 1;
          requestCount += 1;
          attempt.index = requestIndex;
          const route = attempt.route;
          if (route !== null && !routes.some((known) => known.provider === route.provider && known.model === route.model)) routes.push(route);
        } else {
          retryCount += 1;
          if (attempt.route !== null && !routes.some((known) => known.provider === attempt.route.provider)) routes.push(attempt.route);
        }
      }

      const billed = attempts.filter((attempt) => attempt.kind === 'request' && attempt.usage !== null);
      const buckets = {};
      const missingCoreBuckets = [];
      const missingOptionalBuckets = [];
      for (const key of BUCKETS) {
        let sum = 0;
        let seen = 0;
        let absent = 0;
        for (const attempt of billed) {
          const value = attempt.usage[key];
          if (value === null || value === undefined) absent += 1;
          else {
            sum += value;
            seen += 1;
          }
        }
        buckets[key] = seen === 0 ? null : sum;
        if (absent === 0) continue;
        if (CORE_BUCKETS.includes(key)) missingCoreBuckets.push(key);
        else if (OPTIONAL_BUCKETS.includes(key)) missingOptionalBuckets.push(key);
      }
      // `reasoning` is deliberately absent from both lists: it is an output
      // subset that providers routinely omit, so flagging it would warn on
      // every single step and drown the real signal.
      const missingBuckets = missingCoreBuckets.concat(missingOptionalBuckets);

      // Prefer the provider's own total; fall back to the reported buckets and
      // say so, rather than passing a sum off as the provider value.
      let totalTokens = buckets.total;
      let derivedTotal = false;
      if (totalTokens === null) {
        const parts = [buckets.input, buckets.cacheRead, buckets.cacheWrite, buckets.output].filter((value) => value !== null);
        if (parts.length > 0) {
          totalTokens = parts.reduce((sum, value) => sum + value, 0);
          derivedTotal = true;
        }
      }

      const hasUsage = billed.length > 0;
      anchorSeq = settledSeq ?? attempts[attempts.length - 1].seq;

      const promptTokens = totalTokens !== null && buckets.output !== null ? totalTokens - buckets.output : null;

      return {
        turn,
        step,
        anchorSeq,
        attempts,
        requestCount,
        retryCount,
        hasUsage,
        buckets,
        totalTokens,
        derivedTotal,
        missingBuckets,
        missingCoreBuckets,
        missingOptionalBuckets,
        routes,
        interrupted: interrupted || (attempts.length > 0 && requestCount === 0),
        cacheHitPercent: hasUsage ? cacheHit(buckets.cacheRead, promptTokens) : null,
      };
    }

    // #endregion

    // #region definition

    /**
     * Build one final Chat node. The shipped `chatNode` helper is bundle-private,
     * so this mirrors its contract: the engine-owned stable key, the declared
     * target, and the Location the engine resolved for this Definition.
     * @param context - assembled business Context.
     * @param kind - the renderer kind this node materializes as.
     * @param anchorSeq - sequence this row sorts at.
     * @param data - the row payload.
     * @returns the final Chat view node.
     */
    function viewNode(context, kind, anchorSeq, data) {
      return {
        key: context.key,
        kind,
        id: context.id,
        target: TARGET,
        anchorSeq,
        location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        data,
      };
    }

    /** @returns the Definition-local identity of one step-scoped event. */
    function stepId(event) {
      return `${event.data.turn}:${event.data.step}`;
    }

    const stepUsageDefinition = {
      kind: KIND,
      target: TARGET,
      match: (event) => {
        if (event.type === 'step/start') return { id: stepId(event), role: 'start' };
        if (event.type === 'assistant/message' && event.surfaceOp === 'append') return { id: stepId(event), role: 'update' };
        if (event.type === 'llm/retry') return { id: stepId(event), role: 'update' };
        return null;
      },
      start: (_context, match) => ({ turn: match.event.data.turn, step: match.event.data.step }),
      // All data is derived from `context.matches` at materialization time, so
      // the state carries only identity and stays reference-stable here. That
      // also keeps the row correct when the loaded window starts mid-step and
      // no `step/start` was ever seen.
      update: (context) => context.state,
      publication: (match) => (match.event.type === 'step/start' ? 'none' : 'immediate'),
      buildViewNode: (context) => {
        const current = context.current.get(TARGET);
        const data = deriveStepUsage(context.matches);
        // Once a row is materialized the engine forbids withdrawing it, so an
        // unavailable ledger hides the existing row instead of returning null.
        if (data === undefined) return current == null ? null : { ...current, visibility: 'hidden' };
        return viewNode(context, KIND, data.anchorSeq, data);
      },
    };

    /**
     * Fold a whole turn's matched events into its per-step ledgers.
     *
     * The turn row cannot borrow the step rows: a step Definition only ever sees
     * its own step, and a side ledger written by them is only as complete as the
     * rows the window has materialized. A turn-scoped Definition receives every
     * event of its turn — the same evidence the shipped turn footer uses — so
     * this fold is complete the moment the row exists.
     *
     * @param matches - the turn's matched events.
     * @returns `{ steps, anchorSeq, turn }`, or null when nothing was billed.
     */
    function deriveTurnCost(matches) {
      const byStep = new Map();
      let turn = null;
      let settledSeq = null;
      for (const match of matches) {
        const event = match.event;
        if (!isSessionEvent(event)) continue;
        const data = event.data ?? {};
        if (turn === null && typeof data.turn === 'number') turn = data.turn;
        // The anchor stays at the last settled Assistant message, never at
        // `turn/end`: the shipped footer treats any row anchored past the closing
        // message as later transcript and greys out its branch action.
        if (event.type === 'assistant/message' && event.surfaceOp === 'append') settledSeq = event.seq;
        if (typeof data.turn !== 'number' || typeof data.step !== 'number') continue;
        const key = `${data.turn}:${data.step}`;
        const group = byStep.get(key);
        if (group === undefined) byStep.set(key, [match]);
        else group.push(match);
      }
      if (turn === null || settledSeq === null) return null;

      const steps = [];
      for (const group of byStep.values()) {
        const step = deriveStepUsage(group);
        if (step !== undefined) steps.push(step);
      }
      if (steps.length === 0) return null;
      return { turn, anchorSeq: settledSeq, steps };
    }

    /** Turn-scoped Definition; its row is the per-turn money line. */
    const turnCostDefinition = {
      kind: TURN_KIND,
      target: TARGET,
      match: (event) => {
        const turn = event.data?.turn;
        if (typeof turn !== 'number') return null;
        if (event.type === 'turn/start') return { id: String(turn), role: 'start' };
        if (event.type === 'turn/end') return { id: String(turn), role: 'update' };
        if (event.type === 'assistant/message' && event.surfaceOp === 'append') return { id: String(turn), role: 'update' };
        if (event.type === 'llm/retry') return { id: String(turn), role: 'update' };
        return null;
      },
      start: (_context, match) => ({ turn: match.event.data.turn }),
      update: (context) => context.state,
      // Published only once the turn ends, exactly like the shipped turn footer:
      // a running turn has no total to show, and materializing on `turn/end`
      // means every event of the turn is already in `context.matches`.
      publication: (match) => (match.event.type === 'turn/end' ? 'immediate' : 'none'),
      buildViewNode: (context) => {
        const current = context.current.get(TARGET);
        const data = deriveTurnCost(context.matches);
        if (data === null) return current == null ? null : { ...current, visibility: 'hidden' };
        // Deposit for the composer chip before returning: a turn row is the only
        // place that ever sees a whole turn.
        recordTurn(data.turn, data.steps);
        return viewNode(context, TURN_KIND, data.anchorSeq, data);
      },
    };

    // #endregion

    // #region styles

    /**
     * Styling mirrors the dialog the chat already opens for Turn usage:
     * trigger metrics from `TurnUsagePanel.module.css`, panel surface,
     * elevation, type scale and two-column details grid from
     * `stat-dialog.module.css` (both in @deepseek-ai/dsh-client-ui-chat).
     *
     * Those stylesheets are copied, not imported — a plugin may not load a
     * Harness client package. Class names live under this plugin's `stu-`
     * prefix and only theme tokens are referenced, so the dialog follows light
     * and dark themes exactly as the shipped one does.
     */
    const CSS = [
      // trigger — same box, type and hover treatment as the shipped pill
      '.stu-root{display:inline-flex;min-width:0}',
      '.stu-strip{display:flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}',
      '.stu-toggle{display:inline-flex;align-items:center;gap:4px;min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px 8px;border:none;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:inherit;font:inherit;font-variant-numeric:inherit;line-height:inherit;white-space:nowrap;cursor:pointer}',
      '.stu-toggle:hover,.stu-toggle[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.stu-toggle svg{flex:none;width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}',
      '.stu-toggle .stu-chevron{width:11px;height:11px}',
      '.stu-total{color:var(--dsw-alias-label-secondary)}',
      '.stu-dot{opacity:.45}',
      '.stu-warn{color:var(--dsw-alias-state-warn-primary)}',
      // dialog — the shipped stat-dialog surface, elevation and type scale
      '.stu-panel{position:fixed;z-index:1100;box-sizing:border-box;width:max-content;min-width:min(300px,100vw - 24px);max-width:min(440px,100vw - 24px);padding:16px;border:0;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay));backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:default}',
      '.stu-panelTitle{display:flex;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.stu-panelLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.stu-panelLabel svg{flex:none;width:14px;height:14px}',
      '.stu-panelValue{font-variant-numeric:tabular-nums}',
      '.stu-panelRule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}',
      '.stu-details{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;color:var(--dsw-alias-label-tertiary)}',
      '.stu-details dt,.stu-details dd{min-width:0;margin:0}',
      '.stu-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}',
      '.stu-details .stu-route{overflow-wrap:anywhere}',
      '.stu-details dd.stu-wide{grid-column:1 / -1;text-align:left}',
      '.stu-details dd.stu-miss{color:var(--dsw-alias-state-warn-primary)}',
      '.stu-miss{color:var(--dsw-alias-state-warn-primary)}',
      '.stu-reasoning{color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      // plugin additions, held to the same type scale and tokens
      '.stu-sub{margin-top:10px}',
      '.stu-subTitle{display:flex;justify-content:space-between;gap:16px;margin-bottom:6px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.stu-subLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.stu-notes{margin-top:10px;display:grid;gap:4px}',
      '.stu-note{color:var(--dsw-alias-label-tertiary)}',
      '.stu-noteWarn{color:var(--dsw-alias-state-warn-primary)}',
      // cost section — same grid and type scale as the delivered field rows
      '.stu-cost{color:var(--dsw-alias-label-secondary)}',
      '.stu-costValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.stu-costToggle{display:inline-flex;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2)}',
      '.stu-costButton{height:20px;padding:0 6px;border:none;border-radius:calc(var(--dsw-radius-sm,6px) - 2px);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:20px;cursor:pointer;white-space:nowrap}',
      '.stu-costButton:hover{color:var(--dsw-alias-label-primary)}',
      '.stu-costButton[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary)}',
      // per-bucket unit price and its contribution, held to the tertiary label
      '.stu-unitPrice{color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      // the per-turn money row, on the same type scale as its neighbours
      '.stu-turnRow{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.stu-turnLabel{color:var(--dsw-alias-label-tertiary)}',
      '.stu-turnAmount{color:var(--dsw-alias-label-secondary);font-weight:500}',
      '.stu-turnTier{color:var(--dsw-alias-label-tertiary)}',
      // the turn-tail contribution sits inline beside the shipped turn pill
      '.stu-turnCost{display:inline-flex;align-items:center;gap:4px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
      // Settings → General rows. Metrics are copied from the shipped
      // `EnterBehaviorRow` module (`ui-conversation`) so a contributed row is
      // indistinguishable from a built-in one: same rule, padding, type scale
      // and description colour, all from the same theme tokens.
      '.stu-setRow{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.stu-setRowText{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0;padding-right:48px}',
      '.stu-setRowTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
      '.stu-setRowDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}',
      '.stu-setSwitch{position:relative;flex:none;width:36px;height:20px;padding:0;border:none;border-radius:10px;background:var(--dsw-alias-bg-module-platform);cursor:pointer;transition:background .15s ease}',
      '.stu-setSwitch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
      '.stu-setSwitch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.stu-setKnob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease}',
      '.stu-setSwitch[aria-checked=true] .stu-setKnob{transform:translateX(16px)}',
    ].join('');

    // #endregion

    // #region dialog seat

    /** Distance kept between the trigger and the dialog above it. */
    const PANEL_GAP = 8;
    /** Minimum distance the dialog keeps from every viewport edge. */
    const PANEL_MARGIN = 12;
    /**
     * First-pass style. The panel has to be in the document to be measured,
     * but must not flash at the origin while the anchor is read.
     */
    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 };

    /**
     * Place a portaled panel above its trigger, clamped to the viewport.
     *
     * The behaviour is copied from the shipped `useAnchoredPosition` primitive
     * (side `top`, align `start`, gap 8, margin 12) because a plugin may not
     * import a Harness client package. It re-places on scroll, resize and panel
     * resize, so the dialog tracks its trigger instead of detaching from it.
     *
     * @param options - open flag plus the anchor and panel refs.
     * @returns fixed offsets once measured, otherwise null.
     */
    function useAnchoredPosition({ open, anchorRef, panelRef, gap, margin }) {
      const [position, setPosition] = React.useState(null);
      React.useLayoutEffect(() => {
        if (!open) {
          setPosition(null);
          return undefined;
        }
        const place = () => {
          const rect = anchorRef.current?.getBoundingClientRect();
          if (rect === undefined) return;
          const panel = panelRef.current;
          const width = panel?.offsetWidth ?? 0;
          const height = panel?.offsetHeight ?? 0;
          let left = rect.left;
          let top = rect.top - gap - height;
          if (width > 0) left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);
          if (height > 0) top = Math.min(Math.max(top, margin), window.innerHeight - height - margin);
          setPosition({ left, top });
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        const panel = panelRef.current;
        let observer = null;
        if (typeof ResizeObserver !== 'undefined' && panel !== null) {
          observer = new ResizeObserver(place);
          observer.observe(panel);
        }
        return () => {
          observer?.disconnect();
          window.removeEventListener('scroll', place, true);
          window.removeEventListener('resize', place);
        };
      }, [open, anchorRef, panelRef, gap, margin]);
      return position;
    }

    /**
     * Close when a pointer press lands outside both the trigger and the
     * portaled panel. Behaviour copied from the shipped
     * `useDismissOnOutsidePointer`, which treats a `document.body` portal as
     * inside as well.
     *
     * @param rootRef - the trigger's element.
     * @param open - whether the surface is showing.
     * @param setOpen - state setter called with false.
     * @param panelRef - the portaled surface's element.
     */
    function useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef) {
      React.useEffect(() => {
        if (!open) return undefined;
        const closeOutside = (event) => {
          if (
            event.target instanceof Node &&
            rootRef.current?.contains(event.target) !== true &&
            panelRef.current?.contains(event.target) !== true
          ) {
            setOpen(false);
          }
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => {
          document.removeEventListener('pointerdown', closeOutside);
        };
      }, [rootRef, open, setOpen, panelRef]);
    }

    // #endregion

    // #region view

    function DatabaseIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': true },
        h('ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }),
        h('path', { d: 'M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6' }),
        h('path', { d: 'M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3' }),
      );
    }

    function ChevronIcon({ open }) {
      return h(
        'svg',
        { className: 'stu-chevron', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: open ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7' }),
      );
    }

    /** Exact count with the shipped dialog's unit suffix, or a missing marker. */
    function tokenText(value, t) {
      return value === null ? h('span', { className: 'stu-miss' }, t('value.missing')) : t('pill.count', { count: exact(value, t) });
    }

    /** @returns the `provider / model` text of one route, or null when unattributed. */
    function routeText(route) {
      return route === null ? null : [route.provider, route.model].filter(Boolean).join(' / ');
    }

    /**
     * The rate-card field that bills each usage bucket.
     *
     * DeepSeek publishes no separate cache-write premium, so a reported write is
     * billed as ordinary uncached input — the same field as `input`.
     */
    const BUCKET_PRICE_FIELD = { input: 'inputMiss', cacheRead: 'inputHit', cacheWrite: 'inputMiss', output: 'output' };

    /**
     * Bucket rows of one usage sample, in the shipped dialog's field order.
     * A bucket the provider omitted is left out entirely rather than printed as
     * a zero; the footnote names it instead.
     *
     * When the row can be attributed to exactly one rate card and tier, the unit
     * price and that bucket's own contribution are appended, so the step total
     * can be read as the sum of the rows above it rather than taken on trust.
     * An ambiguous row (a step whose requests split across tiers or models)
     * passes no pricing and shows counts only; its per-request sections carry
     * their own.
     *
     * @param keyPrefix - React key prefix, unique within the dialog.
     * @param buckets - normalized buckets.
     * @param t - translate seat.
     * @param pricing - `{ table, currency }` for this row, or null.
     * @returns keyed `dt`/`dd` element pairs.
     */
    function bucketRows(keyPrefix, buckets, t, pricing) {
      const rows = [];
      const priceNote = (bucket, tokens) => {
        if (!preferenceStore.values.showRowPrices) return null;
        const rate = pricing == null ? null : pricing.table?.[BUCKET_PRICE_FIELD[bucket]];
        if (rate === null || rate === undefined) return null;
        const unit = unitPriceText(rate, pricing.currency);
        if (unit === null) return null;
        const amount = tokens === null ? null : moneyText((tokens * rate) / 1e6, pricing.currency);
        return h(
          'span',
          { className: 'stu-unitPrice', key: `${keyPrefix}-price-${bucket}` },
          ' · ',
          unit,
          amount === null ? null : ` · ${amount}`,
        );
      };
      const pair = (key, label, tokens, ...nodes) => {
        rows.push(h('dt', { key: `${keyPrefix}-dt-${key}` }, label));
        rows.push(h('dd', { key: `${keyPrefix}-dd-${key}` }, ...nodes, priceNote(key, tokens)));
      };
      pair('input', t('field.input'), buckets.input, tokenText(buckets.input, t));
      if (buckets.cacheRead !== null) pair('cacheRead', t('field.cacheRead'), buckets.cacheRead, tokenText(buckets.cacheRead, t));
      if (buckets.cacheWrite !== null) pair('cacheWrite', t('field.cacheWrite'), buckets.cacheWrite, tokenText(buckets.cacheWrite, t));
      pair(
        'output',
        t('field.output'),
        buckets.output,
        tokenText(buckets.output, t),
        buckets.reasoning === null
          ? null
          : h('span', { className: 'stu-reasoning' }, ' ', t('field.reasoning', { tokens: exact(buckets.reasoning, t) })),
      );
      return rows;
    }

    /**
     * A section heading inside the dialog, shaped like the panel's own title:
     * label left, value right, an optional failure code beside the label.
     *
     * @param key - React key.
     * @param label - left-hand heading.
     * @param value - optional right-hand value.
     * @param code - optional failure code.
     * @returns the heading.
     */
    function subTitle(key, label, value, code) {
      return h(
        'div',
        { className: 'stu-subTitle', key },
        h('span', { className: 'stu-subLabel' }, label, code === null ? null : h('span', { className: 'stu-warn' }, code)),
        value === null ? null : h('span', { className: 'stu-panelValue' }, value),
      );
    }

    /**
     * @param tiers - the tiers the step's priced requests landed in.
     * @param t - translate seat.
     * @returns the step's pricing tier, or null when nothing was priced.
     */
    function tierLabel(tiers, t) {
      if (tiers.size > 1) return t('tier.mixed');
      if (tiers.size === 1) return tiers.has('peak') ? t('tier.peak') : t('tier.offPeak');
      return null;
    }

    /**
     * @param ms - an epoch-millisecond stamp.
     * @returns local `YYYY-MM-DD HH:MM`.
     */
    function stampText(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
      const at = new Date(ms);
      const pad = (value) => String(value).padStart(2, '0');
      return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    }

    /**
     * The currency switch.
     *
     * Rendered only when the book publishes more than one currency, so a
     * single-currency deployment never grows a control that cannot do anything.
     *
     * @param props - the book, the active currency and the locale seat.
     * @returns the segmented control, or null.
     */
    function CurrencyToggle({ book, currency, t }) {
      if (book.currencies.length < 2) return null;
      return h(
        'span',
        { className: 'stu-costToggle', role: 'group', 'aria-label': t('field.currency') },
        book.currencies.map((code) =>
          h(
            'button',
            {
              key: code,
              type: 'button',
              className: 'stu-costButton',
              'aria-pressed': code === currency,
              onClick: () => setCurrency(code),
            },
            `${SYMBOLS[code] ?? ''} ${code}`,
          ),
        ),
      );
    }

    /**
     * One preference row inside Settings → General.
     *
     * `settings.general.item` is the documented additive seat for "a single
     * setting that needs no page of its own": the section stacks whatever is
     * registered and passes no props, so the row draws its own label, reads its
     * own value and owns its write path. That is why these are plain toggles
     * over `localStorage` rather than a host config schema.
     *
     * @param props - the preference this row edits and the locale seat.
     * @returns the settings row.
     */
    function PreferenceRow({ preference, t }) {
      const preferences = usePreferences();
      const on = preferences[preference] === true;
      return h(
        'div',
        { className: 'stu-setRow', 'data-preference': preference },
        h(
          'div',
          { className: 'stu-setRowText' },
          h('div', { className: 'stu-setRowTitle' }, t(`preference.${preference}.title`)),
          h('div', { className: 'stu-setRowDesc' }, t(`preference.${preference}.description`)),
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'switch',
            'aria-checked': on,
            'aria-label': t(`preference.${preference}.title`),
            className: 'stu-setSwitch',
            onClick: () => setPreference(preference, !on),
          },
          h('span', { className: 'stu-setKnob', 'aria-hidden': true }),
        ),
      );
    }

    /**
     * The per-turn money row.
     *
     * Rendered as this plugin's own Chat node rather than contributed into the
     * shipped turn footer: the row is then fed by the turn's whole evidence,
     * exactly like the per-step pills, and carries no dependency on whether
     * other rows happen to have been materialized first.
     *
     * @param props - the Chat node and the locale seat.
     * @returns the money line, or null while it cannot be priced.
     */
    function TurnCostView({ node, t }) {
      const data = node.data;
      const store = usePriceBook();
      const book = store.book;
      const currency = book === null ? null : currencyOf(book);
      const cost = book === null || currency === null ? null : priceSteps(data.steps, book, currency);
      if (cost === null || cost.seen === 0) return null;

      const tier = tierLabel(cost.tiers, t);
      if (cost.total === null) {
        if (store.status !== 'ready') return null;
        return h('div', { className: 'stu-turnRow stu-warn', 'data-turn-cost': data.turn }, t('pill.priceUnknown'));
      }
      return h(
        'div',
        { className: 'stu-turnRow', 'data-turn-cost': data.turn },
        h('span', { className: 'stu-turnLabel' }, t('cost.turnTotal')),
        h('span', { className: 'stu-turnAmount' }, `${cost.lowerBound ? '\u2265' : ''}${moneyText(cost.total, currency)}`),
        tier === null ? null : h('span', { className: 'stu-turnTier' }, tier),
      );
    }

    /**
     * The whole-transcript money chip in the composer dock.
     *
     * It sits beside the shipped session pills, which are themselves a list-slot
     * contribution into the same dock, and totals every completed turn this
     * window has seen. The tooltip states that scope, because it is the window's
     * rather than the durable session's.
     *
     * @param props - the locale seat (the dock owner passes no props).
     * @returns the chip, or null while there is nothing to total.
     */
    function SessionCostChip({ t }) {
      useTurnIndex();
      const store = usePriceBook();
      const book = store.book;
      const currency = book === null ? null : currencyOf(book);
      if (book === null || currency === null) return null;
      const steps = indexedSteps();
      if (steps.length === 0) return null;
      const cost = priceSteps(steps, book, currency);
      if (cost.seen === 0 || cost.total === null) return null;
      const tier = tierLabel(cost.tiers, t);
      const title = [t('cost.sessionTotal'), t('cost.overTurns', { count: turnIndex.size }), tier].filter(Boolean).join(' · ');
      return h(
        'span',
        { className: 'stu-turnCost', 'data-session-cost': turnIndex.size, title },
        `${cost.lowerBound ? '\u2265' : ''}${moneyText(cost.total, currency)}`,
      );
    }

    /**
     * Always-visible per-step usage pill. Opening it portals the same dialog
     * the chat already opens for Turn usage — same surface, elevation, type
     * scale and two-column field grid — anchored above the pill.
     *
     * @param props - the Chat node and the locale seat.
     * @returns the trigger row, plus the portaled dialog while open.
     */
    function StepUsageView({ node, t }) {
      const data = node.data;
      const [open, setOpen] = React.useState(false);
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const pos = useAnchoredPosition({ open, anchorRef: rootRef, panelRef, gap: PANEL_GAP, margin: PANEL_MARGIN });
      useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef);
      const store = usePriceBook();
      const preferences = usePreferences();

      // Priced once per render from the book and each request's own timestamp,
      // so a step that straddles a peak boundary is billed at both rates.
      const book = store.book;
      const currency = book === null ? null : currencyOf(book);
      const cost = book === null || currency === null ? null : priceStep(data, book, currency);
      /** @returns an amount, marking a total that is only a lower bound. */
      const amountText = (amount, exact) => `${exact ? '' : '\u2265'}${moneyText(amount, currency)}`;

      /**
       * The rate card for one request, or null when it cannot be attributed.
       * @param attempt - one matched request attempt.
       * @returns `{ table, currency }` or null.
       */
      const pricingOf = (attempt) => {
        if (book === null || currency === null || attempt.usage === null) return null;
        const model = lookupModel(book, attempt.route);
        const tier = model === null ? null : tierAt(attempt.time, book);
        const table = model === null || tier === null ? null : model.prices[currency]?.[tier];
        return table === null || table === undefined ? null : { table, currency };
      };

      // Unit prices on the step's own rows are only truthful when every request
      // in the step shares one rate card and one tier; otherwise the per-request
      // sections below carry them, where the attribution is unambiguous.
      const stepPricing = (() => {
        const requests = data.attempts.filter((attempt) => attempt.kind === 'request' && attempt.usage !== null);
        if (requests.length === 0) return null;
        const first = pricingOf(requests[0]);
        if (first === null) return null;
        const uniform = requests.every((attempt) => {
          const other = pricingOf(attempt);
          return other !== null && other.table === first.table;
        });
        return uniform ? first : null;
      })();

      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      // ---- trigger ------------------------------------------------------
      const strip = [
        h(
          'button',
          {
            key: 'toggle',
            type: 'button',
            className: 'stu-toggle',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            title: open ? t('pill.collapse') : t('pill.expand'),
            onClick: () => setOpen((value) => !value),
          },
          h(DatabaseIcon, { key: 'icon' }),
          h(
            'span',
            { className: data.hasUsage ? 'stu-total' : 'stu-warn', key: 'label' },
            data.hasUsage ? t('pill.usage', { total: compact(data.totalTokens, t) }) : t('pill.noUsage'),
          ),
          h(ChevronIcon, { open, key: 'chevron' }),
        ),
      ];
      const chips = [];
      if (data.buckets.input !== null) chips.push(t('pill.input', { count: compact(data.buckets.input, t) }));
      if (data.buckets.cacheRead !== null) chips.push(t('pill.cacheRead', { count: compact(data.buckets.cacheRead, t) }));
      if (data.buckets.output !== null) chips.push(t('pill.output', { count: compact(data.buckets.output, t) }));
      if (data.retryCount > 0) chips.push(t('pill.retried', { count: data.retryCount }));
      // The money chip trails the token chips: the same order the dialog reads
      // in, and the amount is meaningless until the counts above it are read.
      if (cost !== null && cost.total !== null) chips.push(amountText(cost.total, !cost.lowerBound));
      else if (data.hasUsage && store.status === 'ready') chips.push(t('pill.priceUnknown'));
      chips.forEach((chip, index) => {
        strip.push(h('span', { className: 'stu-dot', key: `dot-${index}`, 'aria-hidden': true }, '·'));
        strip.push(h('span', { key: `chip-${index}` }, chip));
      });

      // ---- dialog -------------------------------------------------------
      let dialog = null;
      if (open) {
        const body = [];
        body.push(
          h(
            'div',
            { className: 'stu-panelTitle', key: 'title' },
            h('span', { className: 'stu-panelLabel' }, h(DatabaseIcon), t('panel.title')),
            h(
              'span',
              { className: 'stu-panelValue' },
              data.hasUsage ? t('pill.count', { count: exact(data.totalTokens, t) }) : t('value.missing'),
            ),
          ),
          h('div', { className: 'stu-panelRule', key: 'rule', 'aria-hidden': true }),
        );

        // Step-level totals, in the shipped dialog's field order.
        const stepRows = [
          h('dt', { key: 'dt-step' }, t('field.step')),
          h('dd', { key: 'dd-step' }, t('panel.step', { turn: data.turn, step: data.step })),
        ];
        const aggregated = data.routes.map((route) => routeText(route)).filter(Boolean).join(', ');
        if (data.requestCount <= 1 && aggregated !== '') {
          stepRows.push(h('dt', { key: 'dt-model' }, t('field.model')));
          stepRows.push(h('dd', { key: 'dd-model', className: 'stu-route' }, aggregated));
        }
        if (data.cacheHitPercent !== null) {
          stepRows.push(h('dt', { key: 'dt-hit' }, t('field.cacheHit')));
          stepRows.push(h('dd', { key: 'dd-hit' }, `${data.cacheHitPercent}%`));
        }
        stepRows.push(...bucketRows('step', data.buckets, t, stepPricing));
        body.push(h('dl', { className: 'stu-details', key: 'step' }, stepRows));

        // ---- cost, directly under the token rows it is derived from ------
        //
        // Rendered only when there is something honest to say: while the book is
        // still loading the section would have to read "unknown" for a reason
        // that is merely "not yet", and a step with no reported usage has its
        // own explanation in the token notes already.
        const costNotes = [];
        const showCost = store.status === 'unavailable' || (store.status === 'ready' && data.hasUsage === true);
        if (showCost) {
          // No divider here: the amount belongs to the token rows directly
          // above it, and a rule reads as a section break between them.
          const costRows = [
            h('dt', { key: 'cost-dt-total' }, t('cost.section')),
            h(
              'dd',
              { key: 'cost-dd-total' },
              cost !== null && cost.total !== null ? amountText(cost.total, !cost.lowerBound) : t('cost.unknown'),
            ),
          ];
          const tier = cost === null ? null : tierLabel(cost.tiers, t);
          if (tier !== null) {
            costRows.push(h('dt', { key: 'dt-cost-tier' }, t('field.tier')));
            costRows.push(h('dd', { key: 'dd-cost-tier' }, tier));
          }
          // Which source supplied the unit price is provenance, not arithmetic:
          // useful when auditing a figure and noise the rest of the time, so it
          // is behind a preference.
          if (preferences.showSource && cost !== null && cost.source !== null) {
            costRows.push(h('dt', { key: 'dt-cost-src' }, t('field.priceSource')));
            costRows.push(h('dd', { key: 'dd-cost-src' }, t(`source.${cost.source}`)));
          }
          if (preferences.showCurrency && book !== null) {
            costRows.push(h('dt', { key: 'dt-cost-cur' }, t('field.currency')));
            costRows.push(h('dd', { key: 'dd-cost-cur' }, h(CurrencyToggle, { key: 'toggle', book, currency, t }) ?? currency));
          }
          if (costRows.length > 0) body.push(h('dl', { className: 'stu-details stu-cost', key: 'cost' }, costRows));

          if (store.status === 'unavailable') {
            costNotes.push(['stu-noteWarn', t('note.costNoBook')]);
          } else if (cost === null || cost.total === null) {
            const model = data.routes.map((route) => route.model).filter(Boolean).join(', ');
            costNotes.push(['stu-noteWarn', t('note.costUnknownModel', { model: model === '' ? t('value.missing') : model })]);
          } else {
            if (cost.partial) costNotes.push(['stu-noteWarn', t('note.costPartial', { count: cost.unpriced })]);
            if (store.stale) {
              const stamp = stampText(store.fetchedAt);
              if (stamp !== null) costNotes.push(['stu-note', t('note.costStale', { time: stamp })]);
            }
            // The derivation and the peak-window provenance are the bulk of the
            // disclosure's text and the first thing a reader stops needing, so
            // both sit behind one preference.
            if (preferences.showBasis) {
              costNotes.push(['stu-note', t('note.costBasis')]);
              if (typeof book?.windowSource === 'string') {
                costNotes.push(['stu-note', t('note.costWindowSource', { source: t(`sourceName.${book.windowSource}`) })]);
              }
            }
          }
          if (costNotes.length > 0) {
            body.push(
              h(
                'div',
                // Distinguished from the token caveats so styling and tests can
                // tell the two note blocks apart without relying on order.
                { className: 'stu-notes stu-costNotes', key: 'cost-notes' },
                costNotes.map(([className, text], index) => h('div', { className, key: `cost-note-${index}` }, text)),
              ),
            );
          }
        }

        // One section per request, once a step billed more than one.
        if (data.requestCount > 1) {
          for (const attempt of data.attempts) {
            if (attempt.kind !== 'request') continue;
            const key = `req${attempt.index}`;
            body.push(h('div', { className: 'stu-panelRule stu-sub', key: `${key}-rule`, 'aria-hidden': true }));
            body.push(
              subTitle(
                `${key}-title`,
                t('panel.request', { index: attempt.index }),
                attempt.usage === null ? null : t('pill.count', { count: exact(attempt.usage.total, t) }),
                null,
              ),
            );
            const rows = [
              h('dt', { key: `${key}-dt-model` }, t('field.model')),
              h('dd', { key: `${key}-dd-model`, className: 'stu-route' }, routeText(attempt.route) ?? t('value.missing')),
            ];
            if (attempt.usage === null) {
              rows.push(h('dd', { key: `${key}-dd-none`, className: 'stu-wide stu-miss' }, t('panel.noUsageForRequest')));
            } else {
              rows.push(...bucketRows(key, attempt.usage, t, pricingOf(attempt)));
            }
            // Each request carries its own amount and its own tier, because a
            // multi-request step can span a peak boundary or two models.
            const priced = cost === null ? null : (cost.requests.find((entry) => entry.index === attempt.index) ?? null);
            if (priced !== null && priced.amount !== null) {
              rows.push(h('dt', { key: `${key}-dt-cost` }, t('field.cost')));
              rows.push(h('dd', { key: `${key}-dd-cost` }, amountText(priced.amount, priced.exact)));
              if (priced.tier !== null) {
                rows.push(h('dt', { key: `${key}-dt-tier` }, t('field.tier')));
                rows.push(h('dd', { key: `${key}-dd-tier` }, priced.tier === 'peak' ? t('tier.peak') : t('tier.offPeak')));
              }
            } else if (attempt.usage !== null && store.status === 'ready') {
              rows.push(h('dt', { key: `${key}-dt-cost` }, t('field.cost')));
              rows.push(h('dd', { key: `${key}-dd-cost`, className: 'stu-miss' }, t('cost.unknown')));
            }
            body.push(h('dl', { className: 'stu-details', key: `${key}-details` }, rows));
          }
        }

        // One section per retry: the failure, and the fact that it billed nothing.
        for (const attempt of data.attempts) {
          if (attempt.kind !== 'retry') continue;
          const key = `retry${attempt.seq}`;
          const heading =
            attempt.maxRetries !== null && attempt.attempt !== null
              ? t('panel.retry', { attempt: attempt.attempt, max: attempt.maxRetries })
              : t('panel.retryNoMax', { attempt: attempt.attempt ?? '?' });
          body.push(h('div', { className: 'stu-panelRule stu-sub', key: `${key}-rule`, 'aria-hidden': true }));
          body.push(subTitle(`${key}-title`, heading, null, attempt.failure?.code ?? null));
          const rows = [];
          if (attempt.failure && attempt.failure.message !== null) {
            rows.push(h('dt', { key: `${key}-dt-fail` }, t('field.failure')));
            rows.push(h('dd', { key: `${key}-dd-fail`, className: 'stu-route' }, attempt.failure.message));
          }
          rows.push(h('dt', { key: `${key}-dt-use` }, t('field.usage')));
          rows.push(h('dd', { key: `${key}-dd-use`, className: 'stu-miss' }, t('value.missing')));
          body.push(h('dl', { className: 'stu-details', key: `${key}-details` }, rows));
        }

        // Footnotes: what the provider did not report, never a silent zero.
        const notes = [];
        if (!data.hasUsage) {
          notes.push(['stu-noteWarn', t('note.noUsage')]);
        } else {
          const fieldNames = (keys) => keys.map((name) => t(`field.${name}`)).join('、');
          if (data.missingCoreBuckets.length > 0) {
            notes.push(['stu-noteWarn', t('note.partial', { fields: fieldNames(data.missingCoreBuckets) })]);
          }
          if (data.missingOptionalBuckets.length > 0) {
            notes.push(['stu-note', t('note.partialOptional', { fields: fieldNames(data.missingOptionalBuckets) })]);
          }
          if (data.missingCoreBuckets.length === 0 && data.derivedTotal) {
            notes.push(['stu-note', t('note.derivedTotal')]);
          }
        }
        if (data.interrupted) notes.push(['stu-noteWarn', t('note.interrupted')]);
        if (notes.length > 0) {
          body.push(
            h(
              'div',
              { className: 'stu-notes stu-tokenNotes', key: 'notes' },
              notes.map(([className, text], index) => h('div', { className, key: `note-${index}` }, text)),
            ),
          );
        }

        dialog = ReactDOM.createPortal(
          h(
            'div',
            {
              ref: panelRef,
              className: 'stu-panel',
              role: 'dialog',
              'aria-label': t('panel.title'),
              style: pos ?? MEASURE_STYLE,
            },
            body,
          ),
          document.body,
        );
      }

      return h(
        'div',
        { ref: rootRef, className: 'stu-root', 'data-step-usage': `${data.turn}:${data.step}` },
        h('div', { className: 'stu-strip' }, strip),
        dialog,
      );
    }

    // #endregion

    return {
      inject: ['slots', 'locale', 'uiConversation'],
      apply(ctx) {
        loadPreferences();
        ctx.effect(() => ctx.locale.register(NS, { zh, en }));
        ctx.effect(() => ctx.uiConversation.events.register(stepUsageDefinition));
        ctx.effect(() => ctx.uiConversation.events.register(turnCostDefinition));
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = 'dsh-step-token-usage/step-usage.css';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        });
        ctx.slots.inject('conversation.chat.node', () => {
          ctx.slots.register({ name: 'conversation.chat.node', key: KIND, locale: NS }, StepUsageView);
          ctx.slots.register({ name: 'conversation.chat.node', key: TURN_KIND, locale: NS }, TurnCostView);
        });

        // The composer dock is a list slot the shipped session pills already
        // occupy; ordering after them keeps the money chip to their right.
        ctx.slots.inject('conversation.composer.dock', () => {
          try {
            return ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'step-token-usage-cost', order: 1, locale: NS },
              SessionCostChip,
            );
          } catch {
            return () => {};
          }
        });

        // Settings → General rows, so every section the cost detail hides by
        // default can be turned back on. `order` places them after the built-in
        // rows (appearance 10, font-size 11, transcript 12, performance 13,
        // link-opening 14, composer-enter 20, shortcuts 20).
        PREFERENCE_KEYS.forEach((preference, index) => {
          ctx.slots.inject('settings.general.item', () =>
            ctx.slots.register(
              {
                name: 'settings.general.item',
                id: `step-token-usage-${preference}`,
                order: 30 + index,
                locale: NS,
              },
              (props) => h(PreferenceRow, { ...props, preference }),
            ),
          );
        });
      },
      /**
       * Verification seam.
       *
       * The money path is pure arithmetic over a price book, and a browser is
       * the worst place to assert it: the interesting inputs are tiers that sit
       * on a UTC boundary and holidays that only occur once a year. Exposing the
       * derivation lets `npm run verify` drive it headlessly against synthetic
       * books. Nothing in the shipped UI reads this object.
       */
      __internals: {
        priceStore,
        loadPriceBook,
        currencyOf,
        setCurrency,
        tierAt,
        costOfUsage,
        lookupModel,
        priceStep,
        priceSteps,
        recordTurn,
        turnIndex,
        deriveTurnCost,
        turnCostDefinition,
        TurnCostView,
        SessionCostChip,
        preferenceStore,
        setPreference,
        loadPreferences,
        unitPriceText,
        priceString,
        BUCKET_PRICE_FIELD,
        moneyText,
        decimalString,
        tierLabel,
        stampText,
        TURN_KIND,
        PRICING_URL,
        CURRENCY_KEY,
        PREFERENCES_KEY,
        PREFERENCE_DEFAULTS,
      },
    };
  },
});
