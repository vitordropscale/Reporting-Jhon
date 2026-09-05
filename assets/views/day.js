/* =============================================================================
   views/day.js — the daily, internal view. What the team works the queue from.

   The weekly view reports on a closed period. This one reports on a MOMENT:
   queue.json is a snapshot taken at `snapshot_at`, and nothing in it may be
   summed across days. That difference is why these tiles mostly carry no
   period-over-period badge — see the note rendered above them.
   ========================================================================== */

import * as M from '../metrics.js';
import {
  fmt, tile, statusChip, legend, agingByStore, AGING_BANDS,
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

function cell(row, content, numeric, className) {
  const td = document.createElement('td');
  const classes = [numeric ? 'n' : '', className || ''].filter(Boolean).join(' ');
  if (classes) td.className = classes;
  if (content instanceof Node) td.appendChild(content);
  else td.textContent = content;
  row.appendChild(td);
  return td;
}

/** Reason keys on the critical queue map to a severity, not just a label. */
const REASON_STATUS = {
  no_reply_over_24h: 'critical',
  waiting_over_3_days: 'critical',
  escalated: 'warning',
  refund_requested: 'warning',
  reopened: 'warning',
};

/* =============================================================================
   Render
   ========================================================================== */

export function renderDay(mount, data, storeIds) {
  mount.textContent = '';

  const scopedStores = storeIds
    ? data.stores.filter((s) => storeIds.includes(s.store_id))
    : data.stores;

  const snap = M.computeSnapshot(data, storeIds);

  /* --- queue right now ---------------------------------------------------- */

  const queue = section(
    'Queue right now',
    `Snapshot taken ${fmt.timestamp(snap.snapshotAt)} `
    + `(${data.meta.reporting_timezone}). These are counts of what exists at that instant, `
    + 'never totals over the week.',
  );

  const tiles = el('div', 'grid tiles');

  tiles.appendChild(tile({
    label: 'In queue',
    value: fmt.int(snap.backlog),
    unit: 'tickets',
    sub: `${fmt.int(snap.aging.under_24h)} under 24h · `
      + `${fmt.int(snap.aging.h24_to_72h)} 24–72h · ${fmt.int(snap.aging.over_72h)} over 72h`,
    help: 'Open plus pending conversations at the snapshot instant.',
  }));

  const over24Pct = M.pct(snap.over24hUnanswered, snap.backlog);
  tiles.appendChild(tile({
    label: 'Over 24h, no reply',
    value: fmt.int(snap.over24hUnanswered),
    unit: 'tickets',
    sub: `${fmt.pct(over24Pct)} of the ${fmt.int(snap.backlog)} in queue`,
    help: 'Open more than 24 hours and still without a human reply.',
  }));

  const unassignedPct = M.pct(snap.unassigned, snap.backlog);
  tiles.appendChild(tile({
    label: 'Unassigned',
    value: fmt.int(snap.unassigned),
    unit: 'tickets',
    sub: `${fmt.pct(unassignedPct)} of the queue has no owner`,
  }));

  const wait3Pct = M.pct(snap.waitingOver3Days, snap.backlog);
  tiles.appendChild(tile({
    label: 'Waiting over 3 days',
    value: fmt.int(snap.waitingOver3Days),
    unit: 'tickets',
    sub: `${fmt.pct(wait3Pct)} of the queue — the over-72h band below`,
    help: 'Three days is 72 hours, so this tile and the darkest band of the aging '
      + 'chart are the same number by construction.',
  }));

  // "Answered today" DOES have an honest comparison: the same weekday a week
  // earlier, which is in tickets-weekly. Comparing it with a different weekday
  // would compare a Sunday with a Wednesday.
  const snapDay = M.dayOf(snap.snapshotAt);
  const sameWeekdayPrev = shiftDays(snapDay, -7);
  const todayRows = M.byStores(data.ticketRows, storeIds).filter((r) => r.date === snapDay);
  const prevRows = M.byStores(data.ticketRows, storeIds).filter((r) => r.date === sameWeekdayPrev);
  const answeredPrev = prevRows.length ? M.ticketsAnswered(prevRows) : null;

  tiles.appendChild(tile({
    label: 'Answered today',
    value: fmt.int(snap.answeredToday),
    unit: 'tickets',
    sub: `${fmt.weekday(snapDay)}, compared with the same weekday a week earlier`,
    delta: M.delta(snap.answeredToday, answeredPrev, 'tickets_answered'),
  }));

  const oldest = snap.oldest;
  tiles.appendChild(tile({
    label: 'Oldest open ticket',
    value: oldest ? fmt.age(oldest.age_hours) : '—',
    unit: oldest ? 'old' : '',
    sub: oldest
      ? `${data.storeName(oldest.store_id)} · ${oldest.ticket_id} · ${oldest.subject}`
      : 'Nothing open in this selection',
  }));

  queue.appendChild(tiles);
  mount.appendChild(queue);

  /* --- backlog aging ------------------------------------------------------ */

  const aging = section(
    'Backlog aging by store',
    'An ordered scale: the same hue deepening with age, not three unrelated colours. '
    + 'The three bands partition the backlog exactly.',
  );
  const agingCard = card();
  agingCard.appendChild(legend(AGING_BANDS.map((b) => ({ color: b.ramp, label: b.label }))));
  aging.appendChild(agingCard);
  mount.appendChild(aging);

  agingByStore(agingCard, snap.agingByStore, { storeName: (id) => data.storeName(id) });

  /* --- critical queue ----------------------------------------------------- */

  const critical = M.criticalQueue(data, storeIds);
  const critSection = section(
    'Critical queue',
    `${critical.length} ${critical.length === 1 ? 'ticket needs' : 'tickets need'} attention, `
    + 'oldest first. Age is measured against the snapshot instant.',
  );

  const critTable = table([
    { label: 'Age', numeric: true },
    { label: 'Ticket' },
    { label: 'Store' },
    { label: 'Subject' },
    { label: 'Customer' },
    { label: 'Order' },
    { label: 'Replied' },
    { label: 'Status' },
    { label: 'Owner' },
    { label: 'Why' },
  ]);

  if (!critical.length) {
    const tr = document.createElement('tr');
    const td = cell(tr, 'Nothing critical in this selection.');
    td.colSpan = 10;
    td.className = 'sub';
    critTable.tbody.appendChild(tr);
  }

  for (const t of critical) {
    const tr = document.createElement('tr');
    cell(tr, fmt.age(t.age_hours), true);
    cell(tr, t.ticket_id);
    cell(tr, storeCell(data, t.store_id));
    cell(tr, t.subject, false, 'wrap-cell');
    cell(tr, t.customer);
    cell(tr, t.order_id);
    cell(
      tr,
      t.answered ? fmt.timestamp(t.first_human_reply_at) : 'never',
      false,
      t.answered ? '' : 'sub',
    );
    cell(tr, fmt.label(t.status));
    cell(tr, t.assignee_id ? agentName(data, t.assignee_id) : 'unassigned', false,
      t.assignee_id ? '' : 'sub');
    cell(tr, statusChip(REASON_STATUS[t.reason] || 'unknown', fmt.label(t.reason)));
    critTable.tbody.appendChild(tr);
  }

  critSection.appendChild(critTable.wrap);
  mount.appendChild(critSection);

  /* --- agents ------------------------------------------------------------- */

  const agents = M.agentTable(data, storeIds);
  const agentSection = section(
    'Agents today',
    'One row per agent for the snapshot day. With more than one store in scope, an agent\'s '
    + 'median is recomputed over their pooled tickets, never averaged across stores.',
  );

  const agentTable = table([
    { label: 'Agent' },
    { label: 'Stores' },
    { label: 'Answered', numeric: true },
    { label: 'FRT median', numeric: true },
    { label: 'Over 24h', numeric: true },
    { label: 'Closed', numeric: true },
    { label: 'Reopen rate', numeric: true },
    { label: 'Refunds granted', numeric: true },
  ]);

  if (!agents.length) {
    const tr = document.createElement('tr');
    const td = cell(tr, 'No agent activity in this selection.');
    td.colSpan = 8;
    td.className = 'sub';
    agentTable.tbody.appendChild(tr);
  }

  for (const a of agents) {
    const tr = document.createElement('tr');
    cell(tr, a.agent_name);

    const storesCell = el('div', 'cell-store');
    for (const id of a.store_ids) {
      const dot = el('span', 'store-swatch');
      dot.style.background = data.storeColor(id);
      dot.title = data.storeName(id);
      storesCell.appendChild(dot);
    }
    storesCell.appendChild(el('span', 'sub', a.store_ids.map((id) => data.storeName(id)).join(', ')));
    cell(tr, storesCell);

    cell(tr, fmt.int(a.answered), true);
    cell(tr, fmt.hours(a.frtMedianHours), true);
    cell(tr, `${fmt.int(a.over24h)} of ${fmt.int(a.answered)}`, true);
    cell(tr, fmt.int(a.closed), true);
    cell(tr, `${fmt.pct(a.reopenRate)} (${fmt.int(a.reopened)} of ${fmt.int(a.closed)})`, true);
    cell(tr, fmt.int(a.refundsGranted), true);
    agentTable.tbody.appendChild(tr);
  }

  const totals = document.createElement('tr');
  totals.className = 'total-row';
  cell(totals, 'Total / weighted');
  cell(totals, '');
  cell(totals, fmt.int(snap.answeredToday), true);
  const pooled = M.median(
    M.byStores(data.queue.agents, storeIds).flatMap((r) => r.frt_hours),
  );
  cell(totals, fmt.hours(pooled), true);
  cell(totals, fmt.int(agents.reduce((s, a) => s + a.over24h, 0)), true);
  const closedTotal = agents.reduce((s, a) => s + a.closed, 0);
  const reopenedTotal = agents.reduce((s, a) => s + a.reopened, 0);
  cell(totals, fmt.int(closedTotal), true);
  cell(totals, `${fmt.pct(M.pct(reopenedTotal, closedTotal))} `
    + `(${fmt.int(reopenedTotal)} of ${fmt.int(closedTotal)})`, true);
  cell(totals, fmt.int(agents.reduce((s, a) => s + a.refundsGranted, 0)), true);
  agentTable.tbody.appendChild(totals);

  agentSection.appendChild(agentTable.wrap);
  mount.appendChild(agentSection);
}

/* -------------------------------------------------------------------------- */

/** Shift an ISO date by N days without going through local-timezone parsing. */
function shiftDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Resolve an agent id to a display name using the rows we already have. */
function agentName(data, agentId) {
  const row = data.queue.agents.find((a) => a.agent_id === agentId);
  return row ? row.agent_name : agentId;
}
