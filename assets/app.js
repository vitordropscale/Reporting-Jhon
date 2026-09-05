/* =============================================================================
   app.js — bootstrap. Loads the data once, wires the tabs and the store filter,
   and calls the three renderers.

   It holds the only mutable state on the page: which tab is open and which
   store is selected. Everything else is derived — changing the selection
   re-runs the renderers against the same immutable dataset, which is why the
   aggregation is never hard-coded per selection.
   ========================================================================== */

import { loadData } from './data.js';
import { renderWeek } from './views/week.js';
import { renderDay } from './views/day.js';
import { renderSources } from './views/sources.js';
import { renderPlans } from './views/plans.js';
import { fmt } from './charts.js';

const VIEWS = {
  week: { mount: 'view-week', render: renderWeek, rendered: false },
  day: { mount: 'view-day', render: renderDay, rendered: false },
  plans: { mount: 'view-plans', render: renderPlans, rendered: false },
  sources: { mount: 'view-sources', render: renderSources, rendered: false },
};

const state = {
  tab: 'week',
  /** null means "All stores". Otherwise an array of store_ids. */
  storeIds: null,
  data: null,
  /**
   * null means "use the period in meta.json". Otherwise { start, end } and the
   * comparison window is derived as the equal-length window before it.
   */
  period: null,
  /** Container width the current views were drawn at. */
  renderedWidth: null,
};

/* =============================================================================
   Rendering
   ========================================================================== */

/**
 * Views are rendered lazily and cached, so opening a tab the first time is the
 * only time it costs anything. Any change to the store filter or the window
 * width invalidates all three, because charts are drawn at measured pixel
 * widths rather than scaled.
 */
function invalidate() {
  for (const v of Object.values(VIEWS)) v.rendered = false;
}

function renderActive() {
  const view = VIEWS[state.tab];
  const mount = document.getElementById(view.mount);

  for (const [name, v] of Object.entries(VIEWS)) {
    document.getElementById(v.mount).hidden = name !== state.tab;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab));
  }

  if (!view.rendered) {
    view.render(mount, state.data, state.storeIds, state.period);
    view.rendered = true;
    // Remember the width the charts were actually drawn at. The resize observer
    // compares against THIS, not against whatever the DOM reports when the
    // observer is installed — otherwise a view rendered at zero width during
    // first layout would look up-to-date and never be corrected.
    state.renderedWidth = Math.round(document.getElementById('main').clientWidth);
  }
}

/* =============================================================================
   Tabs
   ========================================================================== */

function wireTabs() {
  const tabs = [...document.querySelectorAll('.tab')];

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      state.tab = tab.dataset.tab;
      // A remembered tab is a convenience, never a requirement: if storage is
      // unavailable or empty the page still opens on the weekly view.
      try {
        localStorage.setItem('cs-dashboard.tab', state.tab);
      } catch { /* private mode, blocked storage — ignore */ }
      renderActive();
    });
  }

  // Left/right arrows move between tabs, as expected of a tablist.
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    const i = tabs.findIndex((t) => t.dataset.tab === state.tab);
    let next = null;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    if (!next) return;
    e.preventDefault();
    next.click();
    next.focus();
  });
}

function restoreTab() {
  let saved = null;
  try {
    saved = localStorage.getItem('cs-dashboard.tab');
  } catch { /* ignore */ }
  if (saved && VIEWS[saved]) state.tab = saved;
}

/* =============================================================================
   Store filter
   ========================================================================== */

function buildFilter(data) {
  const group = document.getElementById('store-filter');
  group.textContent = '';

  const options = [
    { id: null, label: 'All', color: null },
    ...data.stores.map((s) => ({ id: s.store_id, label: s.name, color: data.storeColor(s.store_id) })),
  ];

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.setAttribute('aria-pressed', String(
      opt.id === null ? state.storeIds === null : (state.storeIds || []).includes(opt.id),
    ));
    if (opt.color) {
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = opt.color;
      btn.appendChild(dot);
    }
    btn.appendChild(document.createTextNode(opt.label));

    btn.addEventListener('click', () => {
      state.storeIds = opt.id === null ? null : [opt.id];
      for (const other of group.querySelectorAll('.chip')) {
        other.setAttribute('aria-pressed', 'false');
      }
      btn.setAttribute('aria-pressed', 'true');
      // Every tile, table and chart in all three tabs is recomputed from the
      // new selection. Nothing is stored per selection.
      invalidate();
      renderActive();
    });

    group.appendChild(btn);
  }
}

/* =============================================================================
   Period selector
   ========================================================================== */

/**
 * Two date inputs bounded by the data that actually exists.
 *
 * The bounds matter: without them it is possible to pick March, get a page of
 * dashes, and have no way to tell whether the dashboard is broken or the period
 * is simply empty. Clamping to the loaded range makes an empty result
 * impossible to reach by accident.
 *
 * The default comes from meta.json and Reset returns to it, so the ingestion
 * job stays the source of truth for "the reported week" — the picker is a way
 * to look around, not a way to redefine the report.
 */
function wirePeriod(data) {
  const startInput = document.getElementById('period-start');
  const endInput = document.getElementById('period-end');
  const reset = document.getElementById('period-reset');

  const dates = data.ticketRows.map((r) => r.date).sort();
  const min = dates[0];
  const max = dates[dates.length - 1];

  for (const input of [startInput, endInput]) {
    input.min = min;
    input.max = max;
  }

  const defaults = { start: data.meta.period_start, end: data.meta.period_end };

  const isDefault = () => !state.period
    || (state.period.start === defaults.start && state.period.end === defaults.end);

  const paint = () => {
    const active = state.period || defaults;
    startInput.value = active.start;
    endInput.value = active.end;
    reset.hidden = isDefault();
  };

  const apply = (changed) => {
    let start = startInput.value || defaults.start;
    let end = endInput.value || defaults.end;

    // Dragging one bound past the other is a slip, not an instruction. Push the
    // other bound along instead of rejecting the input or silently swapping,
    // which would move a date the user did not touch.
    if (start > end) {
      if (changed === 'start') end = start;
      else start = end;
    }

    if (start < min) start = min;
    if (end > max) end = max;

    state.period = (start === defaults.start && end === defaults.end) ? null : { start, end };
    paint();
    invalidate();
    renderActive();
  };

  startInput.addEventListener('change', () => apply('start'));
  endInput.addEventListener('change', () => apply('end'));
  reset.addEventListener('click', () => {
    state.period = null;
    paint();
    invalidate();
    renderActive();
  });

  paint();
}

/* =============================================================================
   Theme
   ========================================================================== */

function wireTheme() {
  const btn = document.getElementById('theme-toggle');
  const order = ['system', 'light', 'dark'];
  const labels = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

  let mode = 'system';
  try {
    const saved = localStorage.getItem('cs-dashboard.theme');
    if (order.includes(saved)) mode = saved;
  } catch { /* ignore */ }

  const apply = () => {
    // "system" removes the attribute entirely, handing control back to the
    // prefers-color-scheme block. The palette is complete without it.
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    btn.textContent = labels[mode];
    btn.setAttribute('aria-label', labels[mode]);
  };

  btn.addEventListener('click', () => {
    mode = order[(order.indexOf(mode) + 1) % order.length];
    try {
      localStorage.setItem('cs-dashboard.theme', mode);
    } catch { /* ignore */ }
    apply();
    // Charts carry themed colours as CSS variables, so they follow along
    // without a redraw. Only the measured layout needs re-rendering, and that
    // has not changed — so nothing to do here beyond applying the attribute.
  });

  apply();
}

/* =============================================================================
   Header meta and resize
   ========================================================================== */

function fillHeader(data) {
  // The header shows the full span the data covers — which is also what bounds
  // the period picker. The SELECTED period lives in the picker itself, so the
  // two never display the same thing and cannot contradict each other.
  const dates = data.ticketRows.map((r) => r.date).sort();
  document.getElementById('meta-period').textContent = `${fmt.dateFull(dates[0])} – `
    + `${fmt.dateFull(dates[dates.length - 1])}`;
  document.getElementById('meta-generated').textContent = fmt.timestamp(data.meta.generated_at);
  document.getElementById('meta-tz').textContent = data.meta.reporting_timezone;
}

/**
 * Charts are sized in pixels, so a width change means a redraw.
 *
 * This observes the container rather than listening for window `resize`,
 * because the case that actually breaks charts is not the user dragging the
 * window — it is the FIRST layout. A view rendered while its container still
 * has zero width would draw every chart at a nonsense size and never correct
 * itself, since no window resize ever happens. The observer catches the
 * 0 -> real transition, and pane resizes and sidebar toggles for free.
 */
function wireResize() {
  const target = document.getElementById('main');
  let frame = null;

  const observer = new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    // Ignore height-only changes: re-rendering changes height, and reacting to
    // that would loop forever.
    if (width === 0 || width === state.renderedWidth) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      invalidate();
      renderActive();
    });
  });

  observer.observe(target);
}

/* =============================================================================
   Boot
   ========================================================================== */

function showError(err) {
  const host = document.getElementById('app-state');
  host.hidden = false;
  host.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = 'The dashboard could not load its data';
  const p = document.createElement('p');
  p.textContent = 'Nothing is rendered rather than showing numbers that might be wrong.';
  const pre = document.createElement('pre');
  pre.textContent = err && err.message ? err.message : String(err);
  host.append(h, p, pre);
  document.getElementById('main').hidden = true;
  console.error(err);
}

async function boot() {
  wireTheme();
  try {
    const data = await loadData();
    state.data = data;

    document.getElementById('app-state').hidden = true;
    document.getElementById('main').hidden = false;

    fillHeader(data);
    buildFilter(data);
    wirePeriod(data);
    restoreTab();
    wireTabs();
    wireResize();
    renderActive();

    if (data.problems && data.problems.length) {
      const warn = document.getElementById('contract-warning');
      warn.hidden = false;
      warn.textContent = `${data.problems.length} data contract violation(s) — `
        + 'open the browser console for details.';
    }
  } catch (err) {
    showError(err);
  }
}

boot();
