# CS Reporting Dashboard

Weekly customer-support reporting across three Shopify stores — **Lumvelle** and **Koda** on
Richpanel, **Elevare** on Commslayer — plus a daily internal queue view.

A static site. Plain HTML, CSS and vanilla ES modules. No framework, no bundler, no build step,
no dependencies. GitHub Pages serves the repository exactly as it is committed.

> **Every number currently on this dashboard is fake.** It is plausible and internally
> consistent, but it was generated, not measured. What is real is the *shape* — see
> [Phase 2](#phase-2-real-data) below.

---

## Run it locally

The site needs to be served over HTTP. **Opening `index.html` by double-clicking will not
work** — browsers block ES module imports and `fetch()` on `file://`, so the page will load its
shell and then show a data-loading error. This is a browser security rule, not something the
code can work around.

Any static server does the job. In order of "what you probably already have":

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Needs nothing installed — `serve.ps1` is a ~40-line PowerShell file included in this repo for
exactly this purpose. It serves the repo root on port 8123 (`-Port 9000` to change it).

If you have Python or Node instead:

```bash
python3 -m http.server 8123
```

```bash
npx serve -l 8123
```

Then open **<http://localhost:8123/>** and press Ctrl+C to stop.

---

## What you are looking at

| Tab | Audience | Contents |
|---|---|---|
| **Weekly** | The client | Headline KPI tiles, daily volume by store, first-response trend, store comparison table, refunds, replacements, goals |
| **Daily** | The support team | Queue right now, backlog aging, the critical queue, per-agent figures |
| **Chargebacks** | Both | Rate against orders, what is still pending with the bank, won and lost in cases and value |
| **Action plans** | Both | The improvement work committed to per store, with the metric each will be judged by |
| **Data sources** | Both | Where each number comes from, what it means, and the three ways to feed this thing |

The **store filter** in the sticky bar (All / Lumvelle / Elevare / Koda) re-computes every tile,
table and chart in all five tabs. Nothing is precomputed per selection — selecting one store
re-runs the same aggregation functions over a narrower set of rows.

The **theme** button cycles system → light → dark. The page renders correctly with no stored
preference; the remembered choice is a convenience only.

---

## Changing the fake data

All nine files live in `data/`. Edit them and reload — there is nothing to rebuild.

The dashboard is genuinely data-driven, so this works the way you would hope:

- **Delete a row from `data/refunds.json`** → the refund count, the refunded total, the refund
  rate, partial retention and the reason breakdown all move. No code change.
- **Change a target in `data/meta.json`** → the goals table's status chips change. Remove a
  target entirely and its row disappears; add it back and it returns.
- **Change `period_start` / `period_end`** → the whole dashboard reports on a different window,
  including which refunds and replacements fall inside it.

Two things to keep true when you edit, or the numbers stop agreeing with each other:

1. In `tickets-weekly.json`, `frt_hours` must have exactly `answered` entries and
   `resolution_hours` exactly `closed` entries.
2. In `queue.json`, each store's three `aging` buckets must sum to its `backlog`.

The page checks both on load and logs a specific warning to the browser console if either is
violated, plus a red line under the filter bar. It renders anyway — a partly broken feed still
shows what it can.

**The full schema is in [`docs/DATA-CONTRACT.md`](docs/DATA-CONTRACT.md)** — every field, its
unit, and the edge cases. Read that before changing a file's shape rather than its values.

---

## Phase 2: real data

The architectural bet of this repo is that **swapping fake data for real data does not touch
the UI.**

`assets/data.js` is the only module that fetches anything. Every other module — `metrics.js`,
`charts.js`, the five views, `app.js` — receives the object `loadData()` returns and never
reaches past it. The UI is coupled to a *shape*, not to a source.

So Phase 2 has two possible forms, and both stop at that file:

- **A scheduled job writes the JSON.** A GitHub Action calls the Richpanel API, the Commslayer
  API and Shopify, computes the same raw counts and per-ticket arrays the contract defines,
  writes `data/*.json`, and commits. **Nothing in this repo changes — not even `data.js`.** The
  dashboard renders real numbers because the files underneath it changed. This is the intended
  route.
- **A live endpoint.** Only the `SOURCES` table at the top of `data.js` changes: paths become
  URLs. `normalize()` keeps returning the identical shape.

API tokens must never reach the browser. This is a public static site; anything the page can
read, any visitor can read. That rules out calling the helpdesk APIs from client-side code.

Before writing the ingestion job, work through the confirmation checklist in
[`docs/API-NOTES.md`](docs/API-NOTES.md). One item on it decides whether the whole thing is
viable: **whether either helpdesk's message payload distinguishes a bot reply from a human
one.** First response time is defined as time to the first *human* reply, and if auto-responses
are indistinguishable from agent replies, FRT collapses toward zero and the metric is
meaningless.

---

## Publishing to GitHub Pages

Push to `main` and the workflow in `.github/workflows/pages.yml` deploys the repo root. There is
no build step — `upload-pages-artifact` uploads the files as they are.

Enable Pages once, in the repository settings:

1. **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions**
   (not "Deploy from a branch" — that path ignores the workflow).
3. Push to `main`, or run the workflow manually from **Actions → Deploy to GitHub Pages →
   Run workflow**.
4. The URL appears in the workflow run summary and back on the Settings → Pages screen. It will
   be `https://<user>.github.io/<repo>/`.

Two details that matter for the project subpath:

- **`.nojekyll`** at the root stops GitHub from running the files through Jekyll. Without it,
  anything starting with an underscore would be dropped.
- **Every path in this repo is relative.** No leading `/` on any stylesheet, script or fetch
  URL, and `data.js` resolves the JSON paths against `import.meta.url` rather than the document
  root. This is what makes the site work identically at `example.github.io/cs-dashboard/` and at
  a server root.

---

## Layout

```
index.html               shell: top bar, tabs, store + period filters, five view containers
serve.ps1                local preview server (development only, not part of the site)
.nojekyll                stops Jekyll processing on Pages
assets/
  styles.css             all CSS; design tokens as custom properties, light and dark
  app.js                 bootstrap: loads data, wires tabs + filter, calls renderers
  data.js                THE DATA LAYER — the only file that fetches anything
  metrics.js             pure functions: all KPI math, no DOM
  charts.js              inline-SVG chart builders, shared tooltip, formatters, tiles
  views/week.js          weekly client view
  views/day.js           daily internal view
  views/chargebacks.js   chargeback rate, outcomes and open cases
  views/plans.js         action plans per store
  views/sources.js       data sources and definitions
data/
  stores.json            store registry: id, name, helpdesk, colour slot
  meta.json              period bounds, generated_at, timezone, targets
  tickets-weekly.json    per store per day: counts and per-ticket duration arrays
  queue.json             live snapshot: backlog, aging, oldest, critical queue, agents
  refunds.json           one row per refund
  replacements.json      one row per replacement
  revenue.json           per store per week, for the refund-rate denominator
  action-plans.json      one row per action plan (hand-written, not from the job)
  chargebacks.json       one row per dispute, with status, fee and outcome
docs/
  DATA-CONTRACT.md       the JSON schemas, field by field, with units and edge cases
  API-NOTES.md           what we know about the two helpdesk APIs, and what to confirm
```

### Two conventions worth knowing before you edit the code

**Medians are never stored.** `tickets-weekly.json` carries one duration value per ticket, not a
precomputed median, because a median of medians is not a median — there would be no correct way
to produce the week's figure, or a figure across three stores. Every median on the page is
computed from the actual pool of tickets in scope.

**Counts and money sum; medians and percentages do not.** They are recomputed over the pooled
tickets, which weights them by volume. This is why the total row is labelled *Total / weighted*
and is never the average of the cells above it. Concretely: the three store FRT medians are
3.7h, 7.3h and 5.5h, whose plain average is 5.5h — the dashboard reports 5.0h, the median of all
912 tickets.
