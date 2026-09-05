/* =============================================================================
   charts.js — hand-written inline SVG chart builders, one shared tooltip, and
   the number formatters the whole UI uses.

   No chart library, by design: four chart types do not justify a dependency,
   and inline SVG keeps every mark inspectable and themeable through the same
   CSS custom properties as the rest of the page.

   House rules enforced here:
     - One y-axis per chart. Never a dual axis.
     - Grid and axes are recessive; the data is the only thing with weight.
     - Every mark has a tooltip, and every tooltip carries the unit:
       "283 tickets answered", never a bare "283".
     - A legend appears whenever two or more series are on screen.

   Charts are drawn at the mount element's measured pixel width rather than
   scaled through a viewBox, so axis labels are the same physical size in a
   full-width chart and a half-width one. app.js re-renders on resize.
   ========================================================================== */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* =============================================================================
   Formatters — every number the user sees passes through one of these
   ========================================================================== */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const fmt = {
  /** Whole number with thousands separators. */
  int(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  },

  /** One decimal place. */
  dec(n, places = 1) {
    if (n == null || Number.isNaN(n)) return '—';
    return n.toFixed(places);
  },

  /** Duration in hours: "3.7h". */
  hours(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${n.toFixed(1)}h`;
  },

  /** Duration spelled out, for tooltips: "3.7 hours". */
  hoursLong(n) {
    if (n == null || Number.isNaN(n)) return 'no data';
    return `${n.toFixed(1)} hours`;
  },

  /** Long ages read better in days once past two of them. */
  age(hoursValue) {
    if (hoursValue == null || Number.isNaN(hoursValue)) return '—';
    if (hoursValue < 48) return `${hoursValue.toFixed(0)}h`;
    return `${(hoursValue / 24).toFixed(1)} days`;
  },

  pct(n, places = 1) {
    if (n == null || Number.isNaN(n)) return '—';
    return `${n.toFixed(places)}%`;
  },

  /** Signed percentage for change indicators: "+8.3%". */
  signedPct(n, places = 1) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(places)}%`;
  },

  /** Rounded dollars: "$4,517". */
  usd(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `$${Math.round(n).toLocaleString('en-US')}`;
  },

  /** Dollars and cents: "$4,516.97". */
  usdExact(n) {
    if (n == null || Number.isNaN(n)) return '—';
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  /**
   * Date-only strings are formatted by slicing, never by `new Date(iso)` —
   * that parses "2026-08-24" as UTC midnight and can render the previous day
   * for a viewer west of Greenwich.
   */
  date(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  },

  dateFull(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  },

  /** Weekday for a date-only string, computed without a Date-parse round trip. */
  weekday(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  },

  /**
   * Timestamps are shown in the reporting timezone they were written in, by
   * slicing the string rather than parsing it — parsing would re-render the
   * instant in the viewer's own timezone and quietly move the snapshot time.
   */
  timestamp(iso) {
    if (!iso) return '—';
    return `${fmt.date(iso)}, ${iso.slice(11, 16)}`;
  },

  /** "not_delivered" -> "Not delivered". */
  label(key) {
    if (!key) return '—';
    const s = String(key).replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
};

/* =============================================================================
   Shared tooltip — one element for the whole page
   ========================================================================== */

let tooltipEl = null;

function tooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.setAttribute('role', 'status');
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(event, html) {
  const el = tooltip();
  el.innerHTML = html;
  el.dataset.show = 'true';
  moveTooltip(event);
}

function moveTooltip(event) {
  const el = tooltip();
  const pad = 14;
  const rect = el.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip() {
  const el = tooltip();
  el.dataset.show = 'false';
}

/** Attach tooltip behaviour to any mark. `html` may be a string or a factory. */
function bindTooltip(node, html) {
  const content = typeof html === 'function' ? html : () => html;
  node.addEventListener('mouseenter', (e) => showTooltip(e, content()));
  node.addEventListener('mousemove', moveTooltip);
  node.addEventListener('mouseleave', hideTooltip);
  // Keyboard parity: focusing a mark shows the same content.
  node.setAttribute('tabindex', '0');
  node.addEventListener('focus', (e) => {
    const r = node.getBoundingClientRect();
    showTooltip({ clientX: r.left + r.width / 2, clientY: r.top }, content());
  });
  node.addEventListener('blur', hideTooltip);
}

function tipRow(color, label, value) {
  const swatch = color
    ? `<span class="legend-swatch" style="background:${color}"></span>`
    : '';
  return `<div class="tooltip-row">${swatch}<span>${label}</span>`
    + `<span class="tooltip-val" style="margin-left:auto">${value}</span></div>`;
}

/* =============================================================================
   Small helpers
   ========================================================================== */

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

/**
 * The drawable width inside a mount: its client width minus its own horizontal
 * padding. clientWidth INCLUDES padding, so measuring it directly makes every
 * chart overflow its card by exactly the padding.
 *
 * Returns 0 when the element has not been laid out yet — the caller renders a
 * placeholder instead of drawing a chart at a nonsense width, and app.js
 * re-renders once a real width exists.
 */
function measure(mount) {
  const cs = getComputedStyle(mount);
  const pad = parseFloat(cs.paddingLeft || 0) + parseFloat(cs.paddingRight || 0);
  const w = mount.clientWidth - pad;
  return w > 40 ? Math.floor(w) : 0;
}

/**
 * Charts drawn before layout would be permanently wrong, so they refuse to
 * draw and leave a sized placeholder. app.js observes the container and
 * re-renders as soon as it has a width.
 */
function placeholder(mount, height) {
  const box = document.createElement('div');
  box.style.height = `${height}px`;
  box.dataset.chartPending = 'true';
  mount.appendChild(box);
  return box;
}

/** Axis ticks at 1/2/5 × 10ⁿ, so labels land on numbers a human would pick. */
function niceTicks(max, target = 5) {
  if (!max || max <= 0) return { ticks: [0, 1], max: 1 };
  const rough = max / target;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step = mag;
  if (norm > 5) step = 10 * mag;
  else if (norm > 2) step = 5 * mag;
  else if (norm > 1) step = 2 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return { ticks, max: top };
}

/* =============================================================================
   Shared UI primitives — the KPI tile and the change badge.

   These live next to the formatters and the legend because all three are the
   presentation vocabulary the three views share. Keeping them here is what lets
   week.js and day.js render identical-looking tiles without importing each
   other or growing a fourth module.
   ========================================================================== */

/**
 * The change badge: an arrow for the DIRECTION OF MOVEMENT, a colour for
 * whether that movement is GOOD. They disagree often and on purpose — backlog
 * falling shows a down arrow in green, FRT rising shows an up arrow in red.
 *
 * @param d a delta() result from metrics.js
 * @param formatValue how to render the previous absolute value
 */
export function changeBadge(d, formatValue = fmt.int) {
  const wrap = document.createElement('span');
  wrap.className = 'tile-foot';

  const badge = document.createElement('span');
  if (d.pctChange == null) {
    badge.className = 'change is-flat';
    badge.textContent = d.previous == null ? 'no prior period' : 'no prior value';
  } else {
    const rising = d.absChange > 0;
    let tone = 'is-flat';
    if (!d.flat && d.isGood === true) tone = 'is-good';
    else if (!d.flat && d.isGood === false) tone = 'is-bad';
    badge.className = `change ${tone}`;
    const arrow = d.flat ? '→' : (rising ? '↑' : '↓');
    badge.textContent = `${arrow} ${fmt.signedPct(d.pctChange)}`;
  }
  wrap.appendChild(badge);

  // A percentage is never shown without the absolute number it represents.
  if (d.previous != null) {
    const prev = document.createElement('span');
    prev.textContent = `vs ${formatValue(d.previous)} previous period`;
    wrap.appendChild(prev);
  }
  return wrap;
}

/**
 * A KPI tile: label, value with its unit, an optional sub-line carrying the
 * absolute numbers behind a percentage, and the change badge.
 *
 * @param spec { label, value, unit, sub, delta, formatPrevious, help }
 */
export function tile(spec) {
  const card = document.createElement('div');
  card.className = 'card tile';

  const label = document.createElement('div');
  label.className = 'tile-label';
  label.textContent = spec.label;
  if (spec.help) label.title = spec.help;
  card.appendChild(label);

  const value = document.createElement('div');
  value.className = 'tile-value';
  value.textContent = spec.value;
  if (spec.unit) {
    const unit = document.createElement('span');
    unit.className = 'tile-unit';
    unit.textContent = spec.unit;
    value.appendChild(unit);
  }
  card.appendChild(value);

  if (spec.sub) {
    const sub = document.createElement('div');
    sub.className = 'tile-sub';
    sub.textContent = spec.sub;
    card.appendChild(sub);
  }

  if (spec.delta) card.appendChild(changeBadge(spec.delta, spec.formatPrevious || fmt.int));
  return card;
}

/** A good / warning / critical chip. Always a dot AND a word, never colour alone. */
export function statusChip(status, text) {
  const el = document.createElement('span');
  el.className = `status ${status}`;
  el.innerHTML = '<span class="status-dot"></span>';
  const label = document.createElement('span');
  label.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);
  el.appendChild(label);
  return el;
}

/** Legend markup. Rendered whenever two or more series are on screen. */
export function legend(items) {
  const el = document.createElement('div');
  el.className = 'legend';
  for (const it of items) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-swatch" style="background:${it.color}"></span>`
      + `<span>${it.label}</span>`;
    el.appendChild(item);
  }
  return el;
}

/* =============================================================================
   Chart 1 — stacked daily volume by store, 14 days
   ========================================================================== */

/**
 * @param mount   mounted element to draw into
 * @param days    output of metrics.dailySeries()
 * @param stores  store records in scope
 * @param opts    { colorFor, storeName, periodStart }
 */
export function stackedDailyVolume(mount, days, stores, opts) {
  const width = measure(mount);
  if (!width) return placeholder(mount, 260);
  const height = 260;
  const m = { top: 12, right: 12, bottom: 34, left: 46 };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;

  const maxTotal = Math.max(1, ...days.map((d) => d.total));
  const scale = niceTicks(maxTotal);
  const y = (v) => m.top + plotH - (v / scale.max) * plotH;

  const slot = plotW / days.length;
  const barW = Math.min(34, slot * 0.66);

  const root = svg('svg', {
    class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': `Tickets answered per day by store, ${days.length} days`,
  });

  // gridlines + y ticks
  for (const t of scale.ticks) {
    root.appendChild(svg('line', {
      class: 'gridline', x1: m.left, x2: m.left + plotW, y1: y(t), y2: y(t),
    }));
    const label = svg('text', { class: 'tick', x: m.left - 8, y: y(t) + 3, 'text-anchor': 'end' });
    label.textContent = fmt.int(t);
    root.appendChild(label);
  }

  const axisTitle = svg('text', {
    class: 'axis-title', x: m.left, y: m.top - 2, 'text-anchor': 'start',
  });
  axisTitle.textContent = 'TICKETS ANSWERED';
  root.appendChild(axisTitle);

  // the dashed divider between the previous week and the reported week
  const boundary = days.findIndex((d) => d.isPeriodStart);
  if (boundary > 0) {
    const x = m.left + boundary * slot;
    root.appendChild(svg('line', {
      class: 'divider', x1: x, x2: x, y1: m.top, y2: m.top + plotH,
    }));
    const tag = svg('text', { class: 'tick', x: x + 5, y: m.top + 9, 'text-anchor': 'start' });
    tag.textContent = 'reported week';
    root.appendChild(tag);
  }

  // stacked bars
  days.forEach((day, i) => {
    const cx = m.left + i * slot + slot / 2;
    let acc = 0;
    for (const store of stores) {
      const v = day.perStore[store.store_id] ? day.perStore[store.store_id].answered : 0;
      if (!v) continue;
      const yTop = y(acc + v);
      const yBottom = y(acc);
      const rect = svg('rect', {
        class: 'mark',
        x: cx - barW / 2,
        y: yTop,
        width: barW,
        height: Math.max(1, yBottom - yTop),
        fill: opts.colorFor(store.store_id),
        rx: 1,
      });
      bindTooltip(rect, () => `<div class="tooltip-title">${opts.storeName(store.store_id)}</div>`
        + `<div class="sub">${fmt.weekday(day.date)}, ${fmt.date(day.date)}</div>`
        + tipRow(opts.colorFor(store.store_id), 'Answered', `${fmt.int(v)} tickets`)
        + tipRow(null, 'All stores that day', `${fmt.int(day.total)} tickets`));
      root.appendChild(rect);
      acc += v;
    }

    // x labels: weekday initial, with the date every other day to avoid crowding
    const xl = svg('text', {
      class: 'tick', x: cx, y: height - 14, 'text-anchor': 'middle',
    });
    xl.textContent = fmt.weekday(day.date).slice(0, 1);
    root.appendChild(xl);
    if (i % 2 === 0) {
      const xd = svg('text', { class: 'tick', x: cx, y: height - 3, 'text-anchor': 'middle' });
      xd.textContent = fmt.date(day.date);
      root.appendChild(xd);
    }
  });

  root.appendChild(svg('line', {
    class: 'axisline', x1: m.left, x2: m.left + plotW, y1: m.top + plotH, y2: m.top + plotH,
  }));

  mount.appendChild(root);
  return root;
}

/* =============================================================================
   Chart 2 — median FRT by store, one line per store
   ========================================================================== */

export function frtLines(mount, days, stores, opts) {
  const width = measure(mount);
  if (!width) return placeholder(mount, 260);
  const height = 260;
  const m = { top: 12, right: 12, bottom: 34, left: 46 };
  const plotW = Math.max(10, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;

  let maxV = 0;
  for (const d of days) {
    for (const s of stores) {
      const v = d.perStore[s.store_id] && d.perStore[s.store_id].frtMedianHours;
      if (v != null && v > maxV) maxV = v;
    }
  }
  const scale = niceTicks(Math.max(maxV, 1));
  const y = (v) => m.top + plotH - (v / scale.max) * plotH;
  const slot = plotW / days.length;
  const x = (i) => m.left + i * slot + slot / 2;

  const root = svg('svg', {
    class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': 'Median first response time per day by store, in hours',
  });

  for (const t of scale.ticks) {
    root.appendChild(svg('line', {
      class: 'gridline', x1: m.left, x2: m.left + plotW, y1: y(t), y2: y(t),
    }));
    const label = svg('text', { class: 'tick', x: m.left - 8, y: y(t) + 3, 'text-anchor': 'end' });
    label.textContent = `${t}h`;
    root.appendChild(label);
  }

  const axisTitle = svg('text', {
    class: 'axis-title', x: m.left, y: m.top - 2, 'text-anchor': 'start',
  });
  axisTitle.textContent = 'HOURS TO FIRST HUMAN REPLY (MEDIAN)';
  root.appendChild(axisTitle);

  const boundary = days.findIndex((d) => d.isPeriodStart);
  if (boundary > 0) {
    const bx = m.left + boundary * slot;
    root.appendChild(svg('line', {
      class: 'divider', x1: bx, x2: bx, y1: m.top, y2: m.top + plotH,
    }));
  }

  for (const store of stores) {
    const colour = opts.colorFor(store.store_id);
    const pts = [];
    days.forEach((d, i) => {
      const v = d.perStore[store.store_id] && d.perStore[store.store_id].frtMedianHours;
      if (v != null) pts.push({ i, v });
    });
    if (pts.length > 1) {
      const path = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`).join(' ');
      root.appendChild(svg('path', { class: 'series-line', d: path, stroke: colour }));
    }
    for (const p of pts) {
      const dot = svg('circle', {
        class: 'mark dot', cx: x(p.i), cy: y(p.v), r: 3.5, fill: colour,
      });
      const day = days[p.i];
      bindTooltip(dot, () => `<div class="tooltip-title">${opts.storeName(store.store_id)}</div>`
        + `<div class="sub">${fmt.weekday(day.date)}, ${fmt.date(day.date)}</div>`
        + tipRow(colour, 'First response (median)', fmt.hoursLong(p.v))
        + tipRow(null, 'Answered that day', `${fmt.int(day.perStore[store.store_id].answered)} tickets`));
      root.appendChild(dot);
    }
  }

  days.forEach((day, i) => {
    if (i % 2 !== 0) return;
    const xd = svg('text', { class: 'tick', x: x(i), y: height - 8, 'text-anchor': 'middle' });
    xd.textContent = fmt.date(day.date);
    root.appendChild(xd);
  });

  root.appendChild(svg('line', {
    class: 'axisline', x1: m.left, x2: m.left + plotW, y1: m.top + plotH, y2: m.top + plotH,
  }));

  mount.appendChild(root);
  return root;
}

/* =============================================================================
   Chart 3 — backlog aging by store (ordinal ramp, not a categorical palette)
   ========================================================================== */

const AGING_BANDS = [
  { key: 'under_24h', label: 'Under 24h', ramp: 'var(--ramp-1)' },
  { key: 'h24_to_72h', label: '24 to 72h', ramp: 'var(--ramp-2)' },
  { key: 'over_72h', label: 'Over 72h', ramp: 'var(--ramp-3)' },
];

export { AGING_BANDS };

export function agingByStore(mount, rows, opts) {
  const width = measure(mount);
  if (!width) return placeholder(mount, 40 + rows.length * 42);
  const rowH = 42;
  const m = { top: 26, right: 12, bottom: 26, left: 92 };
  const height = m.top + rows.length * rowH + m.bottom;
  const plotW = Math.max(10, width - m.left - m.right);

  const maxTotal = Math.max(1, ...rows.map((r) => r.backlog));
  const scale = niceTicks(maxTotal, 4);
  const x = (v) => m.left + (v / scale.max) * plotW;

  const root = svg('svg', {
    class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': 'Open tickets by age band and store',
  });

  for (const t of scale.ticks) {
    root.appendChild(svg('line', {
      class: 'gridline', x1: x(t), x2: x(t), y1: m.top, y2: m.top + rows.length * rowH,
    }));
    const label = svg('text', {
      class: 'tick', x: x(t), y: height - 10, 'text-anchor': 'middle',
    });
    label.textContent = fmt.int(t);
    root.appendChild(label);
  }

  const axisTitle = svg('text', { class: 'axis-title', x: m.left, y: 12, 'text-anchor': 'start' });
  axisTitle.textContent = 'OPEN TICKETS';
  root.appendChild(axisTitle);

  rows.forEach((row, i) => {
    const yTop = m.top + i * rowH + 8;
    const barH = rowH - 20;

    const name = svg('text', {
      class: 'tick', x: m.left - 10, y: yTop + barH / 2 + 4, 'text-anchor': 'end',
    });
    name.textContent = opts.storeName(row.store_id);
    name.setAttribute('font-size', '11');
    root.appendChild(name);

    let acc = 0;
    for (const band of AGING_BANDS) {
      const v = row[band.key] || 0;
      if (!v) continue;
      const xs = x(acc);
      const xe = x(acc + v);
      const rect = svg('rect', {
        class: 'mark', x: xs, y: yTop, width: Math.max(1, xe - xs), height: barH, fill: band.ramp,
      });
      bindTooltip(rect, () => `<div class="tooltip-title">${opts.storeName(row.store_id)}</div>`
        + tipRow(band.ramp, band.label, `${fmt.int(v)} tickets open`)
        + tipRow(null, 'Store backlog', `${fmt.int(row.backlog)} tickets`));
      root.appendChild(rect);
      acc += v;
    }

    const total = svg('text', {
      class: 'tick', x: x(row.backlog) + 7, y: yTop + barH / 2 + 4, 'text-anchor': 'start',
    });
    total.textContent = fmt.int(row.backlog);
    root.appendChild(total);
  });

  root.appendChild(svg('line', {
    class: 'axisline', x1: m.left, x2: m.left, y1: m.top, y2: m.top + rows.length * rowH,
  }));

  mount.appendChild(root);
  return root;
}

/* =============================================================================
   Chart 4 — horizontal breakdown bars (refund and replacement reasons)
   ========================================================================== */

/**
 * @param items [{ key, count, total }] from metrics' groupSum
 * @param opts  { color, valueFormat, unitNoun }
 */
export function breakdownBars(mount, items, opts) {
  const width = measure(mount);
  if (!width) return placeholder(mount, 12 + items.length * 30);
  const rowH = 30;
  const m = { top: 6, right: 76, bottom: 6, left: 132 };
  const height = m.top + items.length * rowH + m.bottom;
  const plotW = Math.max(10, width - m.left - m.right);
  const maxV = Math.max(1, ...items.map((it) => it.total));

  const root = svg('svg', {
    class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-label': opts.ariaLabel || 'Breakdown',
  });

  items.forEach((it, i) => {
    const y = m.top + i * rowH;
    const barH = rowH - 12;

    const label = svg('text', {
      class: 'tick', x: m.left - 10, y: y + barH / 2 + 4, 'text-anchor': 'end',
    });
    label.textContent = fmt.label(it.key);
    label.setAttribute('font-size', '11');
    root.appendChild(label);

    const w = Math.max(1, (it.total / maxV) * plotW);
    const rect = svg('rect', {
      class: 'mark', x: m.left, y, width: w, height: barH, fill: opts.color, rx: 2,
    });
    bindTooltip(rect, () => `<div class="tooltip-title">${fmt.label(it.key)}</div>`
      + tipRow(opts.color, opts.valueLabel, opts.valueFormat(it.total))
      + tipRow(null, 'Cases', `${fmt.int(it.count)} ${it.count === 1 ? opts.unitNoun : `${opts.unitNoun}s`}`));
    root.appendChild(rect);

    const val = svg('text', {
      class: 'tick', x: m.left + w + 8, y: y + barH / 2 + 4, 'text-anchor': 'start',
    });
    val.textContent = opts.valueFormat(it.total);
    root.appendChild(val);
  });

  mount.appendChild(root);
  return root;
}
