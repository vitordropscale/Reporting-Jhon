/* =============================================================================
   metrics.js — all KPI math. Pure functions only.

   Nothing in this file touches the DOM, fetches anything, formats for display,
   or knows a colour. It takes the normalized object from data.js and returns
   numbers. That is the whole contract.

   Two rules run through everything here:

   1. Counts and money AGGREGATE BY SUM. Medians and percentages DO NOT.
      A percentage is recomputed from the pooled numerator and denominator; a
      median is recomputed from the pooled per-ticket values. Both are therefore
      weighted by volume by construction — which is what "weighted by tickets
      answered, never a plain average" asks for, arrived at exactly rather than
      by approximating a weighted median-of-medians.

   2. Direction, not sign, decides whether a change is good. Backlog falling is
      good; FRT rising is bad. Every metric declares its direction and delta()
      reads it. See DIRECTION below.
   ========================================================================== */

/* -----------------------------------------------------------------------------
   Which way is up, per metric. Consumed by delta() for change colouring and by
   goalStatus() for the goals table. meta.json carries the same field for the
   metrics that have targets; this map covers the ones that don't.
   -------------------------------------------------------------------------- */
export const DIRECTION = {
  tickets_answered: 'higher_is_better',
  frt_median_hours: 'lower_is_better',
  resolution_median_hours: 'lower_is_better',
  pct_answered_under_24h: 'higher_is_better',
  backlog: 'lower_is_better',
  over_24h_unanswered: 'lower_is_better',
  unassigned: 'lower_is_better',
  waiting_over_3_days: 'lower_is_better',
  reopen_rate: 'lower_is_better',
  refund_rate: 'lower_is_better',
  refund_total_usd: 'lower_is_better',
  partial_retention: 'higher_is_better',
  replacement_cost_usd: 'lower_is_better',
  second_replacements: 'lower_is_better',
  chargeback_rate: 'lower_is_better',
  chargeback_count: 'lower_is_better',
  chargeback_value_usd: 'lower_is_better',
  chargeback_win_rate: 'higher_is_better',
};

/* =============================================================================
   Primitives
   ========================================================================== */

export function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Median of a numeric array. Never a mean. Returns null for an empty pool. */
export function median(values) {
  if (!values || values.length === 0) return null;
  const s = Float64Array.from(values).sort();
  const n = s.length;
  const mid = n >> 1;
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Safe ratio as a percentage. Returns null when the denominator is 0 or absent. */
export function pct(numerator, denominator) {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

/**
 * The calendar day a timestamp belongs to.
 * Timestamps carry the reporting timezone's offset, and daily rows are bucketed
 * in that same timezone, so the local date is the leading 10 characters. Parsing
 * to a Date and reading getDate() would re-bucket into the *viewer's* timezone
 * and shift tickets across midnight.
 */
export function dayOf(timestamp) {
  return String(timestamp).slice(0, 10);
}

/** Inclusive ISO-date window test. */
export function inPeriod(isoDate, start, end) {
  return isoDate >= start && isoDate <= end;
}

/** Hours between two timestamps. Used for ticket age against a snapshot. */
export function hoursBetween(fromTs, toTs) {
  const from = Date.parse(fromTs);
  const to = Date.parse(toTs);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return (to - from) / 3600000;
}

/* -----------------------------------------------------------------------------
   Calendar arithmetic on ISO date strings.

   All of it goes through Date.UTC and reads back UTC fields. Using local-time
   Date methods here would shift a day for viewers west of Greenwich and move
   tickets between periods depending on who is looking.
   -------------------------------------------------------------------------- */

function toUTC(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

const DAY_MS = 86400000;

/** Shift an ISO date by a whole number of days. */
export function shiftDate(isoDate, days) {
  return new Date(toUTC(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive length of a window, in days. `a` to `a` is 1. */
export function windowLength(start, end) {
  return Math.round((toUTC(end) - toUTC(start)) / DAY_MS) + 1;
}

/** Number of days two inclusive date windows share. Zero when they miss. */
export function overlapDays(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(toUTC(aStart), toUTC(bStart));
  const end = Math.min(toUTC(aEnd), toUTC(bEnd));
  if (end < start) return 0;
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * The comparison window for an arbitrary period: the same number of days,
 * immediately before it. A 7-day week compares against the 7 days before it;
 * a 3-day range compares against the 3 days before it.
 */
export function derivePrevious(window) {
  const length = windowLength(window.start, window.end);
  return {
    start: shiftDate(window.start, -length),
    end: shiftDate(window.start, -1),
  };
}

/* =============================================================================
   Scoping — the store filter and the period windows
   ========================================================================== */

/** `storeIds === null` means "All". Otherwise keep only rows in the set. */
export function byStores(rows, storeIds) {
  if (!storeIds) return rows;
  const keep = new Set(storeIds);
  return rows.filter((r) => keep.has(r.store_id));
}

/** Daily rows inside a period. */
export function byPeriod(rows, start, end) {
  return rows.filter((r) => inPeriod(r.date, start, end));
}

/** Event rows (refunds, replacements) inside a period, bucketed by local day. */
export function byEventPeriod(rows, dateField, start, end) {
  return rows.filter((r) => inPeriod(dayOf(r[dateField]), start, end));
}

/**
 * The current and previous windows.
 *
 * With no override this is exactly what meta.json says — including its explicit
 * previous period, which the ingestion job may deliberately set to something
 * other than "the seven days before" (a like-for-like week last year, say).
 *
 * With an override — the user picking dates in the UI — the comparison window
 * is derived as the equal-length window immediately before, because meta.json's
 * stored previous period no longer relates to what is being asked for.
 */
export function periods(meta, override) {
  if (override && override.start && override.end) {
    return { current: { ...override }, previous: derivePrevious(override) };
  }
  return {
    current: { start: meta.period_start, end: meta.period_end },
    previous: { start: meta.previous_period_start, end: meta.previous_period_end },
  };
}

/**
 * Revenue for an arbitrary window — the denominator of the refund rate.
 *
 * revenue.json is weekly, so a window that is not exactly one of those weeks
 * has no row to match. Rather than reporting no refund rate at all, each
 * overlapping week contributes the share of its revenue that falls inside the
 * window, assuming revenue is spread evenly across the week's days.
 *
 * When the window IS exactly a stored week the share is 1 and the figure is
 * exact, so the default period is unaffected by this. Anything else is an
 * estimate, and `isExact` says which the caller is looking at.
 */
export function revenueForWindow(revenueRows, window) {
  let total = 0;
  let orders = 0;
  let exact = false;
  for (const row of revenueRows) {
    const shared = overlapDays(row.week_start, row.week_end, window.start, window.end);
    if (shared <= 0) continue;
    const weekDays = windowLength(row.week_start, row.week_end);
    if (shared === weekDays && windowLength(window.start, window.end) === weekDays) exact = true;
    const share = shared / weekDays;
    total += row.revenue_usd * share;
    orders += (row.orders || 0) * share;
  }
  return { total, orders, isExact: exact };
}

/** Pool every per-ticket value out of a set of daily rows. */
export function pool(rows, field) {
  const out = [];
  for (const r of rows) {
    const arr = r[field];
    if (arr) for (const v of arr) out.push(v);
  }
  return out;
}

/* =============================================================================
   KPIs — one pure function each, matching the definitions in DATA-CONTRACT.md
   ========================================================================== */

/** Conversations with >= 1 human agent reply in the period. Not tickets created. */
export function ticketsAnswered(dailyRows) {
  return sum(dailyRows.map((r) => r.answered));
}

export function ticketsCreated(dailyRows) {
  return sum(dailyRows.map((r) => r.created));
}

export function ticketsClosed(dailyRows) {
  return sum(dailyRows.map((r) => r.closed));
}

export function ticketsReopened(dailyRows) {
  return sum(dailyRows.map((r) => r.reopened));
}

/** Median hours from creation to first human reply. Median, never mean. */
export function frtMedianHours(dailyRows) {
  return median(pool(dailyRows, 'frt_hours'));
}

/** Median hours from creation to final close. Reopened tickets count their last close. */
export function resolutionMedianHours(dailyRows) {
  return median(pool(dailyRows, 'resolution_hours'));
}

/** Tickets whose first human reply landed within 24h. Returns the raw count. */
export function answeredUnder24hCount(dailyRows) {
  return pool(dailyRows, 'frt_hours').filter((h) => h <= 24).length;
}

/** …and the same as a percentage of tickets answered. */
export function pctAnsweredUnder24h(dailyRows) {
  return pct(answeredUnder24hCount(dailyRows), ticketsAnswered(dailyRows));
}

/** Snapshot of open + pending at the end of the period. Never a sum over days. */
export function backlog(queueStores) {
  return sum(queueStores.map((s) => s.backlog));
}

/** Open more than 24h with still no human reply. Snapshot. */
export function over24hUnanswered(queueStores) {
  return sum(queueStores.map((s) => s.over_24h_unanswered));
}

export function unassigned(queueStores) {
  return sum(queueStores.map((s) => s.unassigned));
}

/**
 * Waiting more than 3 days. This is the over_72h aging bucket — 3 days is 72h,
 * so it is read from the aging partition rather than stored twice. The tile and
 * the top segment of the aging chart are therefore the same number by design.
 */
export function waitingOver3Days(queueStores) {
  return sum(queueStores.map((s) => s.aging.over_72h));
}

export function answeredToday(queueStores) {
  return sum(queueStores.map((s) => s.answered_today));
}

/** Backlog split into its three age bands. Sums to backlog(). */
export function agingBands(queueStores) {
  return {
    under_24h: sum(queueStores.map((s) => s.aging.under_24h)),
    h24_to_72h: sum(queueStores.map((s) => s.aging.h24_to_72h)),
    over_72h: sum(queueStores.map((s) => s.aging.over_72h)),
  };
}

/** The single oldest open ticket in scope, with its age against the snapshot. */
export function oldestTicket(queueStores, snapshotAt) {
  let oldest = null;
  for (const s of queueStores) {
    const t = s.oldest_ticket;
    if (!t) continue;
    if (!oldest || t.created_at < oldest.created_at) {
      oldest = { ...t, store_id: s.store_id };
    }
  }
  if (!oldest) return null;
  return { ...oldest, age_hours: hoursBetween(oldest.created_at, snapshotAt) };
}

/** Reopened ÷ closed in the period, as a percentage. */
export function reopenRate(dailyRows) {
  return pct(ticketsReopened(dailyRows), ticketsClosed(dailyRows));
}

/* --- refunds ---------------------------------------------------------------- */

/** The count is the number of rows. There is no stored total. */
export function refundCount(refundRows) {
  return refundRows.length;
}

export function refundTotalUsd(refundRows) {
  return sum(refundRows.map((r) => r.amount_usd));
}

export function revenueUsd(revenueRows) {
  return sum(revenueRows.map((r) => r.revenue_usd));
}

/**
 * Total refunded USD ÷ store revenue in the same period. Money over money.
 * Not refunds ÷ tickets. Always displayed next to its absolute USD figure.
 *
 * Takes the revenue TOTAL rather than the rows, because for an arbitrary window
 * that total comes from revenueForWindow() and may be pro-rated across weeks.
 */
export function refundRate(refundRows, revenueTotalUsd) {
  return pct(refundTotalUsd(refundRows), revenueTotalUsd);
}

export function partialRefundCount(refundRows) {
  return refundRows.filter((r) => r.refund_type === 'partial').length;
}

/** Partial refunds ÷ all refunds — the share of cases where value was retained. */
export function partialRetention(refundRows) {
  return pct(partialRefundCount(refundRows), refundRows.length);
}

/** Refund rows grouped by reason, descending by amount. */
export function refundsByReason(refundRows) {
  return groupSum(refundRows, 'reason', 'amount_usd');
}

/** Refund rows grouped by store, descending by amount. */
export function refundsByStore(refundRows) {
  return groupSum(refundRows, 'store_id', 'amount_usd');
}

/* --- replacements ----------------------------------------------------------- */

export function replacementCount(replacementRows) {
  return replacementRows.length;
}

/** Sum of estimated cost: supplier cost + shipping. */
export function replacementCostUsd(replacementRows) {
  return sum(replacementRows.map((r) => r.supplier_cost_usd + r.shipping_cost_usd));
}

export function replacementSupplierUsd(replacementRows) {
  return sum(replacementRows.map((r) => r.supplier_cost_usd));
}

export function replacementShippingUsd(replacementRows) {
  return sum(replacementRows.map((r) => r.shipping_cost_usd));
}

/** Repeat replacements on the same original order — a supplier-quality signal. */
export function secondReplacementCount(replacementRows) {
  return replacementRows.filter((r) => r.is_second_replacement === true).length;
}

export function secondReplacementRate(replacementRows) {
  return pct(secondReplacementCount(replacementRows), replacementRows.length);
}

export function replacementsByReason(replacementRows) {
  return groupSum(
    replacementRows.map((r) => ({ ...r, _cost: r.supplier_cost_usd + r.shipping_cost_usd })),
    'reason',
    '_cost',
  );
}

export function replacementsByStore(replacementRows) {
  return groupSum(
    replacementRows.map((r) => ({ ...r, _cost: r.supplier_cost_usd + r.shipping_cost_usd })),
    'store_id',
    '_cost',
  );
}

/* --- chargebacks ------------------------------------------------------------
   Two different questions live here, and conflating them is the usual way a
   chargeback report ends up wrong:

   1. HOW MANY CAME IN during the period. A flow. Scoped by opened_at, and the
      only figure the rate is computed from.

   2. WHERE THEY STAND with the bank right now. A snapshot. A dispute opened in
      July and still undecided is pending today, whatever period is selected —
      so the status totals deliberately ignore the period, exactly like the
      queue in the daily view.

   The rate itself is COUNT ÷ ORDERS, not value ÷ revenue. That is the ratio the
   card networks monitor and threshold on, so it is the one that decides whether
   a store lands in a monitoring programme. The value-based ratio is reported
   beside it because it is what the money actually costs.
   -------------------------------------------------------------------------- */

/** Disputes opened inside a window. */
export function chargebacksOpenedIn(rows, window) {
  return byEventPeriod(rows, 'opened_at', window.start, window.end);
}

export const CHARGEBACK_PENDING = ['open', 'under_review'];

/** Still with the bank — no decision yet. A snapshot, never period-scoped. */
export function chargebacksPending(rows) {
  return rows.filter((c) => CHARGEBACK_PENDING.includes(c.status));
}

/** Decided one way or the other. `accepted` counts as decided: we chose to lose. */
export function chargebacksDecided(rows) {
  return rows.filter((c) => !CHARGEBACK_PENDING.includes(c.status));
}

export function chargebackValueUsd(rows) {
  return sum(rows.map((c) => c.amount_usd));
}

/**
 * Dispute fees. Charged per case by the processor and NOT refunded when the
 * dispute is won, which is why they are totalled across every row rather than
 * only the lost ones.
 */
export function chargebackFeesUsd(rows) {
  return sum(rows.map((c) => c.fee_usd || 0));
}

/** Count ÷ orders, as a percentage. The ratio card networks threshold on. */
export function chargebackRate(count, orders) {
  return pct(count, orders);
}

/** Won ÷ decided. Pending cases are excluded — they would understate it. */
export function chargebackWinRate(rows) {
  const decided = chargebacksDecided(rows);
  const won = decided.filter((c) => c.status === 'won');
  return pct(won.length, decided.length);
}

export function chargebacksByReason(rows) {
  return groupSum(rows, 'reason', 'amount_usd');
}

export function chargebacksByStatus(rows) {
  return groupSum(rows, 'status', 'amount_usd');
}

export function chargebacksByNetwork(rows) {
  return groupSum(rows, 'network', 'amount_usd');
}

/**
 * The full money picture for a set of disputes.
 *
 * `netCost` is what the disputes actually took: the value lost plus every fee,
 * including the fees on the ones that were won. A report that shows only the
 * lost amount understates the damage by the fee on every single case.
 */
export function chargebackOutcome(rows) {
  const pick = (status) => rows.filter((c) => c.status === status);
  const won = pick('won');
  const lost = pick('lost');
  const accepted = pick('accepted');
  const pending = chargebacksPending(rows);

  const lostValue = chargebackValueUsd(lost) + chargebackValueUsd(accepted);
  const fees = chargebackFeesUsd(rows);

  return {
    total: rows.length,
    totalValue: chargebackValueUsd(rows),
    pendingCount: pending.length,
    pendingValue: chargebackValueUsd(pending),
    wonCount: won.length,
    wonValue: chargebackValueUsd(won),
    lostCount: lost.length + accepted.length,
    lostValue,
    acceptedCount: accepted.length,
    decidedCount: won.length + lost.length + accepted.length,
    winRate: chargebackWinRate(rows),
    feesUsd: fees,
    netCost: lostValue + fees,
  };
}

/** Shared grouper: returns [{ key, count, total }] sorted by total descending. */
function groupSum(rows, keyField, valueField) {
  const acc = new Map();
  for (const r of rows) {
    const k = r[keyField];
    const cur = acc.get(k) || { key: k, count: 0, total: 0 };
    cur.count += 1;
    cur.total += r[valueField] || 0;
    acc.set(k, cur);
  }
  return [...acc.values()].sort((a, b) => b.total - a.total);
}

/* =============================================================================
   Period-over-period comparison
   ========================================================================== */

/**
 * Every KPI on the page is shown as: the value, the % change vs the previous
 * period, and the previous period's absolute value. This builds that triple.
 *
 * `isGood` follows the metric's direction, not the sign of the change — a
 * falling backlog is good and must render green.
 *
 * Returns pctChange === null when the previous value is 0 or missing; the UI
 * shows "no prior value" rather than a fake infinity.
 */
export function delta(current, previous, metricId) {
  const direction = DIRECTION[metricId] || 'higher_is_better';
  const hasBoth = current != null && previous != null;
  const absChange = hasBoth ? current - previous : null;
  const pctChange = hasBoth && previous !== 0 ? (absChange / Math.abs(previous)) * 100 : null;
  // A change under 0.05% is noise, not movement — render it neutral.
  const flat = absChange == null || (pctChange != null && Math.abs(pctChange) < 0.05);
  let isGood = null;
  if (!flat && absChange != null) {
    isGood = direction === 'lower_is_better' ? absChange < 0 : absChange > 0;
  }
  return { current, previous, absChange, pctChange, isGood, flat, direction, metricId };
}

/**
 * Goal status for the goals table.
 * `target` is a meta.json targets entry: { goal, warning, direction }.
 */
export function goalStatus(value, target) {
  if (value == null || !target) return 'unknown';
  const higher = target.direction === 'higher_is_better';
  if (higher) {
    if (value >= target.goal) return 'good';
    if (value >= target.warning) return 'warning';
    return 'critical';
  }
  if (value <= target.goal) return 'good';
  if (value <= target.warning) return 'warning';
  return 'critical';
}

/* =============================================================================
   Composite builders — everything a view needs for one scope, in one call
   ========================================================================== */

/**
 * All period KPIs for a store selection and a window.
 * `storeIds === null` means all stores. Every figure here is computed, never
 * read from a stored aggregate.
 */
export function computePeriod(data, storeIds, window) {
  const daily = byPeriod(byStores(data.ticketRows, storeIds), window.start, window.end);
  const refunds = byEventPeriod(
    byStores(data.refunds, storeIds), 'refunded_at', window.start, window.end,
  );
  const replacements = byEventPeriod(
    byStores(data.replacements, storeIds), 'created_at', window.start, window.end,
  );
  const revenue = revenueForWindow(byStores(data.revenue, storeIds), window);

  const answered = ticketsAnswered(daily);
  const under24 = answeredUnder24hCount(daily);

  return {
    window,
    /**
     * Whether the window contains any daily rows at all.
     *
     * "No data for this window" and "zero tickets in this window" are different
     * claims, and summing an empty set produces 0 for both. Callers use this to
     * avoid reporting a confident zero for a period the data set never covered.
     */
    hasData: daily.length > 0,
    answered,
    created: ticketsCreated(daily),
    closed: ticketsClosed(daily),
    reopened: ticketsReopened(daily),
    frtMedianHours: frtMedianHours(daily),
    resolutionMedianHours: resolutionMedianHours(daily),
    under24hCount: under24,
    pctUnder24h: pct(under24, answered),
    reopenRate: reopenRate(daily),
    refunds: {
      count: refundCount(refunds),
      totalUsd: refundTotalUsd(refunds),
      revenueUsd: revenue.total,
      /** false when revenue had to be pro-rated across partial weeks. */
      revenueIsExact: revenue.isExact,
      rate: refundRate(refunds, revenue.total),
      partialCount: partialRefundCount(refunds),
      partialRetention: partialRetention(refunds),
      byReason: refundsByReason(refunds),
      byStore: refundsByStore(refunds),
      rows: refunds,
    },
    replacements: {
      count: replacementCount(replacements),
      totalCostUsd: replacementCostUsd(replacements),
      supplierUsd: replacementSupplierUsd(replacements),
      shippingUsd: replacementShippingUsd(replacements),
      secondCount: secondReplacementCount(replacements),
      secondRate: secondReplacementRate(replacements),
      byReason: replacementsByReason(replacements),
      byStore: replacementsByStore(replacements),
      rows: replacements,
    },
    chargebacks: (() => {
      const opened = chargebacksOpenedIn(byStores(data.chargebacks, storeIds), window);
      return {
        count: opened.length,
        valueUsd: chargebackValueUsd(opened),
        orders: revenue.orders,
        /** Count ÷ orders — the ratio the card networks threshold on. */
        rate: chargebackRate(opened.length, revenue.orders),
        /** Value ÷ revenue — what it costs, reported beside the rate. */
        valueRate: pct(chargebackValueUsd(opened), revenue.total),
        byReason: chargebacksByReason(opened),
        rows: opened,
      };
    })(),
  };
}

/**
 * Where every dispute stands with the bank right now, for the stores in scope.
 *
 * Deliberately NOT period-scoped: a dispute opened before the reported week and
 * still undecided is money that is still at risk today. Scoping this to the
 * week would report it as though it had gone away.
 */
export function chargebackSnapshot(data, storeIds) {
  const rows = byStores(data.chargebacks, storeIds);
  return {
    ...chargebackOutcome(rows),
    byReason: chargebacksByReason(rows),
    byStatus: chargebacksByStatus(rows),
    byNetwork: chargebacksByNetwork(rows),
    oldestPending: chargebacksPending(rows)
      .slice()
      .sort((a, b) => (a.opened_at < b.opened_at ? -1 : 1))[0] || null,
    rows,
  };
}

/** The current period, the previous period, and a delta for every headline KPI. */
export function computeComparison(data, storeIds, override) {
  const p = periods(data.meta, override);
  const current = computePeriod(data, storeIds, p.current);
  const previous = computePeriod(data, storeIds, p.previous);

  // When the comparison window falls outside the data set entirely, every
  // "previous" figure would be a summed-from-nothing zero. Pass null instead so
  // the UI says "no prior period" rather than claiming a real zero and showing
  // a meaningless change against it.
  const was = (value) => (previous.hasData ? value : null);

  return {
    current,
    previous,
    deltas: {
      tickets_answered: delta(current.answered, was(previous.answered), 'tickets_answered'),
      frt_median_hours: delta(
        current.frtMedianHours, was(previous.frtMedianHours), 'frt_median_hours',
      ),
      resolution_median_hours: delta(
        current.resolutionMedianHours, was(previous.resolutionMedianHours),
        'resolution_median_hours',
      ),
      pct_answered_under_24h: delta(
        current.pctUnder24h, was(previous.pctUnder24h), 'pct_answered_under_24h',
      ),
      reopen_rate: delta(current.reopenRate, was(previous.reopenRate), 'reopen_rate'),
      refund_rate: delta(current.refunds.rate, was(previous.refunds.rate), 'refund_rate'),
      refund_total_usd: delta(
        current.refunds.totalUsd, was(previous.refunds.totalUsd), 'refund_total_usd',
      ),
      partial_retention: delta(
        current.refunds.partialRetention, was(previous.refunds.partialRetention),
        'partial_retention',
      ),
      replacement_cost_usd: delta(
        current.replacements.totalCostUsd, was(previous.replacements.totalCostUsd),
        'replacement_cost_usd',
      ),
      second_replacements: delta(
        current.replacements.secondCount, was(previous.replacements.secondCount),
        'second_replacements',
      ),
    },
  };
}

/**
 * The store comparison table: one row per store in scope, plus a total row.
 *
 * The total row is labelled "Total / weighted" because its counts are sums while
 * its medians and percentages are recomputed over the pooled tickets of every
 * store in scope — so a store answering 390 tickets moves the total more than
 * one answering 224, and the total is never the average of the three cells above it.
 */
export function storeTable(data, storeIds, override) {
  const p = periods(data.meta, override);
  const scoped = storeIds ? data.stores.filter((s) => storeIds.includes(s.store_id)) : data.stores;

  const rows = scoped.map((store) => {
    const cur = computePeriod(data, [store.store_id], p.current);
    const prev = computePeriod(data, [store.store_id], p.previous);
    return {
      store,
      answered: cur.answered,
      frtMedianHours: cur.frtMedianHours,
      resolutionMedianHours: cur.resolutionMedianHours,
      pctUnder24h: cur.pctUnder24h,
      reopenRate: cur.reopenRate,
      refundRate: cur.refunds.rate,
      refundTotalUsd: cur.refunds.totalUsd,
      deltas: {
        tickets_answered: delta(cur.answered, prev.answered, 'tickets_answered'),
        frt_median_hours: delta(cur.frtMedianHours, prev.frtMedianHours, 'frt_median_hours'),
      },
    };
  });

  const ids = scoped.map((s) => s.store_id);
  const total = computePeriod(data, ids, p.current);

  return {
    rows,
    total: {
      answered: total.answered,
      frtMedianHours: total.frtMedianHours,
      resolutionMedianHours: total.resolutionMedianHours,
      pctUnder24h: total.pctUnder24h,
      reopenRate: total.reopenRate,
      refundRate: total.refunds.rate,
      refundTotalUsd: total.refunds.totalUsd,
    },
  };
}

/**
 * Daily series for the charts: 14 days, one entry per day, each carrying a
 * per-store breakdown and that day's pooled median FRT per store.
 * Days are returned in calendar order with a flag marking the period boundary
 * so the chart can draw the divider between the two weeks.
 */
export function dailySeries(data, storeIds, override) {
  const active = periods(data.meta, override).current;
  const scoped = storeIds ? data.stores.filter((s) => storeIds.includes(s.store_id)) : data.stores;
  const ids = scoped.map((s) => s.store_id);
  const rows = byStores(data.ticketRows, storeIds);

  const days = [...new Set(rows.map((r) => r.date))].sort();
  return days.map((date) => {
    const onDay = rows.filter((r) => r.date === date);
    const perStore = {};
    for (const id of ids) {
      const r = onDay.find((x) => x.store_id === id);
      perStore[id] = {
        answered: r ? r.answered : 0,
        created: r ? r.created : 0,
        frtMedianHours: r ? median(r.frt_hours) : null,
      };
    }
    return {
      date,
      isCurrentPeriod: inPeriod(date, active.start, active.end),
      isPeriodStart: date === active.start,
      total: sum(Object.values(perStore).map((v) => v.answered)),
      perStore,
    };
  });
}

/** Queue snapshot tiles for the daily view. */
export function computeSnapshot(data, storeIds) {
  const stores = byStores(data.queue.stores, storeIds);
  return {
    snapshotAt: data.queue.snapshotAt,
    backlog: backlog(stores),
    over24hUnanswered: over24hUnanswered(stores),
    unassigned: unassigned(stores),
    waitingOver3Days: waitingOver3Days(stores),
    answeredToday: answeredToday(stores),
    aging: agingBands(stores),
    agingByStore: stores.map((s) => ({ store_id: s.store_id, ...s.aging, backlog: s.backlog })),
    oldest: oldestTicket(stores, data.queue.snapshotAt),
    stores,
  };
}

/** Critical queue rows in scope, oldest first, with age resolved. */
export function criticalQueue(data, storeIds) {
  return byStores(data.queue.critical, storeIds)
    .map((t) => ({
      ...t,
      age_hours: hoursBetween(t.created_at, data.queue.snapshotAt),
      answered: t.first_human_reply_at != null,
    }))
    .sort((a, b) => b.age_hours - a.age_hours);
}

/**
 * Per-agent table for the daily view.
 *
 * queue.json holds one row per agent per store, so filtering by store is a plain
 * filter. When more than one store is in scope the rows are merged per agent:
 * counts sum, and the FRT median is recomputed over the agent's pooled tickets
 * across those stores rather than averaged.
 *
 * Refunds granted are counted from refunds.json on the snapshot day — they are
 * not stored on the agent row, so this column and the refund tiles cannot drift.
 */
export function agentTable(data, storeIds) {
  const rows = byStores(data.queue.agents, storeIds);
  const snapshotDay = dayOf(data.queue.snapshotAt);
  const refundsToday = byStores(data.refunds, storeIds)
    .filter((r) => dayOf(r.refunded_at) === snapshotDay);

  const merged = new Map();
  for (const r of rows) {
    const cur = merged.get(r.agent_id) || {
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      store_ids: [],
      answered: 0,
      closed: 0,
      reopened: 0,
      frt: [],
    };
    cur.store_ids.push(r.store_id);
    cur.answered += r.answered;
    cur.closed += r.closed;
    cur.reopened += r.reopened;
    for (const v of r.frt_hours) cur.frt.push(v);
    merged.set(r.agent_id, cur);
  }

  return [...merged.values()]
    .map((a) => ({
      agent_id: a.agent_id,
      agent_name: a.agent_name,
      store_ids: a.store_ids,
      answered: a.answered,
      closed: a.closed,
      reopened: a.reopened,
      frtMedianHours: median(a.frt),
      over24h: a.frt.filter((h) => h > 24).length,
      reopenRate: pct(a.reopened, a.closed),
      refundsGranted: refundsToday.filter((r) => r.agent_id === a.agent_id).length,
    }))
    .sort((a, b) => b.answered - a.answered);
}

/**
 * The goals table: every target in meta.json resolved against the current value
 * in scope. Adding or removing a target in meta.json adds or removes a row here
 * with no code change.
 */
export function goalsTable(data, storeIds, override) {
  const p = periods(data.meta, override);
  const cur = computePeriod(data, storeIds, p.current);
  const snap = computeSnapshot(data, storeIds);

  const values = {
    frt_median_hours: cur.frtMedianHours,
    pct_answered_under_24h: cur.pctUnder24h,
    resolution_median_hours: cur.resolutionMedianHours,
    backlog: snap.backlog,
    over_24h_unanswered: snap.over24hUnanswered,
    reopen_rate: cur.reopenRate,
    refund_rate: cur.refunds.rate,
    // 0.9% is where Visa's monitoring programme starts; 0.5% is the level a
    // healthy account sits at. Both thresholds live in meta.json, not here.
    chargeback_rate: cur.chargebacks.rate,
  };

  return Object.entries(data.meta.targets)
    .filter(([id]) => id in values)
    .map(([id, target]) => ({
      id,
      label: target.label,
      unit: target.unit,
      value: values[id],
      goal: target.goal,
      warning: target.warning,
      direction: target.direction,
      status: goalStatus(values[id], target),
    }));
}
