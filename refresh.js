// netlify/functions/refresh.js
// Proxies Airtable API calls server-side so the token never touches the browser.
// Reads AIRTABLE_API_KEY from Netlify environment variables.

const BASE_ID   = 'appWoXi55ytoPtEiw';
const SESSIONS  = 'tblFjB1ezLR6saJkv';
const ASSIGNS   = 'tblcmnNlyAhLCEQ0z';

// Field IDs — Sessions table
const F_STATUS  = 'fld6YmmTkbq89GmXy'; // Status
const F_ASSIGN  = 'fldPAY6d7ZDE4Mgjl'; // Coachee assignment link (SOW)

// Field IDs — Coachee assignment table
const F_NEXT    = 'fldpnTFP7Z5Hp3iJc'; // Next session date (Scheduled)

// H1 2026 SOW record IDs → coachee name
const H1_SOWS = {
  'recnAV408R3hbc5w5': 'Jack Conte',
  'recGoQPR7zC7pZWqA': 'Shannon Ma',
  'rec2eToXuLlwcj6ip': 'Drew Rowny',
  'recSHtybkF5OgWRDY': 'Paige Fitzgerald',
  'recx1e6CqJHiPIDeU': 'Kathleen Pacini',
  'rec1jJfGsvnNl8WNF': 'Nicole Hawkins',
};

exports.handler = async () => {
  const token = process.env.AIRTABLE_API_KEY;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AIRTABLE_API_KEY not set' }) };
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    // ── Step 1: page through Sessions table, count Delivered per H1 2026 SOW ──
    const counts = {};
    Object.values(H1_SOWS).forEach(n => counts[n] = 0);

    let allSessions = [], offset = null;
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS}` +
        `?fields[]=${F_STATUS}&fields[]=${F_ASSIGN}` +
        (offset ? `&offset=${encodeURIComponent(offset)}` : '');
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Sessions fetch error ${res.status}`);
      const data = await res.json();
      allSessions = allSessions.concat(data.records || []);
      offset = data.offset || null;
    } while (offset);

    allSessions.forEach(r => {
      const status = r.fields[F_STATUS];
      if (!status || status.name !== 'Delivered') return;
      const assigns = r.fields[F_ASSIGN] || [];
      assigns.forEach(a => {
        const sowId = typeof a === 'string' ? a : a.id;
        if (H1_SOWS[sowId]) counts[H1_SOWS[sowId]]++;
      });
    });

    // ── Step 2: fetch next Scheduled session dates per coachee ──
    // Query Sessions table filtered to Scheduled status, get earliest future date per SOW
    let scheduledSessions = [], sOffset = null;
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS}` +
        `?fields[]=${F_STATUS}&fields[]=${F_ASSIGN}&fields[]=${F_NEXT}` +
        (sOffset ? `&offset=${encodeURIComponent(sOffset)}` : '');
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`Scheduled fetch error ${res.status}`);
      const data = await res.json();
      scheduledSessions = scheduledSessions.concat(data.records || []);
      sOffset = data.offset || null;
    } while (sOffset);

    // Find earliest Scheduled date per coachee
    const nextDates = {};
    const today = new Date().toISOString().slice(0, 10);
    scheduledSessions.forEach(r => {
      const status = r.fields[F_STATUS];
      if (!status || status.name !== 'Scheduled') return;
      const date = r.fields[F_NEXT] || r.fields[F_STATUS]?.date;
      // F_NEXT on sessions table is actually the session date field fldVA0wASVfQFtWdF
      // but we already have it via the assignment lookup — skip if no date
    });

    // ── Step 2b: fetch next session from assignment records (scheduled field) ──
    const sowIds = Object.keys(H1_SOWS);
    const assignUrl = `https://api.airtable.com/v0/${BASE_ID}/${ASSIGNS}?` +
      sowIds.map(id => `records[]=${id}`).join('&') +
      `&fields[]=${F_NEXT}`;
    const aRes = await fetch(assignUrl, { headers });
    if (!aRes.ok) throw new Error(`Assignments fetch error ${aRes.status}`);
    const aData = await aRes.json();

    const nextByName = {};
    (aData.records || []).forEach(r => {
      const name = H1_SOWS[r.id];
      if (!name) return;
      const nextDate = r.fields[F_NEXT];
      if (nextDate) nextByName[name] = String(nextDate).slice(0, 10);
    });

    // ── Step 3: return combined result ──
    const result = Object.entries(H1_SOWS).map(([sowId, name]) => ({
      name,
      past: counts[name] || 0,
      next: nextByName[name] || null,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachees: result, updatedAt: new Date().toISOString() }),
    };

  } catch (err) {
    console.error('Refresh function error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
