/* =============================================================================
   views/chargebacks.js — disputes with the bank.

   The view is split in two because the questions are different in kind:

     "How many came in, and what is our rate?"  — a FLOW, scoped to the period.
     "How much is still with the bank?"          — a SNAPSHOT, ignoring it.

   A dispute opened in July and still undecided is money at risk today. Scoping
   the status totals to the reported week would report it as though it had
   resolved itself, so they deliberately cover every dispute in the data set.
   The section headers say which is which, on the page, not just in this comment.
   ========================================================================== */

import * as M from '../metrics.js';
import { fmt, tile, statusChip, breakdownBars } from '../charts.js';

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

const STATUS_LABEL = {
  open: 'Open — response due',
  under_review: 'Under review by the bank',
  won: 'Won',
  lost: 'Lost',
  accepted: 'Accepted, not contested',
};

const STATUS_TONE = {
  open: 'warning',
  under_review: 'warning',
  won: 'good',
  lost: 'critical',
  accepted: 'critical',
};

export function renderChargebacks(mount, data, storeIds, period) {
  mount.textContent = '';

  const scopedStores = storeIds
    ? data.stores.filter((s) => storeIds.includes(s.store_id))
    : data.stores;

  const cmp = M.computeComparison(data, storeIds, period);
  const cur = cmp.current.chargebacks;
  const prev = cmp.previous.chargebacks;
  const prevHas = cmp.previous.hasData;
  const was = (v) => (prevHas ? v : null);

  const snap = M.chargebackSnapshot(data, storeIds);
  const target = data.meta.targets.chargeback_rate;

  /* =========================================================================
     Flow — what came in during the period
     ====================================================================== */

  const flow = section(
    'Opened in this period',
    `${fmt.dateFull(cmp.current.window.start)} – ${fmt.dateFull(cmp.current.window.end)}. `
    + 'The rate is disputes divided by orders — the ratio the card networks monitor.',
  );

  const flowTiles = el('div', 'grid tiles');

  const rateTile = tile({
    label: 'Chargeback rate',
    value: fmt.dec(cur.rate, 2),
    unit: '%',
    sub: `${fmt.int(cur.count)} disputes on ${fmt.int(cur.orders)} orders`,
    delta: M.delta(cur.rate, was(prev.rate), 'chargeback_rate'),
    formatPrevious: (v) => fmt.pct(v, 2),
    help: 'Count divided by orders. Card networks threshold on this ratio, not on value.',
  });
  if (target) {
    const status = M.goalStatus(cur.rate, target);
    const chip = statusChip(status, {
      good: 'Healthy', warning: 'Watch', critical: 'Above threshold', unknown: 'No data',
    }[status]);
    chip.style.marginTop = '6px';
    rateTile.appendChild(chip);
  }
  flowTiles.appendChild(rateTile);

  flowTiles.appendChild(tile({
    label: 'Value disputed',
    value: fmt.usd(cur.valueUsd),
    unit: 'USD',
    sub: cur.valueRate != null
      ? `${fmt.pct(cur.valueRate, 2)} of revenue in the same period`
      : 'No revenue recorded for this window',
    delta: M.delta(cur.valueUsd, was(prev.valueUsd), 'chargeback_value_usd'),
    formatPrevious: fmt.usd,
  }));

  flowTiles.appendChild(tile({
    label: 'Disputes opened',
    value: fmt.int(cur.count),
    unit: cur.count === 1 ? 'case' : 'cases',
    sub: cur.count
      ? `Top reason: ${fmt.label(cur.byReason[0].key)} (${fmt.int(cur.byReason[0].count)})`
      : 'None opened in this period',
    delta: M.delta(cur.count, was(prev.count), 'chargeback_count'),
  }));

  flow.appendChild(flowTiles);
  mount.appendChild(flow);

  // Threshold context is worth stating once, plainly, rather than leaving the
  // reader to guess whether 0.74% is fine.
  if (target) {
    const ctx = el('p', 'section-note');
    ctx.style.marginTop = '10px';
    ctx.textContent = `Target ${fmt.pct(target.goal, 1)} or below, watch from `
      + `${fmt.pct(target.warning, 1)}. Both thresholds live in data/meta.json — the second one `
      + 'is set where card-network monitoring programmes typically begin, so crossing it is a '
      + 'processor problem, not only a support one.';
    mount.appendChild(ctx);
  }

  /* =========================================================================
     Snapshot — where the money stands right now
     ====================================================================== */

  const stand = section(
    'Where it stands with the bank',
    `Every dispute on record for the stores in scope, not only this period — a case opened `
    + 'earlier and still undecided is money still at risk today.',
  );

  const standTiles = el('div', 'grid tiles');

  standTiles.appendChild(tile({
    label: 'Pending with the bank',
    value: fmt.usd(snap.pendingValue),
    unit: 'USD',
    sub: `${fmt.int(snap.pendingCount)} of ${fmt.int(snap.total)} cases still undecided`,
    help: 'Open plus under review. No decision has been made on this money either way.',
  }));

  standTiles.appendChild(tile({
    label: 'Won',
    value: fmt.usd(snap.wonValue),
    unit: 'USD',
    sub: `${fmt.int(snap.wonCount)} cases — funds retained`,
  }));

  standTiles.appendChild(tile({
    label: 'Lost',
    value: fmt.usd(snap.lostValue),
    unit: 'USD',
    sub: `${fmt.int(snap.lostCount)} cases`
      + (snap.acceptedCount
        ? `, of which ${fmt.int(snap.acceptedCount)} were not contested`
        : ''),
  }));

  standTiles.appendChild(tile({
    label: 'Win rate',
    value: fmt.dec(snap.winRate),
    unit: '%',
    sub: `${fmt.int(snap.wonCount)} won of ${fmt.int(snap.decidedCount)} decided`,
    help: 'Pending cases are excluded — counting them as losses would understate this.',
  }));

  standTiles.appendChild(tile({
    label: 'Dispute fees',
    value: fmt.usd(snap.feesUsd),
    unit: 'USD',
    sub: `Charged on all ${fmt.int(snap.total)} cases, including the ones won`,
    help: 'The processor keeps the per-case fee whatever the outcome, so it is totalled '
      + 'across every dispute rather than only the lost ones.',
  }));

  standTiles.appendChild(tile({
    label: 'Net cost so far',
    value: fmt.usd(snap.netCost),
    unit: 'USD',
    sub: `${fmt.usd(snap.lostValue)} lost + ${fmt.usd(snap.feesUsd)} in fees`,
    help: 'What the disputes have actually taken. Excludes the pending value, which is not '
      + 'yet decided either way.',
  }));

  stand.appendChild(standTiles);
  mount.appendChild(stand);

  /* =========================================================================
     Status and reason breakdowns
     ====================================================================== */

  const detail = section('Status and reasons', 'Counts and value together — neither alone tells you much.');

  const statusTable = table([
    { label: 'Status' },
    { label: 'Cases', numeric: true },
    { label: 'Value', numeric: true },
    { label: 'Share of cases', numeric: true },
  ]);

  const statusOrder = ['open', 'under_review', 'won', 'lost', 'accepted'];
  for (const key of statusOrder) {
    const row = snap.byStatus.find((s) => s.key === key);
    if (!row) continue;
    const tr = document.createElement('tr');
    cell(tr, statusChip(STATUS_TONE[key] || 'unknown', STATUS_LABEL[key] || fmt.label(key)));
    cell(tr, fmt.int(row.count), true);
    cell(tr, fmt.usd(row.total), true);
    cell(tr, fmt.pct(M.pct(row.count, snap.total)), true);
    statusTable.tbody.appendChild(tr);
  }
  const totalTr = document.createElement('tr');
  totalTr.className = 'total-row';
  cell(totalTr, 'Total');
  cell(totalTr, fmt.int(snap.total), true);
  cell(totalTr, fmt.usd(snap.totalValue), true);
  cell(totalTr, '100.0%', true);
  statusTable.tbody.appendChild(totalTr);

  detail.appendChild(statusTable.wrap);

  const reasonCard = card(el('h3', null, 'Disputed value by reason'));
  reasonCard.style.marginTop = '12px';
  detail.appendChild(reasonCard);
  mount.appendChild(detail);

  breakdownBars(reasonCard, snap.byReason, {
    color: 'var(--critical)',
    valueFormat: fmt.usd,
    valueLabel: 'Disputed',
    unitNoun: 'case',
    ariaLabel: 'Disputed value by reason',
  });

  /* =========================================================================
     Per store
     ====================================================================== */

  if (scopedStores.length > 1) {
    const perStore = section(
      'By store',
      'Rate is for the reported period; the outcome columns are the live snapshot.',
    );
    const t = table([
      { label: 'Store' },
      { label: 'Rate', numeric: true },
      { label: 'Opened', numeric: true },
      { label: 'Pending', numeric: true },
      { label: 'Won', numeric: true },
      { label: 'Lost', numeric: true },
      { label: 'Win rate', numeric: true },
      { label: 'Net cost', numeric: true },
      { label: 'Status' },
    ]);

    for (const store of scopedStores) {
      const one = M.computeComparison(data, [store.store_id], period).current.chargebacks;
      const s = M.chargebackSnapshot(data, [store.store_id]);
      const tr = document.createElement('tr');

      const nameCell = el('div', 'cell-store');
      const dot = el('span', 'store-swatch');
      dot.style.background = data.storeColor(store.store_id);
      nameCell.append(dot, el('span', null, store.name));
      cell(tr, nameCell);

      cell(tr, fmt.pct(one.rate, 2), true);
      cell(tr, `${fmt.int(one.count)} of ${fmt.int(one.orders)}`, true);
      cell(tr, `${fmt.int(s.pendingCount)} · ${fmt.usd(s.pendingValue)}`, true);
      cell(tr, `${fmt.int(s.wonCount)} · ${fmt.usd(s.wonValue)}`, true);
      cell(tr, `${fmt.int(s.lostCount)} · ${fmt.usd(s.lostValue)}`, true);
      cell(tr, fmt.pct(s.winRate), true);
      cell(tr, fmt.usd(s.netCost), true);
      const st = M.goalStatus(one.rate, target);
      cell(tr, statusChip(st, {
        good: 'Healthy', warning: 'Watch', critical: 'Above threshold', unknown: 'No data',
      }[st]));
      t.tbody.appendChild(tr);
    }

    // Counts and money sum across stores; the rate and the win rate are
    // recomputed over the pooled cases, never averaged.
    const totals = document.createElement('tr');
    totals.className = 'total-row';
    cell(totals, 'Total / weighted');
    cell(totals, fmt.pct(cur.rate, 2), true);
    cell(totals, `${fmt.int(cur.count)} of ${fmt.int(cur.orders)}`, true);
    cell(totals, `${fmt.int(snap.pendingCount)} · ${fmt.usd(snap.pendingValue)}`, true);
    cell(totals, `${fmt.int(snap.wonCount)} · ${fmt.usd(snap.wonValue)}`, true);
    cell(totals, `${fmt.int(snap.lostCount)} · ${fmt.usd(snap.lostValue)}`, true);
    cell(totals, fmt.pct(snap.winRate), true);
    cell(totals, fmt.usd(snap.netCost), true);
    cell(totals, '');
    t.tbody.appendChild(totals);

    perStore.appendChild(t.wrap);
    mount.appendChild(perStore);
  }

  /* =========================================================================
     The open cases themselves
     ====================================================================== */

  const pending = M.chargebacksPending(snap.rows)
    .slice()
    .sort((a, b) => (a.opened_at < b.opened_at ? -1 : 1));

  const openSection = section(
    'Open cases',
    `${pending.length} awaiting a decision, oldest first. These are the ones a response `
    + 'window still applies to.',
  );

  const openTable = table([
    { label: 'Opened' },
    { label: 'Age', numeric: true },
    { label: 'Case' },
    { label: 'Store' },
    { label: 'Order' },
    { label: 'Amount', numeric: true },
    { label: 'Reason' },
    { label: 'Network' },
    { label: 'Evidence sent' },
    { label: 'Status' },
  ]);

  if (!pending.length) {
    const tr = document.createElement('tr');
    const td = cell(tr, 'Nothing pending in this selection.');
    td.colSpan = 10;
    td.className = 'sub';
    openTable.tbody.appendChild(tr);
  }

  for (const c of pending) {
    const tr = document.createElement('tr');
    cell(tr, fmt.date(c.opened_at));
    const age = M.hoursBetween(c.opened_at, data.chargebackSnapshotAt);
    cell(tr, age != null ? `${Math.round(age / 24)} days` : '—', true);
    cell(tr, c.chargeback_id);

    const nameCell = el('div', 'cell-store');
    const dot = el('span', 'store-swatch');
    dot.style.background = data.storeColor(c.store_id);
    nameCell.append(dot, el('span', null, data.storeName(c.store_id)));
    cell(tr, nameCell);

    cell(tr, c.order_id);
    cell(tr, fmt.usdExact(c.amount_usd), true);
    cell(tr, fmt.label(c.reason));
    cell(tr, c.network);
    cell(tr, c.represented ? 'Yes' : 'Not yet');
    cell(tr, statusChip(STATUS_TONE[c.status] || 'unknown', STATUS_LABEL[c.status] || c.status));
    openTable.tbody.appendChild(tr);
  }

  openSection.appendChild(openTable.wrap);
  mount.appendChild(openSection);
}
