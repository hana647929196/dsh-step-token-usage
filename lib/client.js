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
     * Bucket rows of one usage sample, in the shipped dialog's field order.
     * A bucket the provider omitted is left out entirely rather than printed as
     * a zero; the footnote names it instead.
     *
     * @param keyPrefix - React key prefix, unique within the dialog.
     * @param buckets - normalized buckets.
     * @param t - translate seat.
     * @returns keyed `dt`/`dd` element pairs.
     */
    function bucketRows(keyPrefix, buckets, t) {
      const rows = [];
      const pair = (key, label, ...nodes) => {
        rows.push(h('dt', { key: `${keyPrefix}-dt-${key}` }, label));
        rows.push(h('dd', { key: `${keyPrefix}-dd-${key}` }, ...nodes));
      };
      pair('input', t('field.input'), tokenText(buckets.input, t));
      if (buckets.cacheRead !== null) pair('cacheRead', t('field.cacheRead'), tokenText(buckets.cacheRead, t));
      if (buckets.cacheWrite !== null) pair('cacheWrite', t('field.cacheWrite'), tokenText(buckets.cacheWrite, t));
      pair(
        'output',
        t('field.output'),
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
        stepRows.push(...bucketRows('step', data.buckets, t));
        body.push(h('dl', { className: 'stu-details', key: 'step' }, stepRows));

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
              rows.push(...bucketRows(key, attempt.usage, t));
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
              { className: 'stu-notes', key: 'notes' },
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
