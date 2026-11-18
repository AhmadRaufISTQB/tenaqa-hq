// Tenaqa Agent HQ: draws the department flow and the Today view from ORG (org.js) and the
// live board (/api/board). Text from Trello is always set with textContent.
(() => {
  const ORG = window.ORG;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const KEY = 'tenaqa-hq-pass';
  const store = {
    get: () => {
      try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
    },
    set: (v) => {
      try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
    },
    clear: () => {
      try { localStorage.removeItem(KEY); } catch { /* private mode */ }
    },
  };

  let board = null; // { cards, activity, at }
  let state = 'loading'; // loading | ok | setup | locked | error
  const deptById = new Map(ORG.departments.map((d) => [d.id, d]));

  // Which department a card belongs to: its Trello label first, then its name.
  const ORDER = ['qa', 'release', 'sales', 'marketing', 'research', 'success', 'docs', 'finance', 'legal', 'security', 'cos', 'design', 'product', 'engineering'];
  function deptOf(card) {
    for (const l of [card.dept || '', ...(card.labels || [])]) {
      if (!l) continue;
      const k = l.toLowerCase().trim();
      for (const d of ORG.departments) {
        if (k === d.id || k === d.name.toLowerCase() || (d.short && k === d.short.toLowerCase())) return d.id;
      }
    }
    for (const id of ORDER) if (deptById.get(id).match.some((re) => re.test(card.name))) return id;
    return 'cos';
  }
  function bucketOf(card) {
    for (const [b, lists] of Object.entries(ORG.buckets)) if (lists.includes(card.list)) return b;
    return null;
  }
  function workerOf(card, d) {
    if (!card.agent) return '';
    const a = card.agent.toLowerCase();
    const all = [d.lead, ...d.workers];
    const hit = all.find((p) => a.includes(p.name.toLowerCase()));
    return hit ? hit.name : card.agent;
  }

  function work() {
    const out = new Map(ORG.departments.map((d) => [d.id, { waiting: [], active: [], pending: [], completed: [] }]));
    if (!board) return out;
    const monthAgo = Date.now() - 30 * 864e5;
    for (const c of board.cards) {
      const b = bucketOf(c);
      if (!b) continue;
      if (b === 'completed' && Date.parse(c.last) < monthAgo) continue;
      const d = deptOf(c);
      out.get(d)[b].push(c);
    }
    for (const w of out.values()) w.completed.sort((a, b) => (a.last < b.last ? 1 : -1));
    return out;
  }

  // Time words
  function ago(iso) {
    if (!iso) return '';
    const s = (Date.now() - Date.parse(iso)) / 1000;
    const f = Math.abs(s);
    const w = f < 3600 ? Math.max(1, Math.round(f / 60)) + ' min' : f < 86400 ? Math.round(f / 3600) + ' h' : Math.round(f / 86400) + ' d';
    return s < 0 ? 'in ' + w : w + ' ago';
  }
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  function nextRun(r) {
    const now = Date.now();
    const pk = new Date(now + 5 * 3600e3);
    for (let add = 0; add < 8; add++) {
      const day = new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate() + add));
      if (!r.days.includes(day.getUTCDay())) continue;
      for (const t of r.times) {
        const [h, m] = t.split(':').map(Number);
        const at = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h - 5, m);
        if (at > now) return at;
      }
    }
    return null;
  }
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

  // ---------- Flow view ----------
  function badges(w) {
    const b = el('span', 'badges');
    if (!board) {
      b.appendChild(el('span', 'badge', state === 'loading' ? '…' : 'No live data'));
      return b;
    }
    if (w.active.length) b.appendChild(el('span', 'badge active', w.active.length + ' active'));
    if (w.waiting.length) b.appendChild(el('span', 'badge waiting', w.waiting.length + ' for you'));
    if (w.pending.length) b.appendChild(el('span', 'badge', w.pending.length + ' queued'));
    if (w.completed.length) b.appendChild(el('span', 'badge done', w.completed.length + ' done'));
    if (!b.childNodes.length) b.appendChild(el('span', 'badge', 'Idle'));
    return b;
  }
  function deptNode(d, w) {
    const n = el('button', 'node');
    n.type = 'button';
    n.dataset.dept = d.id;
    n.appendChild(el('span', 'node-name', d.name));
    n.appendChild(el('span', 'node-meta', d.lead.name + ' · ' + plural(d.workers.length, 'agent', 'agents')));
    n.appendChild(badges(w));
    if (w.active.length) n.classList.add('has-active');
    if (w.waiting.length) n.classList.add('has-waiting');
    n.setAttribute('aria-label', d.name + ': ' + w.active.length + ' active, ' + w.waiting.length + ' waiting for you');
    n.addEventListener('click', () => openDept(d.id));
    return n;
  }
  function drawFlow() {
    const W = work();
    const lanes = $('#lanes');
    lanes.replaceChildren();
    for (const lane of ORG.lanes) {
      const box = el('section', 'lane');
      box.setAttribute('aria-label', lane.name);
      const head = el('div', 'lane-head');
      head.append(el('h2', null, lane.name), el('span', 'small', lane.says));
      box.appendChild(head);
      const depts = ORG.departments.filter((d) => d.lane === lane.id);
      if (lane.id === 'ops') {
        const grid = el('div', 'ops');
        depts.forEach((d) => grid.appendChild(deptNode(d, W.get(d.id))));
        box.appendChild(grid);
      } else {
        const track = el('div', 'track');
        depts.forEach((d, i) => {
          if (i) {
            const prev = W.get(depts[i - 1].id);
            const link = el('span', 'link' + (prev.active.length || W.get(d.id).active.length ? ' live' : ''));
            link.setAttribute('aria-hidden', 'true');
            track.appendChild(link);
          }
          track.appendChild(deptNode(d, W.get(d.id)));
        });
        if (lane.id !== 'care') {
          const link = el('span', 'link live');
          link.setAttribute('aria-hidden', 'true');
          track.appendChild(link);
          const gate = el('button', 'gate');
          gate.type = 'button';
          const waiting = depts.reduce((n, d) => n + W.get(d.id).waiting.length, 0);
          gate.append(el('b', null, 'You approve'), el('span', null, lane.id === 'build' ? 'dev → QA → UAT → production' : 'emails, posts, prices'));
          if (board) gate.appendChild(el('span', null, waiting ? waiting + ' waiting' : 'nothing waiting'));
          gate.addEventListener('click', openCeo);
          track.appendChild(gate);
          const end = el('span', 'end', lane.id === 'build' ? '→ teams using Tenaqa' : '→ teams and the market');
          track.appendChild(end);
        } else {
          const end = el('span', 'end', '→ feedback back to Product');
          track.appendChild(el('span', 'link'));
          track.appendChild(end);
        }
        box.appendChild(track);
      }
      lanes.appendChild(box);
    }

    const cos = W.get('cos');
    const cosMeta = document.querySelector('[data-meta="cos"]');
    cosMeta.replaceChildren(el('span', null, 'Plan, approvals, report'), badges(cos));
    $('#node-cos').onclick = () => openDept('cos');

    const all = [...W.values()];
    const sum = (k) => all.reduce((n, w) => n + w[k].length, 0);
    const pills = $('#pills');
    pills.replaceChildren();
    if (board) {
      const p = (cls, n, words) => {
        const s = el('span', 'pill ' + cls);
        s.append(el('b', null, String(n)), document.createTextNode(' ' + words));
        return s;
      };
      pills.append(p('you', sum('waiting'), 'waiting for you'), p('active', sum('active'), 'active'), p('', sum('pending'), 'queued'), p('done', sum('completed'), 'done in 30 days'));
      $('#ceo-meta').textContent = sum('waiting') ? plural(sum('waiting'), 'item waits', 'items wait') + ' for you' : 'Nothing waits for you';
    }

    const later = $('#later');
    if (!later.childNodes.length) {
      for (const l of ORG.later) {
        const n = el('button', 'node');
        n.type = 'button';
        n.append(el('span', 'node-name', l.name), el('span', 'node-meta', 'After launch'));
        n.addEventListener('click', () => openLater(l));
        later.appendChild(n);
      }
    }
  }

  // ---------- Sheet ----------
  const sheet = $('#sheet');
  $('#sheet-close').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) sheet.close();
  });
  function openSheet(eyebrow, title, body) {
    $('#sheet-eyebrow').textContent = eyebrow;
    $('#sheet-title').textContent = title;
    $('#sheet-body').replaceChildren(...body);
    if (!sheet.open) sheet.showModal();
    $('#sheet-body').scrollTop = 0;
  }
  function cardList(cards, opts = {}) {
    const ul = el('ul', 'cards');
    if (!cards.length) {
      ul.appendChild(el('li', 'empty', opts.empty || 'Nothing here.'));
      return ul;
    }
    const now = Date.now();
    for (const c of cards.slice(0, opts.max || 50)) {
      const li = el('li');
      const row = el('div', 'row');
      const a = el('a', null, c.name);
      a.href = c.url;
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
      if (opts.age) {
        const days = (now - Date.parse(c.since)) / 864e5;
        row.appendChild(el('span', 'tag' + (days > 2 ? ' warn' : ''), days < 1 ? 'today' : Math.floor(days) + ' d waiting'));
      } else if (opts.pos) {
        row.appendChild(el('span', 'tag', '#' + opts.pos(c)));
      } else {
        row.appendChild(el('span', 'tag', ago(c.last)));
      }
      li.appendChild(row);
      const bits = [];
      if (opts.dept) bits.push(deptById.get(deptOf(c)).name);
      if (opts.worker && opts.worker(c)) bits.push(opts.worker(c));
      if (c.list && opts.list) bits.push(c.list);
      if (bits.length) li.appendChild(el('span', 'meta', bits.join(' · ')));
      if (c.note && !opts.pos) li.appendChild(el('span', 'note', c.note));
      ul.appendChild(li);
    }
    if (cards.length > (opts.max || 50)) ul.appendChild(el('li', 'empty', cards.length - (opts.max || 50) + ' more in Trello.'));
    return ul;
  }

  function openDept(id, startWorker) {
    const d = deptById.get(id);
    const w = work().get(id);
    const body = [];
    body.push(el('h3', null, 'Responsible for'), el('p', null, d.owns));
    body.push(el('h3', null, 'How work moves inside'));
    const ol = el('ol', 'steps');
    d.flow.forEach((s) => ol.appendChild(el('li', null, s)));
    body.push(ol);
    body.push(el('h3', null, 'What needs you'), el('div', 'gatebox', d.gate));
    body.push(el('h3', null, 'Team'));
    const people = el('div', 'people');
    let worker = startWorker || '';
    const workBox = el('div');
    const peopleBtns = [];
    [d.lead, ...d.workers].forEach((p, i) => {
      const b = el('button', 'person');
      b.type = 'button';
      if (i === 0) b.appendChild(el('span', 'lead', 'Lead'));
      b.append(el('b', null, p.name), el('span', 'small muted', p.does));
      b.setAttribute('aria-pressed', String(worker === p.name));
      b.addEventListener('click', () => {
        worker = worker === p.name ? '' : p.name;
        peopleBtns.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.name === worker)));
        workBox.hidden = false;
        toggle.textContent = 'Hide work';
        drawWork();
      });
      b.dataset.name = p.name;
      peopleBtns.push(b);
      people.appendChild(b);
    });
    body.push(people);
    body.push(el('p', 'small muted', 'Runs in: ' + d.run));

    const toggle = el('button', 'btn btn-primary work-toggle', 'See work');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      workBox.hidden = !workBox.hidden;
      toggle.textContent = workBox.hidden ? 'See work' : 'Hide work';
      if (!workBox.hidden) {
        drawWork();
        toggle.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }
    });
    body.push(toggle, workBox);
    workBox.hidden = !startWorker;
    if (startWorker) toggle.textContent = 'Hide work';

    let tab = w.active.length ? 'active' : w.waiting.length ? 'waiting' : 'pending';
    function drawWork() {
      workBox.replaceChildren();
      if (!board) {
        workBox.appendChild(el('p', 'empty', state === 'locked' ? 'Unlock live data at the top of the page to see the work.' : 'Live data isn’t connected yet.'));
        return;
      }
      const pick = (list) => (worker ? list.filter((c) => workerOf(c, d) === worker) : list);
      const tabs = [
        ['active', 'Active'],
        ['pending', 'Pending'],
        ['waiting', 'Waiting for you'],
        ['completed', 'Completed'],
      ];
      const seg = el('div', 'seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'Work');
      for (const [k, label] of tabs) {
        const b = el('button', null, label + ' ' + pick(w[k]).length);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(tab === k));
        b.addEventListener('click', () => {
          tab = k;
          drawWork();
        });
        seg.appendChild(b);
      }
      workBox.appendChild(el('h3', null, worker ? 'Work · ' + worker : 'Work · whole department'));
      workBox.appendChild(seg);
      const empty = {
        active: 'Nothing in progress.',
        pending: 'Nothing queued.',
        waiting: 'Nothing waiting for you.',
        completed: 'Nothing completed in the last 30 days.',
      }[tab];
      workBox.appendChild(cardList(pick(w[tab]), { empty, age: tab === 'waiting', worker: (c) => workerOf(c, d), list: tab === 'pending' || tab === 'completed' }));
      if (worker && !board.cards.some((c) => c.agent)) workBox.appendChild(el('p', 'small muted', 'Cards name their agent with an “Agent:” line; older cards don’t have one yet.'));
    }
    if (startWorker) drawWork();
    openSheet(d.lane === 'core' ? 'Reports to you' : (ORG.lanes.find((l) => l.id === d.lane) || {}).name + ' lane', d.name, body);
  }

  function openCeo() {
    const W = work();
    const waiting = [...W.values()].flatMap((w) => w.waiting).sort((a, b) => (a.since < b.since ? -1 : 1));
    const body = [el('h3', null, 'Your role'), el('p', null, ORG.ceo.about), el('h3', null, 'Waiting for you')];
    if (board) body.push(cardList(waiting, { empty: 'Nothing waits for you.', age: true, dept: true }));
    else body.push(el('p', 'empty', state === 'locked' ? 'Unlock live data at the top of the page.' : 'Live data isn’t connected yet.'));
    body.push(el('p', 'small muted', 'Approve: move the card to “Approved” in Trello. Reject: move it to “Changes asked” with a comment.'));
    const a = el('a', 'btn work-toggle', 'Open the board in Trello');
    a.href = ORG.links.board;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'inline-grid';
    a.style.placeItems = 'center';
    a.style.textDecoration = 'none';
    a.style.color = 'var(--ink)';
    body.push(a);
    openSheet('CEO and Founder', ORG.ceo.name, body);
  }
  $('#node-ceo').addEventListener('click', openCeo);
  function openLater(l) {
    openSheet('After launch', l.name, [el('h3', null, 'Will be responsible for'), el('p', null, l.owns), el('p', 'small muted', 'It gets a lead and two agents when the work is there.')]);
  }

  // ---------- Today view ----------
  function drawToday() {
    const W = work();
    const all = [...W.values()];
    const flat = (k) => all.flatMap((w) => w[k]);
    const tiles = $('#tiles');
    tiles.replaceChildren();
    const tile = (n, label, you) => {
      const t = el('div', 'tile' + (you ? ' you' : ''));
      t.append(el('span', 'num', board ? String(n) : '—'), el('span', 'lbl', label));
      return t;
    };
    tiles.append(tile(flat('waiting').length, 'Waiting for you', true), tile(flat('active').length, 'Active'), tile(flat('pending').length, 'Queued'), tile(flat('completed').length, 'Done in 30 days'));

    const waiting = flat('waiting').sort((a, b) => (a.since < b.since ? -1 : 1));
    $('#today-lede').textContent = board
      ? (waiting.length ? plural(waiting.length, 'item waits', 'items wait') + ' for you' : 'Nothing waits for you') +
        ', agents are on ' + plural(flat('active').length, 'card', 'cards') + '.'
      : state === 'locked'
        ? 'Unlock live data to see today’s work.'
        : 'Live data isn’t connected yet.';
    $('#list-waiting').replaceWith(Object.assign(cardList(board ? waiting : [], { empty: board ? 'Nothing waits for you.' : '—', age: true, dept: true }), { id: 'list-waiting' }));
    $('#list-active').replaceWith(Object.assign(cardList(board ? flat('active') : [], { empty: board ? 'No card in progress.' : '—', dept: true }), { id: 'list-active' }));
    const next = board ? board.cards.filter((c) => c.list === 'Up next') : [];
    $('#list-next').replaceWith(Object.assign(cardList(next, { empty: board ? 'The queue is empty.' : '—', pos: (c) => next.indexOf(c) + 1, dept: true }), { id: 'list-next' }));

    const runs = $('#runs');
    runs.replaceChildren();
    for (const r of ORG.schedule) {
      const box = el('div', 'run');
      const at = nextRun(r);
      box.append(el('b', null, r.name), el('span', 'small', at ? 'Next ' + fmt.format(new Date(at)) + ' (' + ago(new Date(at).toISOString()) + ')' : 'No run planned'), el('span', 'meta', r.cadence + ' · ' + r.depts.map((id) => deptById.get(id).short || deptById.get(id).name).join(', ')));
      runs.appendChild(box);
    }

    const feed = $('#feed');
    feed.replaceChildren();
    const acts = board ? board.activity : [];
    if (!acts.length) feed.appendChild(el('li', 'empty', board ? 'No activity yet.' : '—'));
    for (const a of acts.slice(0, 25)) {
      const li = el('li');
      const t = el('span', 't', ago(a.date));
      t.title = new Date(a.date).toLocaleString();
      const body = el('div');
      body.style.minWidth = '0';
      body.appendChild(el('span', 'muted', a.what + ' · '));
      const link = el('a', null, a.card);
      if (a.url) {
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener';
      }
      body.appendChild(link);
      if (a.detail) body.appendChild(el('div', 'note', a.detail));
      li.append(t, body);
      feed.appendChild(li);
    }
  }

  // ---------- Data ----------
  function notice(kind) {
    const n = $('#notice');
    n.replaceChildren();
    n.hidden = kind === 'ok' || kind === 'loading';
    if (n.hidden) return;
    const box = el('div', 'box' + (kind === 'error' ? ' warn' : ''));
    if (kind === 'setup') {
      box.appendChild(el('span', null, 'Live data isn’t connected yet. The map works; counts appear once the site has its Trello key, token and passcode.'));
    } else if (kind === 'locked') {
      box.appendChild(el('span', null, 'Enter the passcode to see live work.'));
      const f = el('form');
      const i = el('input');
      i.type = 'password';
      i.id = 'pass';
      i.autocomplete = 'current-password';
      i.setAttribute('aria-label', 'Passcode');
      i.placeholder = 'Passcode';
      const b = el('button', 'btn btn-primary', 'Unlock');
      b.type = 'submit';
      f.append(i, b);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        store.set(i.value.trim());
        load();
      });
      box.appendChild(f);
    } else {
      box.appendChild(el('span', null, 'Couldn’t load the board. It will try again in a minute.'));
    }
    n.appendChild(box);
  }
  async function load() {
    const btn = $('#refresh');
    btn.classList.add('spin');
    try {
      const res = await fetch('/api/board', { headers: { 'x-hq-pass': store.get() }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (body.setup) {
        state = 'setup';
        board = null;
      } else if (res.status === 401) {
        state = 'locked';
        board = null;
        if (store.get()) store.clear();
      } else if (res.ok && body.cards) {
        state = 'ok';
        board = body;
      } else {
        state = 'error';
      }
    } catch {
      state = 'error';
    }
    btn.classList.remove('spin');
    notice(state);
    drawFlow();
    drawToday();
  }

  // Tabs
  const tabs = [...document.querySelectorAll('[role=tab]')];
  function show(id) {
    tabs.forEach((t) => {
      const on = t.id === 'tab-' + id;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }
  tabs.forEach((t) => t.addEventListener('click', () => show(t.id.replace('tab-', ''))));
  show(location.hash === '#today' ? 'today' : 'flow');

  $('#refresh').addEventListener('click', load);
  setInterval(() => {
    if (document.visibilityState === 'visible') load();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });
  drawFlow();
  drawToday();
  load();
})();
