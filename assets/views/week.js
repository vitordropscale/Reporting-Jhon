/* =============================================================================
   views/week.js — the weekly, client-facing view.

   Receives the dataset from data.js and a store selection; computes nothing
   itself. Every number on this page comes from a metrics.js function, so the
   tiles, the table's total row and the charts cannot disagree — they are
   literally the same call with a different shape around it.
   ========================================================================== */

import * as M from '../metrics.js';
import {
  fmt, tile, statusChip, legend, stackedDailyVolume, frtLines, breakdownBars,
} from '../charts.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function section(title, note) {
  const wrap = el('section', 'section');
  const head = el('div', 'section-head');
  head.appendChild(el('h2', null, title));
  if (note) head.appendChild(el('span', 'section-note', note));
  wrap.appendChild(head);
  return wrap;
}

function card(...children) {
  const c = el('div', 'card');
  for (const child of children) if (child) c.appendChild(child);
  return c;
}

/** Store swatch + name, used in every table's first column. */
function storeCell(data, storeId) {
  const wrap = el('div', 'cell-store');
  const dot = el('span', 'store-swatch');
  dot.style.background = data.storeColor(storeId);
  wrap.appendChild(dot);
  wrap.appendChild(el('span', null, data.storeName(storeId)));
  return wrap;
}

function table(headers) {
  const wrap = el('div', 'table-wrap');
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h.label;
    if (h.numeric) th.className = 'n';
    if (h.help) th.title = h.help;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  t.appendChild(thead);
  const tbody = document.createElement('tbody');
  t.appendChild(tbody);
  wrap.appendChild(t);
  return { wrap, tbody };
}

function cell(row, content, numeric) {
  const td = document.createElement('td');
  if (numeric) td.className = 'n';
  if (content instanceof Node) td.appendChild(content);
  else td.textContent = content;
  row.appendChild(td);
  return td;
}

/* =============================================================================
   Render
   ========================================================================== */

export function renderWeek(mount, data, storeIds) {
  mount.textContent = '';

  const scopedStores = storeIds
    ? data.stores.filter((s) => storeIds.includes(s.store_id))
    : data.stores;
  const colorFor = (id) => data.storeColor(id);
  const storeName = (id) => data.storeName(id);

  const cmp = M.computeComparison(data, storeIds);
  const cur = cmp.current;
  const prev = cmp.previous;
  const d = cmp.deltas;

  /* --- KPI tile strip ----------------------------------------------------- */

  const kpis = section(
    'Headline',
    `${fmt.dateFull(data.meta.period_start)} – ${fmt.dateFull(data.meta.period_end)}, `
    + `compared with ${fmt.date(data.meta.previous_period_start)} – `
    + `${fmt.date(data.meta.previous_period_end)}`,
  );
  const strip = el('div', 'grid tiles');

  strip.appendChild(tile({
    label: 'Tickets answered',
    value: fmt.int(cur.answered),
    unit: 'tickets',
    sub: `${fmt.int(cur.created)} created in the same period`,
    delta: d.tickets_answered,
    help: 'Conversations with at least one human agent reply. Not tickets created.',
  }));

  strip.appendChild(tile({
    label: 'First response, median',
    value: fmt.dec(cur.frtMedianHours),
    unit: 'hours',
    sub: 'Median from creation to first human reply',
    delta: d.frt_median_hours,
    formatPrevious: fmt.hours,
    help: 'Median, never mean. Auto-replies and bot messages are excluded.',
  }));

  strip.appendChild(tile({
    label: 'Resolution, median',
    value: fmt.dec(cur.resolutionMedianHours),
    unit: 'hours',
    sub: `${fmt.int(cur.closed)} conversations closed`,
    delta: d.resolution_median_hours,
    formatPrevious: fmt.hours,
    help: 'Creation to final close. If a ticket was reopened, its last close counts.',
  }));

  strip.appendChild(tile({
    label: 'Answered under 24h',
    value: fmt.dec(cur.pctUnder24h),
    unit: '%',
    sub: `${fmt.int(cur.under24hCount)} of ${fmt.int(cur.answered)} tickets answered`,
    delta: d.pct_answered_under_24h,
    formatPrevious: (v) => fmt.pct(v),
  }));

  strip.appendChild(tile({
    label: 'Reopen rate',
    value: fmt.dec(cur.reopenRate),
    unit: '%',
    sub: `${fmt.int(cur.reopened)} reopened of ${fmt.int(cur.closed)} closed`,
    delta: d.reopen_rate,
    formatPrevious: (v) => fmt.pct(v),
  }));

  strip.appendChild(tile({
    label: 'Refund rate',
    value: fmt.dec(cur.refunds.rate, 2),
    unit: '%',
    sub: `${fmt.usd(cur.refunds.totalUsd)} refunded on ${fmt.usd(cur.refunds.revenueUsd)} revenue`,
    delta: d.refund_rate,
    formatPrevious: (v) => fmt.pct(v, 2),
    help: 'Refunded USD divided by store revenue for the same period — money over money.',
  }));

  kpis.appendChild(strip);
  mount.appendChild(kpis);

  /* --- daily volume ------------------------------------------------------- */

  const days = M.dailySeries(data, storeIds);

  const volume = section(
    'Daily volume by store',
    '14 days. The dashed line marks the start of the reported week.',
  );
  const volCard = card();
  if (scopedStores.length > 1) {
    volCard.appendChild(legend(scopedStores.map((s) => ({
      color: colorFor(s.store_id), label: s.name,
    }))));
  }
  volume.appendChild(volCard);
  mount.appendChild(volume);
  stackedDailyVolume(volCard, days, scopedStores, { colorFor, storeName });

  /* --- FRT trend ---------------------------------------------------------- */

  const frt = section(
    'First response time by store',
    'Median hours per day. One y-axis; a rising line is a slower day.',
  );
  const frtCard = card();
  if (scopedStores.length > 1) {
    frtCard.appendChild(legend(scopedStores.map((s) => ({
      color: colorFor(s.store_id), label: s.name,
    }))));
  }
  frt.appendChild(frtCard);
  mount.appendChild(frt);
  frtLines(frtCard, days, scopedStores, { colorFor, storeName });

  /* --- store comparison table --------------------------------------------- */

  const st = M.storeTable(data, storeIds);
  const cmpSection = section(
    'Store comparison',
    'Counts sum. Medians and percentages are recomputed over the pooled tickets, '
    + 'so the total is weighted by volume rather than averaged.',
  );
  const { wrap, tbody } = table([
    { label: 'Store' },
    { label: 'Helpdesk' },
    { label: 'Answered', numeric: true },
    { label: 'FRT median', numeric: true },
    { label: 'Resolution median', numeric: true },
    { label: 'Under 24h', numeric: true },
    { label: 'Reopen rate', numeric: true },
    { label: 'Refund rate', numeric: true },
    { label: 'Refunded', numeric: true },
  ]);

  for (const row of st.rows) {
    const tr = document.createElement('tr');
    cell(tr, storeCell(data, row.store.store_id));
    const tag = el('span', 'helpdesk-tag', row.store.helpdesk);
    cell(tr, tag);
    cell(tr, `${fmt.int(row.answered)}`, true);
    cell(tr, fmt.hours(row.frtMedianHours), true);
    cell(tr, fmt.hours(row.resolutionMedianHours), true);
    cell(tr, fmt.pct(row.pctUnder24h), true);
    cell(tr, fmt.pct(row.reopenRate), true);
    cell(tr, fmt.pct(row.refundRate, 2), true);
    cell(tr, fmt.usd(row.refundTotalUsd), true);
    tbody.appendChild(tr);
  }

  const totalRow = document.createElement('tr');
  totalRow.className = 'total-row';
  cell(totalRow, 'Total / weighted');
  cell(totalRow, '');
  cell(totalRow, fmt.int(st.total.answered), true);
  cell(totalRow, fmt.hours(st.total.frtMedianHours), true);
  cell(totalRow, fmt.hours(st.total.resolutionMedianHours), true);
  cell(totalRow, fmt.pct(st.total.pctUnder24h), true);
  cell(totalRow, fmt.pct(st.total.reopenRate), true);
  cell(totalRow, fmt.pct(st.total.refundRate, 2), true);
  cell(totalRow, fmt.usd(st.total.refundTotalUsd), true);
  tbody.appendChild(totalRow);

  cmpSection.appendChild(wrap);
  mount.appendChild(cmpSection);

  /* --- refunds ------------------------------------------------------------ */

  const refunds = section(
    'Refunds',
    'The refund count is the number of rows in the refund log — nothing is pre-totalled.',
  );
  const refTiles = el('div', 'grid tiles');

  refTiles.appendChild(tile({
    label: 'Refunds granted',
    value: fmt.int(cur.refunds.count),
    unit: cur.refunds.count === 1 ? 'refund' : 'refunds',
    sub: `${fmt.usdExact(cur.refunds.totalUsd)} refunded in total`,
    delta: M.delta(cur.refunds.count, prev.refunds.count, 'refund_total_usd'),
  }));

  refTiles.appendChild(tile({
    label: 'Value refunded',
    value: fmt.usd(cur.refunds.totalUsd),
    unit: 'USD',
    sub: `${fmt.pct(cur.refunds.rate, 2)} of ${fmt.usd(cur.refunds.revenueUsd)} revenue`,
    delta: d.refund_total_usd,
    formatPrevious: fmt.usd,
  }));

  refTiles.appendChild(tile({
    label: 'Partial retention',
    value: fmt.dec(cur.refunds.partialRetention),
    unit: '%',
    sub: `${fmt.int(cur.refunds.partialCount)} of ${fmt.int(cur.refunds.count)} were partial refunds`,
    delta: d.partial_retention,
    formatPrevious: (v) => fmt.pct(v),
    help: 'Share of refunds where only part of the order value was returned.',
  }));

  const avgRefund = cur.refunds.count ? cur.refunds.totalUsd / cur.refunds.count : null;
  const prevAvg = prev.refunds.count ? prev.refunds.totalUsd / prev.refunds.count : null;
  refTiles.appendChild(tile({
    label: 'Average refund',
    value: fmt.usd(avgRefund),
    unit: 'USD',
    sub: 'Across full and partial refunds',
    delta: M.delta(avgRefund, prevAvg, 'refund_total_usd'),
    formatPrevious: fmt.usd,
  }));

  refunds.appendChild(refTiles);

  const refCols = el('div', 'grid cols-2');
  refCols.style.marginTop = '12px';

  const reasonCard = card(el('h3', null, 'Refunded value by reason'));
  refCols.appendChild(reasonCard);

  const byStoreCard = card(el('h3', null, 'Refunded value by store'));
  refCols.appendChild(byStoreCard);

  refunds.appendChild(refCols);
  mount.appendChild(refunds);

  breakdownBars(reasonCard, cur.refunds.byReason, {
    color: 'var(--series-2)',
    valueFormat: fmt.usd,
    valueLabel: 'Refunded',
    unitNoun: 'refund',
    ariaLabel: 'Refunded value by reason',
  });

  const storeItems = scopedStores
    .map((s) => cur.refunds.byStore.find((x) => x.key === s.store_id)
      || { key: s.store_id, count: 0, total: 0 });
  const byStoreList = el('div');
  byStoreCard.appendChild(byStoreList);
  for (const item of storeItems) {
    const rowEl = el('div');
    rowEl.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px';
    const dot = el('span', 'store-swatch');
    dot.style.background = colorFor(item.key);
    const name = el('span', null, storeName(item.key));
    const bar = el('div');
    const maxV = Math.max(1, ...storeItems.map((x) => x.total));
    bar.style.cssText = `flex:1;height:10px;border-radius:3px;background:var(--surface-sunk);`
      + 'overflow:hidden';
    const fill = el('div');
    fill.style.cssText = `width:${(item.total / maxV) * 100}%;height:100%;`
      + `background:${colorFor(item.key)}`;
    bar.appendChild(fill);
    const val = el('span', 'num');
    val.style.cssText = 'min-width:150px;text-align:right;font-size:12px';
    val.textContent = `${fmt.usd(item.total)} · ${fmt.int(item.count)} `
      + `${item.count === 1 ? 'refund' : 'refunds'}`;
    rowEl.append(dot, name, bar, val);
    byStoreList.appendChild(rowEl);
  }

  /* --- replacements ------------------------------------------------------- */

  const reps = section(
    'Replacements',
    'Cost is supplier cost plus shipping. A second replacement means the replacement itself '
    + 'failed — a supplier signal, not a support one.',
  );
  const repTiles = el('div', 'grid tiles');

  repTiles.appendChild(tile({
    label: 'Replacements shipped',
    value: fmt.int(cur.replacements.count),
    unit: cur.replacements.count === 1 ? 'order' : 'orders',
    sub: `${fmt.usd(cur.replacements.totalCostUsd)} in total cost`,
    delta: M.delta(cur.replacements.count, prev.replacements.count, 'replacement_cost_usd'),
  }));

  repTiles.appendChild(tile({
    label: 'Replacement cost',
    value: fmt.usd(cur.replacements.totalCostUsd),
    unit: 'USD',
    sub: `${fmt.usd(cur.replacements.supplierUsd)} goods + `
      + `${fmt.usd(cur.replacements.shippingUsd)} shipping`,
    delta: d.replacement_cost_usd,
    formatPrevious: fmt.usd,
  }));

  repTiles.appendChild(tile({
    label: 'Second replacements',
    value: fmt.int(cur.replacements.secondCount),
    unit: cur.replacements.secondCount === 1 ? 'order' : 'orders',
    sub: `${fmt.pct(cur.replacements.secondRate)} of `
      + `${fmt.int(cur.replacements.count)} replacements were repeats`,
    delta: d.second_replacements,
    help: 'A repeat replacement on the same original order.',
  }));

  const avgRep = cur.replacements.count
    ? cur.replacements.totalCostUsd / cur.replacements.count : null;
  const prevAvgRep = prev.replacements.count
    ? prev.replacements.totalCostUsd / prev.replacements.count : null;
  repTiles.appendChild(tile({
    label: 'Average cost each',
    value: fmt.usd(avgRep),
    unit: 'USD',
    sub: 'Goods and shipping per replacement',
    delta: M.delta(avgRep, prevAvgRep, 'replacement_cost_usd'),
    formatPrevious: fmt.usd,
  }));

  reps.appendChild(repTiles);

  const repCard = card(el('h3', null, 'Replacement cost by reason'));
  repCard.style.marginTop = '12px';
  reps.appendChild(repCard);
  mount.appendChild(reps);

  breakdownBars(repCard, cur.replacements.byReason, {
    color: 'var(--series-3)',
    valueFormat: fmt.usd,
    valueLabel: 'Cost',
    unitNoun: 'replacement',
    ariaLabel: 'Replacement cost by reason',
  });

  /* --- goals -------------------------------------------------------------- */

  const goals = M.goalsTable(data, storeIds);
  const goalSection = section(
    'Goals',
    'Targets live in data/meta.json. Changing one changes this table without a code change.',
  );
  const goalTable = table([
    { label: 'Metric' },
    { label: 'Current', numeric: true },
    { label: 'Goal', numeric: true },
    { label: 'Warning past', numeric: true },
    { label: 'Status' },
  ]);

  const unitFormat = (unit, v) => {
    if (v == null) return '—';
    if (unit === 'hours') return fmt.hours(v);
    if (unit === 'percent') return fmt.pct(v, v < 10 ? 2 : 1);
    if (unit === 'usd') return fmt.usd(v);
    return fmt.int(v);
  };

  for (const g of goals) {
    const tr = document.createElement('tr');
    cell(tr, g.label);
    cell(tr, unitFormat(g.unit, g.value), true);
    cell(tr, `${g.direction === 'higher_is_better' ? '≥ ' : '≤ '}${unitFormat(g.unit, g.goal)}`, true);
    cell(tr, unitFormat(g.unit, g.warning), true);
    const statusText = { good: 'On target', warning: 'Watch', critical: 'Off target' }[g.status]
      || 'No data';
    cell(tr, statusChip(g.status, statusText));
    goalTable.tbody.appendChild(tr);
  }

  goalSection.appendChild(goalTable.wrap);
  mount.appendChild(goalSection);
}
