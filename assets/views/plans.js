/* =============================================================================
   views/plans.js — the action plans view.

   What the team has committed to fixing, per store, and how each one will be
   measured. Every row comes from data/action-plans.json — nothing here is
   written in code, so a plan can be added, reworded, reprioritised or marked
   done by editing that file alone.

   Like every other view it takes the store selection and shows only what is in
   scope. It ignores the period selector: a plan is open until it is closed, not
   something that belongs to a reporting week.
   ========================================================================== */

import { fmt, statusChip } from '../charts.js';

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

/** Plan status maps onto the same three-colour vocabulary as the goals table. */
const STATUS = {
  not_started: { tone: 'critical', label: 'Not started' },
  in_progress: { tone: 'warning', label: 'In progress' },
  blocked: { tone: 'critical', label: 'Blocked' },
  done: { tone: 'good', label: 'Done' },
};

/** What kind of work an action is, so a reader can see who has to move. */
const ACTION_TYPE = {
  supplier: 'Supplier',
  tech: 'Build',
  comms: 'Email',
  policy: 'Policy',
  internal: 'Internal',
};

export function renderPlans(mount, data, storeIds) {
  mount.textContent = '';

  const plans = (storeIds ? data.plans.filter((p) => storeIds.includes(p.store_id)) : data.plans)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  const open = plans.filter((p) => p.status !== 'done');
  const totalActions = plans.reduce((n, p) => n + p.actions.length, 0);
  const doneActions = plans.reduce((n, p) => n + p.actions.filter((a) => a.done).length, 0);

  const head = section(
    'Action plans',
    plans.length
      ? `${open.length} open of ${plans.length}, ${doneActions} of ${totalActions} steps done. `
        + 'Ordered by priority — the first one is the one that costs money rather than time.'
      : 'Nothing recorded for this selection.',
  );
  mount.appendChild(head);

  if (!plans.length) {
    const empty = el('div', 'card');
    empty.appendChild(el('p', 'sub',
      'No action plans for the selected store. Plans live in data/action-plans.json — '
      + 'add a row there and it appears here.'));
    head.appendChild(empty);
    return;
  }

  const list = el('div', 'grid');
  head.appendChild(list);

  for (const plan of plans) {
    const card = el('div', 'card plan');

    /* --- header: priority, title, store, status ---------------------------- */
    const top = el('div', 'plan-head');

    const rank = el('span', 'plan-rank');
    rank.textContent = String(plan.priority);
    rank.title = `Priority ${plan.priority}`;
    top.appendChild(rank);

    const titleWrap = el('div', 'plan-title-wrap');
    titleWrap.appendChild(el('h3', null, plan.title));

    const meta = el('div', 'plan-meta');
    const storeTag = el('span', 'cell-store');
    const dot = el('span', 'store-swatch');
    dot.style.background = data.storeColor(plan.store_id);
    storeTag.append(dot, el('span', null, data.storeName(plan.store_id)));
    meta.appendChild(storeTag);
    meta.appendChild(el('span', 'sub', `Opened ${fmt.date(plan.opened_at)}`));
    meta.appendChild(el('span', 'sub', plan.owner ? `Owner: ${plan.owner}` : 'No owner assigned'));
    titleWrap.appendChild(meta);
    top.appendChild(titleWrap);

    const st = STATUS[plan.status] || { tone: 'unknown', label: fmt.label(plan.status) };
    const chip = statusChip(st.tone, st.label);
    chip.classList.add('plan-status');
    top.appendChild(chip);

    card.appendChild(top);

    /* --- the problem, and why it is worth the effort ----------------------- */
    card.appendChild(el('p', 'plan-problem', plan.problem));
    if (plan.why_it_matters) {
      const why = el('p', 'plan-why');
      why.appendChild(el('strong', null, 'Why it matters. '));
      why.appendChild(document.createTextNode(plan.why_it_matters));
      card.appendChild(why);
    }

    /* --- the steps --------------------------------------------------------- */
    const steps = el('ol', 'plan-actions');
    for (const action of plan.actions) {
      const li = el('li', action.done ? 'plan-action is-done' : 'plan-action');
      const marker = el('span', 'plan-action-dot');
      marker.setAttribute('aria-hidden', 'true');
      li.appendChild(marker);
      const body = el('span', 'plan-action-body');
      body.appendChild(document.createTextNode(action.text));
      if (ACTION_TYPE[action.type]) {
        body.appendChild(el('span', 'plan-action-tag', ACTION_TYPE[action.type]));
      }
      li.appendChild(body);
      // Screen readers get the state as words, not as a colour.
      li.setAttribute('aria-label', `${action.done ? 'Done' : 'To do'}: ${action.text}`);
      steps.appendChild(li);
    }
    card.appendChild(steps);

    /* --- how it will be judged --------------------------------------------- */
    if (plan.metric) {
      const metric = el('div', 'plan-metric');
      metric.appendChild(el('span', 'plan-metric-label', 'Measured by'));
      metric.appendChild(el('span', null, plan.metric));
      card.appendChild(metric);
    }

    list.appendChild(card);
  }

  /* --- provenance ---------------------------------------------------------- */
  const note = el('p', 'section-note');
  note.style.marginTop = '14px';
  note.textContent = 'Plans are stored in data/action-plans.json. Editing that file — adding a '
    + 'step, marking one done, changing an owner or a priority — changes this page with no code '
    + 'change, the same way the rest of the dashboard works.';
  mount.appendChild(note);
}
