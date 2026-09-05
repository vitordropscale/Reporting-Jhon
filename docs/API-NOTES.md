# API notes — what feeds this dashboard in Phase 2

Everything in the "What we know" section below comes from our own reconnaissance of the two
helpdesk accounts. **None of it has been re-verified against a live account from inside this
repo** — no request has ever been made from this code. Treat it as a starting point that still
needs the confirmation checklist at the bottom before anyone writes the ingestion job.

| Store | Helpdesk | Covered by |
|---|---|---|
| Lumvelle | Richpanel | Richpanel REST API |
| Koda | Richpanel | Richpanel REST API |
| Elevare | Commslayer | Commslayer integration token API |

Revenue for all three comes from Shopify, per store. It is the only input that is not a
helpdesk.

---

## What we know

### Richpanel — Lumvelle and Koda

- There is a public REST API. Developer entry point at `developer.richpanel.com`, with the
  endpoint reference at `api-doc.richpanel.com`.
- JSON, resource-oriented, with conversation endpoints.
- Covers two of the three stores, so whatever shape the ingestion takes, it runs twice against
  Richpanel and once against Commslayer.

### Commslayer — Elevare

- Authentication is by **integration token**, created in Settings → Integration tokens.
- Webhooks are available alongside the REST endpoints.
- Read access covers **conversations, contacts and messages** — which is exactly the set the
  KPIs need.
- Docs at `app.commslayer.com/api/integration/v1/docs`.
- **Gated to the Plus plan and above.** Confirm Elevare's plan before building against it.
- **Sending messages is not supported yet.** Irrelevant for reporting, but it rules out ever
  folding a reply workflow into this tool.

### The assumption that shapes the whole data contract

Neither vendor is assumed to expose a ready-made "FRT" or "resolution time" analytics endpoint.
**Plan on computing every KPI ourselves** from raw conversation and message timestamps.

This is not a detail — it is the reason `data/tickets-weekly.json` stores per-ticket arrays of
durations and raw counts rather than finished medians and percentages. If a vendor analytics
endpoint were used instead, its definition of "first response" would be a black box, the two
helpdesks would almost certainly disagree with each other, and there would be no honest way to
produce a combined figure across all three stores. Computing from timestamps means one
definition, applied identically to every store. See `docs/DATA-CONTRACT.md`.

---

## Confirm against the real accounts before writing the ingestion job

Work through this list with live credentials. Several of these can invalidate a KPI outright,
so do them before writing code, not after.

### Blocking — a wrong answer here means a KPI is wrong, not just late

- [ ] **Does the message payload distinguish a bot or automation reply from a human one?**
      Richpanel and Commslayer separately. This is the single most important question on the
      list: FRT is defined as time to the first *human* reply, and if an auto-responder's
      message is indistinguishable from an agent's, every FRT figure collapses toward zero and
      the metric is worthless. If the distinction is missing, find out whether it can be
      inferred (sender type, agent id, a macro or rule id on the message) and write down the
      inference. If it cannot be inferred at all, say so plainly on the dashboard rather than
      publishing a number we do not believe.
- [ ] **How is a reopen represented?** A status transition, an event, a flag, or only inferable
      from a close timestamp followed by a later customer message? This determines both the
      reopen rate and the "last close counts" rule for resolution time.
- [ ] **Is there a reliable close timestamp**, and does it survive a reopen-and-close-again
      cycle? Resolution time measures creation to *final* close.

### Mechanics — these decide what the job looks like

- [ ] **Date filtering on both list endpoints.** Can conversations be filtered server-side by
      created/updated date, or must the job page through everything and filter locally? The
      latter changes the runtime from seconds to minutes and may force incremental syncing.
- [ ] **Pagination.** Cursor or offset, page size ceiling, and whether the ordering is stable
      while paging (an unstable sort silently drops or duplicates records).
- [ ] **Rate limits.** Requests per minute, burst behaviour, and what a 429 returns. With two
      Richpanel stores plus Commslayer plus Shopify, a weekly job doing per-conversation
      message fetches can add up fast.
- [ ] **Are messages included in the conversation payload, or is a second call needed per
      conversation?** If it is one call per conversation, the rate limit above becomes the
      binding constraint on the whole design.
- [ ] **Timezone of the timestamps returned**, and whether it is configurable per account. The
      contract buckets days in `meta.reporting_timezone`; every ingested timestamp must be
      converted into it before becoming a daily row.

### Shopify — the refund-rate denominator

- [ ] **Revenue per store per week.** Which figure exactly: gross sales, net sales, or total
      sales? The contract wants revenue **before** refunds are subtracted, because subtracting
      them first makes the refund rate meaningless. If the convenient Shopify figure is
      post-refund, it must be grossed back up before it lands in `revenue.json`.
- [ ] **Do the three stores share a Shopify account or is each separate?** Decides whether this
      is one credential or three.
- [ ] **Currency.** The contract is USD throughout. If any store reports in another currency,
      decide where conversion happens and at which rate — and record the rate, or the refund
      rate will drift for reasons nobody can reconstruct later.

### Refund and replacement log

- [ ] These are **not** in either helpdesk today — they live in a spreadsheet the team fills in.
      Decide whether Phase 2 keeps that as the source (export it to JSON) or moves it into
      Shopify refund objects plus a replacement tracker. `is_second_replacement` in particular
      has no automatic source: it means "a repeat replacement on the same original order", and
      unless the job groups replacements by `original_order_id` itself, a human has to flag it.

---

## Where the credentials go

Whatever the answers, **API tokens never reach the browser.** The dashboard is a static site
served from GitHub Pages; anything it could read, any visitor could read.

The intended shape is option B in the Data sources tab: a scheduled GitHub Action holds the
tokens in Actions secrets, calls the APIs, computes the raw counts and per-ticket arrays, writes
`data/*.json`, and commits. The published site never talks to a helpdesk at all.
