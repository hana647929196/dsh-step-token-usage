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
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'step-token-usage';
    /** Chat Node kind; also the renderer key and the Location-data key. */
    const KIND = 'step-usage';
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
      'pill.retried': '重试 {count} 次',
      'pill.expand': '展开逐次请求明细',
      'pill.collapse': '收起逐次请求明细',
      'panel.title': '逐次模型请求',
      'panel.step': '第 {turn} 轮 · 第 {step} 步',
      'panel.request': '请求 {index}',
      'panel.retry': '重试 {attempt}/{max}',
      'panel.retryNoMax': '重试 {attempt}',
      'panel.noUsageForRequest': '该次请求未上报用量',
      'field.model': '提供方 / 模型',
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
      'pill.retried': '{count} retries',
      'pill.expand': 'Show per-request detail',
      'pill.collapse': 'Hide per-request detail',
      'panel.title': 'Per-request detail',
      'panel.step': 'Turn {turn} · Step {step}',
      'panel.request': 'Request {index}',
      'panel.retry': 'Retry {attempt}/{max}',
      'panel.retryNoMax': 'Retry {attempt}',
      'panel.noUsageForRequest': 'Usage was not reported for this request',
      'field.model': 'Provider / model',
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
     * @param anchorSeq - sequence this row sorts at.
     * @param data - the step ledger.
     * @returns the final Chat view node.
     */
    function viewNode(context, anchorSeq, data) {
      return {
        key: context.key,
        kind: KIND,
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
        return viewNode(context, data.anchorSeq, data);
      },
    };

    // #endregion

    // #region styles

    const CSS = [
      '.stu-root{display:flex;flex-direction:column;gap:6px;min-width:0}',
      '.stu-strip{display:flex;align-items:center;gap:4px;min-width:0;flex-wrap:wrap;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:1.5;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums}',
      '.stu-toggle{display:inline-flex;align-items:center;gap:5px;min-width:0;padding:2px 7px;border:none;border-radius:var(--dsw-radius-sm,6px);background:0 0;color:inherit;font:inherit;font-variant-numeric:inherit;cursor:pointer}',
      '.stu-toggle:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}',
      '.stu-toggle svg{flex:none;width:14px;height:14px}',
      '.stu-toggle .stu-chevron{width:11px;height:11px}',
      '.stu-total{color:var(--dsw-alias-label-secondary)}',
      '.stu-dot{opacity:.45}',
      '.stu-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.stu-panel{display:flex;flex-direction:column;gap:9px;padding:10px 12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-bg-layer-1)}',
      '.stu-panelHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);font-weight:500}',
      '.stu-panelWhere{color:var(--dsw-alias-label-secondary);font-weight:400;font-variant-numeric:tabular-nums}',
      '.stu-hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2);margin:0}',
      '.stu-row{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.stu-rowHead{display:flex;align-items:baseline;gap:8px;min-width:0;color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px)}',
      '.stu-idx{flex:none;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.stu-route{min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}',
      '.stu-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:1px 14px;margin:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-secondary)}',
      '.stu-grid dt,.stu-grid dd{min-width:0;margin:0}',
      '.stu-grid dd{text-align:right;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.stu-grid .stu-note{color:var(--dsw-alias-label-secondary)}',
      '.stu-miss{color:var(--dsw-alias-state-warn-primary)}',
      '.stu-foot{color:var(--dsw-alias-state-warn-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.55}',
      '.stu-footNeutral{color:var(--dsw-alias-label-secondary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);line-height:1.55}',
    ].join('');

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

    /**
     * One row of the per-request ledger.
     * @param props - the attempt, its heading, and the translate seat.
     * @returns the row.
     */
    function AttemptRow({ attempt, t }) {
      const isRetry = attempt.kind === 'retry';
      const heading = isRetry
        ? attempt.maxRetries !== null && attempt.attempt !== null
          ? t('panel.retry', { attempt: attempt.attempt, max: attempt.maxRetries })
          : t('panel.retryNoMax', { attempt: attempt.attempt ?? '?' })
        : t('panel.request', { index: attempt.index });

      const route = attempt.route === null ? null : [attempt.route.provider, attempt.route.model].filter(Boolean).join(' / ');

      const children = [
        h(
          'div',
          { className: 'stu-rowHead', key: 'head' },
          h('span', { className: 'stu-idx' }, heading),
          route === null ? null : h('span', { className: 'stu-route' }, route),
          isRetry ? h('span', { className: 'stu-warn' }, attempt.failure && attempt.failure.code ? attempt.failure.code : '') : null,
        ),
      ];

      if (isRetry) {
        if (attempt.failure && attempt.failure.message !== null) {
          children.push(h('div', { className: 'stu-row', key: 'msg' }, h('span', { className: 'stu-route' }, attempt.failure.message)));
        }
        children.push(h('div', { className: 'stu-footNeutral', key: 'nobill' }, t('panel.noUsageForRequest')));
        return h('div', { className: 'stu-row' }, children);
      }

      const usage = attempt.usage;
      if (usage === null) {
        children.push(h('div', { className: 'stu-foot', key: 'nousage' }, t('panel.noUsageForRequest')));
        return h('div', { className: 'stu-row' }, children);
      }

      const cell = (value) => (value === null ? h('span', { className: 'stu-miss' }, t('value.missing')) : exact(value, t));

      children.push(
        h(
          'dl',
          { className: 'stu-grid', key: 'grid' },
          h('dt', { key: 'dt-in' }, t('field.input')),
          h('dd', { key: 'dd-in' }, cell(usage.input)),
          usage.cacheRead === null
            ? null
            : h('dt', { key: 'dt-cr' }, t('field.cacheRead')),
          usage.cacheRead === null ? null : h('dd', { key: 'dd-cr' }, cell(usage.cacheRead)),
          usage.cacheWrite === null
            ? null
            : h('dt', { key: 'dt-cw' }, t('field.cacheWrite')),
          usage.cacheWrite === null ? null : h('dd', { key: 'dd-cw' }, cell(usage.cacheWrite)),
          h('dt', { key: 'dt-out' }, t('field.output')),
          h(
            'dd',
            { key: 'dd-out' },
            cell(usage.output),
            usage.reasoning === null ? null : h('span', { className: 'stu-note' }, ' ', t('field.reasoning', { tokens: exact(usage.reasoning, t) })),
          ),
          h('dt', { key: 'dt-tot' }, t('field.total')),
          h('dd', { key: 'dd-tot' }, cell(usage.total)),
        ),
      );

      return h('div', { className: 'stu-row' }, children);
    }

    /**
     * Always-visible per-step usage pill with an inline per-request disclosure.
     * @param props - the Chat node and the locale seat.
     * @returns the row.
     */
    function StepUsageView({ node, t }) {
      const data = node.data;
      const [open, setOpen] = React.useState(false);
      const panelId = React.useId();

      const parts = [];
      if (data.buckets.input !== null) parts.push(t('pill.input', { count: compact(data.buckets.input, t) }));
      if (data.buckets.cacheRead !== null) parts.push(t('pill.cacheRead', { count: compact(data.buckets.cacheRead, t) }));
      if (data.buckets.output !== null) parts.push(t('pill.output', { count: compact(data.buckets.output, t) }));
      if (data.retryCount > 0) parts.push(t('pill.retried', { count: data.retryCount }));

      const label = data.hasUsage
        ? t('pill.usage', { total: compact(data.totalTokens, t) })
        : t('pill.noUsage');

      const strip = [];
      strip.push(
        h(
          'button',
          {
            key: 'toggle',
            type: 'button',
            className: 'stu-toggle',
            'aria-expanded': open,
            'aria-controls': panelId,
            title: open ? t('pill.collapse') : t('pill.expand'),
            onClick: () => setOpen((value) => !value),
          },
          h(DatabaseIcon, { key: 'icon' }),
          h('span', { className: data.hasUsage ? 'stu-total' : 'stu-warn', key: 'label' }, label),
          h(ChevronIcon, { open, key: 'chevron' }),
        ),
      );
      for (let index = 0; index < parts.length; index++) {
        strip.push(h('span', { className: 'stu-dot', key: `dot-${index}`, 'aria-hidden': true }, '·'));
        strip.push(h('span', { key: `part-${index}` }, parts[index]));
      }

      const panel = [];
      if (open) {
        panel.push(
          h(
            'div',
            { className: 'stu-panelHead', key: 'head' },
            h('span', null, t('panel.title')),
            h('span', { className: 'stu-panelWhere' }, t('panel.step', { turn: data.turn, step: data.step })),
          ),
          h('hr', { className: 'stu-hr', key: 'hr' }),
        );

        data.attempts.forEach((attempt, index) => {
          if (index > 0) panel.push(h('hr', { className: 'stu-hr', key: `hr-${index}` }));
          panel.push(h(AttemptRow, { key: `attempt-${index}`, attempt, t }));
        });

        if (data.cacheHitPercent !== null) {
          panel.push(
            h('hr', { className: 'stu-hr', key: 'hr-hit' }),
            h(
              'dl',
              { className: 'stu-grid', key: 'hit' },
              h('dt', null, t('field.cacheHit')),
              h('dd', null, `${data.cacheHitPercent}%`),
            ),
          );
        }

        if (!data.hasUsage) {
          panel.push(h('div', { className: 'stu-foot', key: 'nousage' }, t('note.noUsage')));
        } else {
          const fieldNames = (keys) => keys.map((key) => t(`field.${key}`)).join('、');
          if (data.missingCoreBuckets.length > 0) {
            panel.push(h('div', { className: 'stu-foot', key: 'partial' }, t('note.partial', { fields: fieldNames(data.missingCoreBuckets) })));
          }
          if (data.missingOptionalBuckets.length > 0) {
            panel.push(
              h('div', { className: 'stu-footNeutral', key: 'optional' }, t('note.partialOptional', { fields: fieldNames(data.missingOptionalBuckets) })),
            );
          }
          if (data.missingCoreBuckets.length === 0 && data.derivedTotal) {
            panel.push(h('div', { className: 'stu-footNeutral', key: 'derived' }, t('note.derivedTotal')));
          }
        }

        if (data.interrupted) panel.push(h('div', { className: 'stu-foot', key: 'interrupted' }, t('note.interrupted')));
      }

      return h(
        'div',
        { className: 'stu-root', 'data-step-usage': `${data.turn}:${data.step}` },
        h('div', { className: 'stu-strip' }, strip),
        open ? h('div', { className: 'stu-panel', id: panelId }, panel) : null,
      );
    }

    // #endregion

    return {
      inject: ['slots', 'locale', 'uiConversation'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }));
        ctx.effect(() => ctx.uiConversation.events.register(stepUsageDefinition));
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = 'dsh-step-token-usage/step-usage.css';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        });
        ctx.slots.inject('conversation.chat.node', () =>
          ctx.slots.register({ name: 'conversation.chat.node', key: KIND, locale: NS }, StepUsageView),
        );
      },
    };
  },
});
