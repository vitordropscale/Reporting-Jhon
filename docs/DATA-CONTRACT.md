# Data contract

Everything the dashboard renders comes from the eight JSON files in `data/`. The UI never
computes a number from anywhere else, and no module except `assets/data.js` reads these files.

**Phase 2 replaces the *contents* of these files. It does not change their shape, and it does
not touch the UI.** If a real API pull produces files that validate against this document, the
dashboard renders real data with zero code changes.

---

## Global rules

| Rule | Detail |
|---|---|
| Identity | Every row that belongs to a store carries `store_id`. Allowed values: `lumvelle`, `elevare`, `koda`. Nothing is ever keyed by helpdesk — the helpdesk is a property of the store, not an axis of the data. |
| Timestamps | ISO 8601 **with offset**, e.g. `2026-08-27T14:18:00-03:00`. Never a bare local time. |
| Dates | ISO calendar dates, `YYYY-MM-DD`. Never a display string like `Aug 27`. Formatting is the UI's job. |
| Durations | **Hours, as a number.** `3.75` means 3h45m. Never seconds, never minutes, never `"3h45m"`. |
| Money | **USD, as a number.** `54.9`. No currency symbol, no thousands separator, no string. |
| Percentages | **Never stored.** If the two raw numbers exist, the JSON carries both and `metrics.js` divides. The only percentage-shaped values in the data are *targets* in `meta.json`, which are thresholds, not measurements. |
| Booleans | Real JSON `true` / `false`, never `"true"` / `1` / `"yes"`. |
| Absent values | JSON `null`, never `""`, `0`, or `"N/A"`. `0` means measured zero. |
| Day bucketing | A row's `date` is the calendar day in `meta.reporting_timezone`. Phase 2 must convert API timestamps into that timezone before bucketing, or the daily charts will drift by a few tickets per day. |

### Why raw arrays instead of stored medians

`frt_hours` and `resolution_hours` are arrays of **one value per ticket**, not a pre-computed
median. This is deliberate and load-bearing:

> A median of medians is not a median. If the JSON stored `frt_median` per store-day, there
> would be no correct way to produce the week's median, or the median across three stores.

Because the raw values are present, every median on the page — per day, per store, per week,
for any store filter selection — is computed from the actual pool of tickets. The same reason
applies to the per-agent `frt_hours` in `queue.json`.

Array length is a consistency check, not decoration:
`frt_hours.length === answered` and `resolution_hours.length === closed`, on every row.

---

## `stores.json`

The store registry. Drives the filter bar, the legend, and colour assignment.

```json
{ "schema": "stores/1", "stores": [ … ] }
```

| Field | Type | Notes |
|---|---|---|
| `store_id` | string | `lumvelle` \| `elevare` \| `koda`. Primary key everywhere else. |
| `name` | string | Display name. The only place a human-readable store name is allowed to live. |
| `helpdesk` | string | `richpanel` \| `commslayer`. Shown in the sources tab; never used to group or aggregate. |
| `color_slot` | integer | `1` Lumvelle blue, `2` Elevare orange, `3` Koda green. Indexes into the CSS series palette. Fixed — do not renumber; the three colours were picked and CVD-checked in this order. |

Row order in this file is the display order of stores everywhere on the page.

---

## `meta.json`

Period boundaries and goals. Editing this file changes what the dashboard reports on and what
counts as a good number — without touching code.

| Field | Type | Notes |
|---|---|---|
| `generated_at` | timestamp | When the data was produced. Shown in the header so a stale dashboard is visible as stale. |
| `reporting_timezone` | string | IANA name. The timezone all `date` fields are bucketed in. |
| `period_start` / `period_end` | date | Inclusive bounds of the reported week. |
| `previous_period_start` / `previous_period_end` | date | Inclusive bounds of the comparison week. Every KPI's "vs previous" is computed against this window. |
| `targets` | object | Keyed by metric id. See below. |

### `targets.<metric_id>`

| Field | Type | Notes |
|---|---|---|
| `label` | string | Row label in the goals table. |
| `unit` | string | `hours` \| `percent` \| `tickets` \| `usd`. Drives formatting and the unit suffix. |
| `goal` | number | At or better than this ⇒ **good**. |
| `warning` | number | Between `goal` and this ⇒ **warning**. Beyond it ⇒ **critical**. |
| `direction` | string | `lower_is_better` \| `higher_is_better`. Decides which side of the threshold is good, **and** the colour of every period-over-period change for that metric. Backlog falling is green because backlog is `lower_is_better`. |

Metric ids currently consumed by the goals table: `frt_median_hours`,
`pct_answered_under_24h`, `resolution_median_hours`, `backlog`, `over_24h_unanswered`,
`reopen_rate`, `refund_rate`. Removing an entry removes its row; adding one back restores it.

---

## `tickets-weekly.json`

The daily ticket facts. **One row per store per day**, 14 days (7 current + 7 previous) × 3
stores = 42 rows. This is the source for every volume, FRT, resolution, and reopen number in
the weekly view.

| Field | Type | Notes |
|---|---|---|
| `store_id` | string | |
| `date` | date | Calendar day in the reporting timezone. |
| `created` | integer | Conversations created that day. Reported for context; **not** the answered figure. |
| `answered` | integer | Conversations that received **≥ 1 human agent reply** that day. Auto-replies, macros fired by automation, and bot messages do not count. |
| `closed` | integer | Conversations whose final close happened that day. |
| `reopened` | integer | Conversations reopened that day. Denominator for reopen rate is `closed` in the same window. |
| `frt_hours` | number[] | One entry per answered conversation: hours from creation to first human reply. Length must equal `answered`. |
| `resolution_hours` | number[] | One entry per closed conversation: hours from creation to final close. If a conversation was reopened and closed again, the **last** close is the one measured. Length must equal `closed`. |

**Edge cases**

- A conversation created on Sunday and first answered on Monday is counted on **Monday** —
  `answered` is keyed by the reply, not by creation. Its `frt_hours` entry will exceed 24.
- A conversation answered twice in one day appears once.
- A conversation answered on Monday and again after a reopen on Thursday contributes one
  `frt_hours` entry (Monday). The Thursday reply is a reopen, not a first response.
- `created` may exceed `answered` on a bad day and be lower on a catch-up day. They are not
  required to balance within the window.

---

## `queue.json`

The **snapshot** view — the state of the queue at one instant, plus the current day's agent
figures. Nothing in this file is a sum over days, and nothing in it may be added across
periods. `snapshot_at` is the instant it describes.

### `stores[]`

| Field | Type | Notes |
|---|---|---|
| `store_id` | string | |
| `backlog` | integer | Open + pending conversations at `snapshot_at`. A count of what exists, not a total of what happened. |
| `unassigned` | integer | Subset of backlog with no assignee. |
| `over_24h_unanswered` | integer | Open more than 24h **and still without a human reply**. Subset of backlog. Distinct from the aging buckets — a ticket can be 30h old and already answered. |
| `answered_today` | integer | Human-answered on the snapshot day. Ties to `tickets-weekly` for `date === meta.period_end`. |
| `aging` | object | `under_24h`, `h24_to_72h`, `over_72h`. **Must sum exactly to `backlog`** — they partition it. Drives the stacked aging chart, and `over_72h` is what the "waiting > 3 days" tile reads. |
| `oldest_ticket` | object | `ticket_id`, `subject`, `created_at`, `status`, `assignee_id` (nullable). Age is computed against `snapshot_at`, never stored. |

### `critical[]`

Rows for the critical-queue table. One per ticket needing attention.

| Field | Type | Notes |
|---|---|---|
| `ticket_id`, `store_id`, `subject`, `customer`, `order_id` | string | |
| `created_at` | timestamp | Age = `snapshot_at − created_at`, computed in `metrics.js`. |
| `first_human_reply_at` | timestamp \| null | `null` means never answered by a human. Not `""`. |
| `status` | string | `open` \| `pending`. |
| `assignee_id` | string \| null | `null` means unassigned. |
| `reason` | string | Why it is on the list: `no_reply_over_24h`, `waiting_over_3_days`, `reopened`, `refund_requested`, `escalated`. |

### `agents[]`

**One row per agent per store** — the same rule as everywhere else, so the store filter works
on this table without special-casing. An agent covering two stores has two rows; the UI groups
by `agent_id` when the filter is "All".

| Field | Type | Notes |
|---|---|---|
| `agent_id`, `agent_name`, `store_id` | string | |
| `answered` | integer | On the snapshot day. Per store, these sum to that store's `answered_today`. |
| `closed` | integer | On the snapshot day. |
| `reopened` | integer | Denominator for the agent's reopen rate is their `closed`. |
| `frt_hours` | number[] | One entry per answered ticket. Length equals `answered`. The agent's median FRT and their "over 24h" count both come from this array. |

Refunds granted per agent are **not** stored here — they are counted from `refunds.json` by
`agent_id` on the snapshot day, so the agent table and the refund tiles can never disagree.

---

## `refunds.json`

**One row per refund.** The refund count is the number of rows — there is no stored total.
Deleting a row changes every refund KPI on the page with no code change.

| Field | Type | Notes |
|---|---|---|
| `refund_id` | string | Unique. |
| `store_id` | string | |
| `order_id` | string | Shopify order the refund belongs to. |
| `ticket_id` | string \| null | Conversation that led to it, when there is one. |
| `refunded_at` | timestamp | Determines which period the refund falls in. |
| `amount_usd` | number | The amount actually refunded — **not** the order value. For a partial refund this is the partial amount. |
| `refund_type` | string | `full` \| `partial`. Partial retention = partial rows ÷ all rows. |
| `reason` | string | `not_delivered`, `damaged_in_transit`, `wrong_item`, `quality_issue`, `late_delivery`, `changed_mind`, `sizing`. Drives the reason breakdown. |
| `agent_id` | string \| null | Who granted it. |

**Refund rate is `Σ amount_usd ÷ revenue for the same store and period`** — money over money.
It is never refunds ÷ tickets. That is why `revenue.json` exists.

---

## `replacements.json`

**One row per replacement shipped.**

| Field | Type | Notes |
|---|---|---|
| `replacement_id` | string | Unique. |
| `store_id` | string | |
| `original_order_id` | string | The order being replaced. |
| `replacement_order_id` | string | The new shipment. |
| `ticket_id` | string \| null | |
| `created_at` | timestamp | Period assignment. |
| `supplier_cost_usd` | number | Cost of goods. |
| `shipping_cost_usd` | number | Shipping. Replacement cost = `supplier_cost_usd + shipping_cost_usd`, summed. The two are stored separately so the split stays inspectable. |
| `reason` | string | `not_delivered`, `damaged_in_transit`, `wrong_item`, `quality_issue`, `missing_part`. |
| `is_second_replacement` | boolean | `true` when this is a **repeat replacement on the same `original_order_id`**. A supplier-quality signal, not a support-quality one — it means the replacement itself failed. |
| `agent_id` | string \| null | |

---

## `revenue.json`

Store revenue, used only as the **denominator of the refund rate**. Per store, per week.

| Field | Type | Notes |
|---|---|---|
| `store_id` | string | |
| `week_start` / `week_end` | date | Inclusive. Must line up with the period bounds in `meta.json` — the current-period row has `week_start === meta.period_start`. |
| `revenue_usd` | number | Net revenue for that store and week, **before** refunds are subtracted. Subtracting them first would make the refund rate meaningless. |

Phase 2 note: this is the one file that does not come from a helpdesk. It comes from Shopify,
per store. If the Shopify figure is post-refund, it must be grossed back up before it lands
here, or the refund rate will read low.

---

## Consistency invariants

The fake data satisfies all of these, and any Phase 2 pull must too. They are worth asserting
in the job that writes the files.

1. `frt_hours.length === answered` and `resolution_hours.length === closed` on all 42 rows of `tickets-weekly.json`.
2. `aging.under_24h + aging.h24_to_72h + aging.over_72h === backlog` for every store in `queue.json`.
3. `Σ agents[store].answered === stores[store].answered_today`, and the union of the agents'
   `frt_hours` for a store is exactly that store's `frt_hours` for `meta.period_end`.
4. Every `store_id` in every file appears in `stores.json`.
5. Every `refunded_at` / `created_at` falls inside `previous_period_start … period_end`.
6. `revenue.json` has one row per store per period, for both periods.
7. The weekly KPI tiles equal the aggregate of the daily arrays; the store table's
   "Total / weighted" row equals the same aggregate. Neither is stored anywhere.

---

## `action-plans.json`

**One row per action plan** — the improvement work committed to for a store, and how each
plan will be judged. This file is the whole content of the Action plans tab: adding a row,
rewording a step, marking one done, assigning an owner or changing a priority all happen here,
never in code.

Unlike every other file, this one is **not** produced by the ingestion job. It is written by
hand and it is not tied to a reporting period — a plan is open until it is closed.

| Field | Type | Notes |
|---|---|---|
| `plan_id` | string | Unique, stable. Used as the key if a plan is ever linked to from elsewhere. |
| `store_id` | string | The store the plan belongs to. Drives the store filter, same as everywhere else. |
| `title` | string | Short name for the problem. |
| `problem` | string | What the customer experiences, in plain language. |
| `why_it_matters` | string \| null | Why this one earns attention over the others — cost, risk, or volume. Optional; omitted rows simply render without the block. |
| `priority` | integer | `1` is highest. Plans render in this order. Ties are allowed but read badly. |
| `status` | string | `not_started` \| `in_progress` \| `blocked` \| `done`. Anything else renders as an unknown chip rather than breaking. |
| `owner` | string \| null | `null` renders as "No owner assigned" — deliberately visible rather than blank. |
| `opened_at` | date | When the plan was recorded. |
| `metric` | string \| null | How anyone will know it worked. A plan without one is a wish. |
| `actions` | array | The steps. Order is the order shown. |

### `actions[]`

| Field | Type | Notes |
|---|---|---|
| `text` | string | One concrete step. |
| `type` | string | Who has to move: `supplier`, `tech`, `comms`, `policy`, `internal`. Renders as a small tag; an unrecognised value renders with no tag. |
| `done` | boolean | Real `true`/`false`. Drives the filled dot and the "N of M steps done" count in the header. The dots are display only — progress is recorded by editing this file, not by clicking. |

**Edge cases**

- A store with no rows renders an explicit "Nothing recorded for this selection", not an empty
  page — so an empty tab is never mistaken for a broken one.
- The Action plans tab ignores the period selector. Plans are not scoped to a reporting week.
