/* =============================================================================
   views/sources.js — where the numbers come from, and what each one means.

   Mostly static reference content. The parts that CAN honestly respond to the
   store filter do: the source table narrows to the selected store, and the
   record counts are counted from the data actually loaded, so this tab never
   claims a row count the other two tabs would disagree with.
   ========================================================================== */

import * as M from '../metrics.js';
import { fmt } from '../charts.js';

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
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  t.appendChild(thead);
  const tbody = document.createElement('tbody');
  t.appendChild(tbody);
  wrap.appendChild(t);
  return { wrap, tbody };
}

function row(tbody, cells) {
  const tr = document.createElement('tr');
  for (const c of cells) {
    const td = document.createElement('td');
    if (c && c.numeric) td.className = 'n';
    const value = c && c.node ? c.node : c;
    if (value instanceof Node) td.appendChild(value);
    else if (c && c.text != null) td.textContent = c.text;
    else td.textContent = value == null ? '' : String(value);
    if (c && c.wrap) td.classList.add('wrap-cell');
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
  return tr;
}

/* -------------------------------------------------------------------------- */

const PIPELINE = [
  {
    title: 'Helpdesk conversations',
    detail: 'Richpanel for Lumvelle and Koda, Commslayer for Elevare. Conversations and their '
      + 'messages, with the timestamps every duration is derived from.',
  },
  {
    title: 'Shopify orders',
    detail: 'Revenue per store per week. This is the denominator of the refund rate and the '
      + 'only input that does not come from a helpdesk.',
  },
  {
    title: 'Refund and replacement log',
    detail: 'One row per refund and per replacement, recorded by the agent who handled it. '
      + 'Supplier cost and shipping are captured here, not in the helpdesk.',
  },
  {
    title: 'Normalise and compute',
    detail: 'Bucket timestamps into the reporting timezone, drop bot and auto-reply messages, '
      + 'and write the seven JSON files. No percentage is written — only raw counts and values.',
  },
  {
    title: 'Render',
    detail: 'The dashboard reads those files and computes every KPI in the browser. Swapping the '
      + 'file contents swaps the numbers; the pages do not change.',
  },
];

const KPI_DEFS = [
  ['Tickets answered', 'Conversations with at least one human agent reply in the period. Not tickets created.'],
  ['First response time (FRT)', 'Median hours from conversation creation to first human reply. Excludes auto-replies and bot messages. Median, never mean.'],
  ['Resolution time', 'Median hours from creation to final close. If a ticket was reopened, the last close counts.'],
  ['Answered under 24h', 'Tickets whose first human reply landed within 24 hours, divided by tickets answered.'],
  ['Backlog', 'Snapshot count of open plus pending conversations at the end of the period. Never a sum over days.'],
  ['Over 24h unanswered', 'Open more than 24 hours with still no human reply. A snapshot, like backlog.'],
  ['Reopen rate', 'Reopened divided by closed in the period.'],
  ['Refund rate', 'Total refunded USD divided by store revenue in the same period. Not refunds divided by tickets. Shown with the absolute USD beside it.'],
  ['Partial retention', 'Partial refunds divided by all refunds.'],
  ['Replacement cost', 'Sum of estimated cost: supplier cost plus shipping.'],
  ['Second replacement', 'Replacements flagged as a repeat on the same original order. A supplier-quality signal.'],
];

const REFUND_COLUMNS = [
  ['refund_id', 'Unique id for the row.'],
  ['store_id', 'lumvelle, elevare or koda. Never the helpdesk name.'],
  ['order_id', 'The Shopify order being refunded.'],
  ['ticket_id', 'Conversation that led to it, when there is one.'],
  ['refunded_at', 'ISO 8601 with offset. Decides which period the refund lands in.'],
  ['amount_usd', 'The amount actually refunded, as a number. Not the order value.'],
  ['refund_type', 'full or partial. Drives partial retention.'],
  ['reason', 'not_delivered, damaged_in_transit, wrong_item, quality_issue, late_delivery, changed_mind, sizing.'],
  ['agent_id', 'Who granted it.'],
];

const REPLACEMENT_COLUMNS = [
  ['replacement_id', 'Unique id for the row.'],
  ['store_id', 'lumvelle, elevare or koda.'],
  ['original_order_id', 'The order being replaced. Two rows sharing this value is what a second replacement means.'],
  ['replacement_order_id', 'The new shipment.'],
  ['created_at', 'ISO 8601 with offset.'],
  ['supplier_cost_usd', 'Cost of goods, as a number.'],
  ['shipping_cost_usd', 'Shipping, kept separate so the split stays inspectable.'],
  ['reason', 'not_delivered, damaged_in_transit, wrong_item, quality_issue, missing_part.'],
  ['is_second_replacement', 'true or false. A real boolean.'],
  ['agent_id', 'Who arranged it.'],
];

const OPTIONS = [
  {
    cls: '',
    title: 'A — Manual export, by hand',
    body: 'Export conversations from each helpdesk, paste into the refund and replacement '
      + 'spreadsheet, convert to the seven JSON files, commit. No infrastructure and no API '
      + 'access needed. Costs an hour or two a week and the numbers are only as fresh as the '
      + 'last export.',
    verdict: 'Fine for one or two reporting cycles. Does not scale.',
  },
  {
    cls: 'b',
    title: 'B — Scheduled job writes the JSON  (recommended)',
    body: 'A GitHub Action runs weekly, calls the Richpanel API, the Commslayer API and '
      + 'Shopify, computes the same raw counts and per-ticket arrays this contract defines, '
      + 'writes data/*.json and commits. The dashboard is unchanged — it just finds different '
      + 'numbers in the same files.',
    verdict: 'Keys stay in Actions secrets, never in the browser. The site stays fully static.',
  },
  {
    cls: 'c',
    title: 'C — Live API calls from the page',
    body: 'The browser calls both helpdesk APIs directly on load. Always current, no job to '
      + 'maintain — but it puts API tokens in client-side code where any viewer can read them, '
      + 'and it needs CORS support neither vendor promises.',
    verdict: 'Not recommended. The token exposure alone rules it out for a client-facing page.',
  },
];

/* =============================================================================
   Render
   ========================================================================== */

export function renderSources(mount, data, storeIds, period) {
  mount.textContent = '';

  const scopedStores = storeIds
    ? data.stores.filter((s) => storeIds.includes(s.store_id))
    : data.stores;

  /* --- how a number gets here --------------------------------------------- */

  const pipe = section('How a number gets here', 'Five steps, one direction.');
  const pipeCard = card();
  const steps = el('div', 'pipeline');
  PIPELINE.forEach((s, i) => {
    const step = el('div', 'pipeline-step');
    step.appendChild(el('span', 'step-n', `STEP ${i + 1}`));
    step.appendChild(el('strong', null, s.title));
    step.appendChild(el('span', 'd', s.detail));
    steps.appendChild(step);
  });
  pipeCard.appendChild(steps);
  pipe.appendChild(pipeCard);
  mount.appendChild(pipe);

  /* --- sources in scope ---------------------------------------------------- */

  const src = section(
    'Sources in this selection',
    'Row counts are counted from the data currently loaded, not stated from memory.',
  );
  const srcTable = table([
    { label: 'Store' },
    { label: 'Helpdesk' },
    { label: 'Conversations from' },
    { label: 'Revenue from' },
    { label: 'Daily rows', numeric: true },
    { label: 'Refund rows', numeric: true },
    { label: 'Replacement rows', numeric: true },
  ]);

  for (const store of scopedStores) {
    const id = store.store_id;
    const daily = data.ticketRows.filter((r) => r.store_id === id).length;
    const refunds = data.refunds.filter((r) => r.store_id === id).length;
    const reps = data.replacements.filter((r) => r.store_id === id).length;

    const nameCell = el('div', 'cell-store');
    const dot = el('span', 'store-swatch');
    dot.style.background = data.storeColor(id);
    nameCell.append(dot, el('span', null, store.name));

    const tag = el('span', 'helpdesk-tag', store.helpdesk);
    const api = store.helpdesk === 'richpanel'
      ? 'Richpanel REST API'
      : 'Commslayer integration token API';

    row(srcTable.tbody, [
      { node: nameCell },
      { node: tag },
      api,
      'Shopify, per store',
      { text: fmt.int(daily), numeric: true },
      { text: fmt.int(refunds), numeric: true },
      { text: fmt.int(reps), numeric: true },
    ]);
  }

  const totals = document.createElement('tr');
  totals.className = 'total-row';
  const ids = scopedStores.map((s) => s.store_id);
  const cells = [
    'Total',
    '',
    '',
    '',
    fmt.int(data.ticketRows.filter((r) => ids.includes(r.store_id)).length),
    fmt.int(data.refunds.filter((r) => ids.includes(r.store_id)).length),
    fmt.int(data.replacements.filter((r) => ids.includes(r.store_id)).length),
  ];
  cells.forEach((c, i) => {
    const td = document.createElement('td');
    if (i >= 4) td.className = 'n';
    td.textContent = c;
    totals.appendChild(td);
  });
  srcTable.tbody.appendChild(totals);

  src.appendChild(srcTable.wrap);

  const periodNote = el('p', 'section-note');
  periodNote.style.marginTop = '10px';
  const active = M.periods(data.meta, period).current;
  const isDefault = active.start === data.meta.period_start && active.end === data.meta.period_end;
  periodNote.textContent = `Reporting period ${fmt.dateFull(active.start)} – `
    + `${fmt.dateFull(active.end)}`
    + (isDefault ? '' : ` (custom range; meta.json ships ${fmt.date(data.meta.period_start)} – `
      + `${fmt.date(data.meta.period_end)})`)
    + `. Generated ${fmt.timestamp(data.meta.generated_at)} `
    + `in ${data.meta.reporting_timezone}. Timestamps are bucketed into that timezone before `
    + 'they become daily rows.';
  src.appendChild(periodNote);
  mount.appendChild(src);

  /* --- KPI definitions ----------------------------------------------------- */

  const defs = section(
    'What each number means',
    'The definitions the code implements, one pure function each in assets/metrics.js.',
  );
  const defTable = table([{ label: 'KPI' }, { label: 'Definition' }]);
  for (const [name, definition] of KPI_DEFS) {
    row(defTable.tbody, [name, { text: definition, wrap: true }]);
  }
  defs.appendChild(defTable.wrap);
  mount.appendChild(defs);

  /* --- aggregation rules ---------------------------------------------------- */

  const agg = section('How the stores add up', 'The rule that makes the total row honest.');
  const aggCard = card();

  // Worked from the live figures for the period and stores actually in scope —
  // never hardcoded, or this paragraph would quietly start lying the moment
  // anyone moved the period or the data changed.
  const scopedIds = scopedStores.map((s) => s.store_id);
  const perStore = scopedStores.map((s) => ({
    name: s.name,
    frt: M.computePeriod(data, [s.store_id], active).frtMedianHours,
    answered: M.computePeriod(data, [s.store_id], active).answered,
  })).filter((s) => s.frt != null);
  const pooled = M.computePeriod(data, scopedIds, active);
  const plainAverage = perStore.length
    ? perStore.reduce((a, s) => a + s.frt, 0) / perStore.length
    : null;

  const worked = perStore.length > 1
    ? `<p>Concretely, in this period the store medians are
       ${perStore.map((s) => `<code>${fmt.hours(s.frt)}</code> (${s.name},
       ${fmt.int(s.answered)} tickets)`).join(', ')}. Their plain average would be
       <code>${fmt.hours(plainAverage)}</code>. The figure the dashboard reports is
       <code>${fmt.hours(pooled.frtMedianHours)}</code>, because it is the median of all
       ${fmt.int(pooled.answered)} tickets rather than of ${perStore.length} numbers.</p>`
    : `<p>With one store selected there is nothing to weight — the figure shown is simply the
       median of its ${fmt.int(pooled.answered)} tickets. Select <em>All</em> to see the
       weighting take effect.</p>`;

  const prose = el('div', 'prose');
  prose.innerHTML = `
    <p><strong>Counts and money sum.</strong> Tickets answered, refunds granted, replacement
    cost — adding them across stores is correct.</p>
    <p><strong>Medians and percentages do not.</strong> They are recomputed over the pooled
    tickets of every store in scope, which weights them by volume. A busier store moves the
    total more than a quieter one. This is why the total row is labelled
    <em>Total / weighted</em> and why it is never the average of the cells above it.</p>
    ${worked}
    <p>The same applies to the refund rate: it is total refunded USD over total revenue, not the
    average of the store rates.</p>
  `;
  aggCard.appendChild(prose);
  agg.appendChild(aggCard);
  mount.appendChild(agg);

  /* --- spreadsheet columns -------------------------------------------------- */

  const cols = section(
    'Refund and replacement log columns',
    'The columns the team fills in. These map one-to-one onto data/refunds.json and '
    + 'data/replacements.json.',
  );
  const colGrid = el('div', 'grid cols-2');

  const refCard = card(el('h3', null, 'Refund log'));
  const refTable = table([{ label: 'Column' }, { label: 'Meaning' }]);
  for (const [name, meaning] of REFUND_COLUMNS) {
    const code = el('code', null, name);
    row(refTable.tbody, [{ node: code }, { text: meaning, wrap: true }]);
  }
  refCard.appendChild(refTable.wrap);
  colGrid.appendChild(refCard);

  const repCard = card(el('h3', null, 'Replacement log'));
  const repTable = table([{ label: 'Column' }, { label: 'Meaning' }]);
  for (const [name, meaning] of REPLACEMENT_COLUMNS) {
    const code = el('code', null, name);
    row(repTable.tbody, [{ node: code }, { text: meaning, wrap: true }]);
  }
  repCard.appendChild(repTable.wrap);
  colGrid.appendChild(repCard);

  cols.appendChild(colGrid);
  mount.appendChild(cols);

  /* --- feeding the data ----------------------------------------------------- */

  const opts = section(
    'Three ways to feed this dashboard',
    'All three produce the same seven files. Only the effort and the risk differ.',
  );
  const optGrid = el('div', 'grid');
  for (const o of OPTIONS) {
    const c = card();
    c.className = `card option-card ${o.cls}`;
    c.appendChild(el('h3', null, o.title));
    const p = el('p');
    p.style.cssText = 'color:var(--ink-2);margin:8px 0';
    p.textContent = o.body;
    c.appendChild(p);
    const v = el('div', 'sub');
    v.textContent = o.verdict;
    c.appendChild(v);
    optGrid.appendChild(c);
  }
  opts.appendChild(optGrid);
  mount.appendChild(opts);

  /* --- what is not real yet -------------------------------------------------- */

  const caveat = section('Status of this build');
  const caveatCard = card();
  const cp = el('div', 'prose');
  cp.innerHTML = `
    <p><strong>Every number on this dashboard is fake.</strong> It is plausible and internally
    consistent — the tiles equal the daily arrays, the store table sums to its total, and the
    refund count is the number of rows in the refund log — but it was generated, not measured.</p>
    <p>What is real is the shape. The seven files in <code>data/</code> follow the contract in
    <code>docs/DATA-CONTRACT.md</code> field for field. When the scheduled job replaces their
    contents with a genuine pull, this dashboard renders real numbers without a line of UI
    changing. What still needs confirming against the live accounts is listed in
    <code>docs/API-NOTES.md</code> — chiefly whether either helpdesk's message payload
    distinguishes a bot reply from a human one, which is what decides whether FRT can be
    trusted at all.</p>
  `;
  caveatCard.appendChild(cp);
  caveat.appendChild(caveatCard);
  mount.appendChild(caveat);
}
