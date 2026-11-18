// GET /api/board: the Tenaqa Pilot board's open lists and cards, read from Trello with the
// key and token in this site's environment, for viewers who send the passcode (HQ_PASSCODE).
// Read-only: it never writes to Trello.
import { timingSafeEqual } from 'node:crypto';

const BOARD = '6ac95f6fbcb9dd146f128b2a';
const API = 'https://api.trello.com/1';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function trello(path, params, auth) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', auth.key);
  url.searchParams.set('token', auth.token);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Trello answered ${res.status} for ${path}`);
  return res.json();
}

// "Agent: App Engineer" and "Department: Engineering" lines in a card's description.
const lineOf = (desc, word) => {
  const m = new RegExp('^\\s*(?:\\*\\*)?' + word + ':?(?:\\*\\*)?\\s*:?\\s*(.+)$', 'im').exec(desc || '');
  return m ? m[1].replace(/\*+/g, '').trim().slice(0, 60) : '';
};

export default async (req) => {
  const pass = process.env.HQ_PASSCODE;
  const auth = { key: process.env.TRELLO_KEY, token: process.env.TRELLO_TOKEN };
  const missing = [!pass && 'HQ_PASSCODE', !auth.key && 'TRELLO_KEY', !auth.token && 'TRELLO_TOKEN'].filter(Boolean);
  if (missing.length) return json({ setup: true, missing });
  if (!same(req.headers.get('x-hq-pass') || '', pass)) return json({ error: 'passcode' }, 401);

  try {
    const [lists, labels, cards, moves, recent] = await Promise.all([
      trello(`/boards/${BOARD}/lists`, { filter: 'open', fields: 'name,pos' }, auth),
      trello(`/boards/${BOARD}/labels`, { fields: 'name,color', limit: '200' }, auth),
      trello(`/boards/${BOARD}/cards/open`, { fields: 'name,shortUrl,dateLastActivity,idList,idLabels,desc,pos' }, auth),
      trello(`/boards/${BOARD}/actions`, { filter: 'updateCard:idList,createCard', limit: '1000', fields: 'type,date,data' }, auth),
      trello(`/boards/${BOARD}/actions`, { filter: 'createCard,commentCard,updateCard:idList', limit: '30', fields: 'type,date,data' }, auth),
    ]);

    const listName = new Map(lists.map((l) => [l.id, l.name]));
    const labelName = new Map(labels.map((l) => [l.id, l.name]));
    // When each card arrived in its current list (actions come newest first).
    const arrived = new Map();
    for (const a of moves) {
      const id = a.data && a.data.card && a.data.card.id;
      if (id && !arrived.has(id)) arrived.set(id, a.date);
    }
    const lastNote = new Map();
    for (const a of recent) {
      const id = a.data && a.data.card && a.data.card.id;
      if (a.type === 'commentCard' && id && !lastNote.has(id)) lastNote.set(id, String(a.data.text || ''));
    }

    return json({
      at: new Date().toISOString(),
      lists: lists.sort((a, b) => a.pos - b.pos).map((l) => l.name),
      cards: cards
        .sort((a, b) => a.pos - b.pos)
        .map((c) => ({
          id: c.id,
          name: c.name,
          url: c.shortUrl,
          list: listName.get(c.idList) || '',
          labels: (c.idLabels || []).map((id) => labelName.get(id)).filter(Boolean),
          agent: lineOf(c.desc, 'Agent'),
          dept: lineOf(c.desc, 'Department'),
          since: arrived.get(c.id) || c.dateLastActivity,
          last: c.dateLastActivity,
          note: (lastNote.get(c.id) || '').replace(/\s+/g, ' ').slice(0, 240),
        })),
      activity: recent.map((a) => ({
        date: a.date,
        what:
          a.type === 'createCard'
            ? 'Created'
            : a.type === 'commentCard'
              ? 'Commented'
              : a.data && a.data.listAfter
                ? 'Moved to ' + a.data.listAfter.name
                : 'Updated',
        card: (a.data && a.data.card && a.data.card.name) || '',
        url: a.data && a.data.card && a.data.card.shortLink ? 'https://trello.com/c/' + a.data.card.shortLink : '',
        detail: a.type === 'commentCard' ? String(a.data.text || '').replace(/\s+/g, ' ').slice(0, 200) : '',
      })),
    });
  } catch (e) {
    return json({ error: 'trello', message: e.message }, 502);
  }
};

export const config = { path: '/api/board' };
