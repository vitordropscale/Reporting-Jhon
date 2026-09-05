/* =============================================================================
   data.js — THE DATA LAYER. The only module in this repo that fetches anything.

   ---------------------------------------------------------------------------
   PHASE 2 CHANGES THIS FILE, AND NOTHING ELSE.
   ---------------------------------------------------------------------------

   Today `loadData()` reads nine static JSON files out of ../data/. When the
   real pull is built, there are exactly two ways forward and both stop here:

     A. A scheduled job (GitHub Action, cron, whatever) calls the Richpanel API,
        the Commslayer API and Shopify, writes the same nine files, and commits
        them. Then NOTHING in this repo changes — not even this file. The UI
        re-renders real numbers because the JSON changed underneath it.

     B. The dashboard talks to a live endpoint. Then only the SOURCES table
        below changes: swap the paths for URLs, add auth headers, and keep
        normalize() returning the identical shape.

   Every other module — metrics.js, charts.js, the five views, app.js —
   receives the object returned by loadData() and never reaches past it. No
   fetch() outside this file. That is the whole architectural bet: the UI is
   coupled to a SHAPE, not to a source.

   The shape is documented field by field in docs/DATA-CONTRACT.md. If a Phase 2
   payload validates against that document, it renders.
   ========================================================================== */

/**
 * Where the data comes from.
 *
 * Resolved against import.meta.url — this module's own location — so the paths
 * stay correct no matter what URL the document is served from. That is what
 * makes the site work from a GitHub Pages project subpath
 * (https://user.github.io/repo/) as well as from a local server root. There is
 * no leading "/" anywhere in this repo, and this is the reason it is not needed.
 */
const SOURCES = {
  stores: '../data/stores.json',
  meta: '../data/meta.json',
  tickets: '../data/tickets-weekly.json',
  queue: '../data/queue.json',
  refunds: '../data/refunds.json',
  replacements: '../data/replacements.json',
  revenue: '../data/revenue.json',
  plans: '../data/action-plans.json',
  chargebacks: '../data/chargebacks.json',
};

async function fetchJson(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    // The overwhelmingly common cause is opening index.html straight off disk:
    // file:// blocks both ES module imports and fetch. Say so plainly instead
    // of surfacing a bare "Failed to fetch".
    throw new Error(
      `Could not load ${relativePath}. If the address bar says "file://", that is the problem — `
      + 'ES modules and fetch() do not work from the filesystem. Serve the folder over HTTP '
      + '(see the README) and reload.',
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(`${relativePath} returned HTTP ${response.status} ${response.statusText}`);
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new Error(`${relativePath} is not valid JSON — check for a trailing comma.`, { cause });
  }
}

/**
 * Fold the nine payloads into the one object every other module consumes.
 *
 * This is deliberately thin. It unwraps the `rows` envelopes and camelCases the
 * two or three keys the UI reads directly, and it does not compute anything —
 * all arithmetic lives in metrics.js, so there is exactly one place where a KPI
 * can be wrong.
 */
function normalize(raw) {
  const stores = raw.stores.stores;
  const byId = new Map(stores.map((s) => [s.store_id, s]));

  return {
    /** Display order for stores everywhere on the page is this array's order. */
    stores,
    storeById: (id) => byId.get(id) || null,
    storeName: (id) => (byId.get(id) ? byId.get(id).name : id),
    /** CSS custom property holding this store's series colour. */
    storeColor: (id) => `var(--series-${byId.get(id) ? byId.get(id).color_slot : 1})`,

    meta: raw.meta,
    ticketRows: raw.tickets.rows,
    queue: {
      snapshotAt: raw.queue.snapshot_at,
      stores: raw.queue.stores,
      critical: raw.queue.critical,
      agents: raw.queue.agents,
    },
    refunds: raw.refunds.rows,
    replacements: raw.replacements.rows,
    revenue: raw.revenue.rows,
    /** Improvement work in flight, one row per plan. Store-scoped like everything else. */
    plans: raw.plans.rows,
    /** One row per dispute. Status is a live state, not a period fact. */
    chargebacks: raw.chargebacks.rows,
    chargebackSnapshotAt: raw.chargebacks.snapshot_at,
  };
}

/**
 * Cheap structural assertions. These are not validation for its own sake — each
 * one catches a specific way a Phase 2 pull can silently produce a dashboard
 * full of plausible, wrong numbers. They warn rather than throw, so a partly
 * broken feed still renders what it can.
 */
function checkInvariants(data) {
  const problems = [];
  const known = new Set(data.stores.map((s) => s.store_id));

  for (const row of data.ticketRows) {
    if (!known.has(row.store_id)) {
      problems.push(`tickets-weekly: unknown store_id "${row.store_id}"`);
    }
    if (row.frt_hours.length !== row.answered) {
      problems.push(
        `tickets-weekly ${row.store_id} ${row.date}: frt_hours has ${row.frt_hours.length} `
        + `values but answered is ${row.answered} — the FRT median will be wrong`,
      );
    }
    if (row.resolution_hours.length !== row.closed) {
      problems.push(
        `tickets-weekly ${row.store_id} ${row.date}: resolution_hours has `
        + `${row.resolution_hours.length} values but closed is ${row.closed}`,
      );
    }
  }

  for (const s of data.queue.stores) {
    const parts = s.aging.under_24h + s.aging.h24_to_72h + s.aging.over_72h;
    if (parts !== s.backlog) {
      problems.push(
        `queue ${s.store_id}: aging buckets sum to ${parts} but backlog is ${s.backlog} — `
        + 'the aging chart will not match the backlog tile',
      );
    }
  }

  for (const store of data.stores) {
    const hasCurrent = data.revenue.some(
      (r) => r.store_id === store.store_id && r.week_start === data.meta.period_start,
    );
    if (!hasCurrent) {
      problems.push(
        `revenue: no row for ${store.store_id} in the current period — `
        + 'its refund rate has no denominator and will render as "no data"',
      );
    }
  }

  if (problems.length) {
    console.warn(
      `[data] ${problems.length} contract violation(s) — see docs/DATA-CONTRACT.md`,
      problems,
    );
  }
  return problems;
}

let cached = null;

/**
 * The one and only entry point. Returns the normalized dataset.
 * Cached, so switching tabs and store filters never refetches.
 */
export async function loadData() {
  if (cached) return cached;

  const [stores, meta, tickets, queue, refunds, replacements, revenue, plans, chargebacks] = await Promise.all([
    fetchJson(SOURCES.stores),
    fetchJson(SOURCES.meta),
    fetchJson(SOURCES.tickets),
    fetchJson(SOURCES.queue),
    fetchJson(SOURCES.refunds),
    fetchJson(SOURCES.replacements),
    fetchJson(SOURCES.revenue),
    fetchJson(SOURCES.plans),
    fetchJson(SOURCES.chargebacks),
  ]);

  const data = normalize({
    stores, meta, tickets, queue, refunds, replacements, revenue, plans, chargebacks,
  });
  data.problems = checkInvariants(data);
  cached = data;
  return data;
}
