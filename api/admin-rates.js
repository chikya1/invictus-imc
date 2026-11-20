// Admin API for the rates tables. Protected by the ADMIN_API_KEY Vercel setting (sent as a Bearer token).
// GET  -> everything the Rates screen needs.
// POST -> { action: 'set_rate' | 'add_material' | 'set_material_active' | 'set_source' , ... }
import crypto from 'crypto';

const SUPA = 'https://nmjkzhquoxuuebzyotnx.supabase.co';
function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
const KEY_OK = /^[a-z0-9_.]{2,50}$/;

function authorised(req) {
  const k = process.env.ADMIN_API_KEY; if (!k || k.length < 12) return false;
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got), b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (/^https:\/\/(www\.)?invictusimc\.com$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!process.env.ADMIN_API_KEY) return res.status(500).json({ error: 'ADMIN_API_KEY is not set in Vercel yet.' });
  if (!authorised(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Server not configured' });

  try {
    if (req.method === 'GET') {
      const [m, s, src, runs, hist] = await Promise.all([
        sb('rate_materials?select=*&order=family.asc,key.asc'), sb('rate_settings?select=*&order=grp.asc,key.asc'),
        sb('rate_sources?select=*&order=id.asc'), sb('rate_source_runs?select=*&order=run_at.desc&limit=30'),
        sb('rate_history?select=*&order=changed_at.desc&limit=60')
      ]);
      const [materials, settings, sources, source_runs, history] = await Promise.all([m.json(), s.json(), src.json(), runs.json(), hist.json()]);
      if (![m, s, src, runs, hist].every(r => r.ok)) return res.status(500).json({ error: 'Could not load. Have the phase 12 and phase 13 SQL files been run?' });
      return res.status(200).json({ materials, settings, sources, source_runs, history });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const b = req.body || {};
    const done = async r => { const d = await r.json().catch(() => []); return Array.isArray(d) && d.length ? res.status(200).json({ ok: true }) : res.status(400).json({ error: 'Nothing was changed. Check the key.' }); };

    if (b.action === 'set_rate') {
      const v = Number(b.value); if (!(v >= 0) || !isFinite(v) || v > 1e9) return res.status(400).json({ error: 'Enter a valid number.' });
      if (!KEY_OK.test(String(b.key))) return res.status(400).json({ error: 'Bad key.' });
      const isMat = b.kind === 'material';
      const r = await sb(`${isMat ? 'rate_materials' : 'rate_settings'}?key=eq.${encodeURIComponent(b.key)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ [isMat ? 'rate_inr_kg' : 'value']: v, source: 'Admin (manual)', source_url: null }) });
      return done(r);
    }
    if (b.action === 'add_material') {
      const d = Number(b.density), r0 = Number(b.rate_inr_kg), c = Number(b.removal_cm3_min);
      if (!KEY_OK.test(String(b.key)) || !String(b.label || '').trim() || !['metal', 'plastic'].includes(b.family) || !(d > 0) || !(r0 >= 0) || !(c > 0)) return res.status(400).json({ error: 'Please fill key, label, family (metal or plastic), density, rate and machining speed.' });
      const r = await sb('rate_materials', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ key: b.key, label: String(b.label).slice(0, 60), family: b.family, density: d, rate_inr_kg: r0, removal_cm3_min: c, source: 'Admin (manual)' }) });
      return done(r);
    }
    if (b.action === 'set_material_active') {
      if (!KEY_OK.test(String(b.key))) return res.status(400).json({ error: 'Bad key.' });
      return done(await sb(`rate_materials?key=eq.${encodeURIComponent(b.key)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ active: !!b.active }) }));
    }
    if (b.action === 'set_source') {
      if (!KEY_OK.test(String(b.id))) return res.status(400).json({ error: 'Bad id.' });
      const patch = {};
      if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
      if (['unchecked', 'permitted', 'forbidden'].includes(b.terms_status)) patch.terms_status = b.terms_status;
      if (typeof b.url === 'string') patch.url = b.url.slice(0, 500) || null;
      if (b.config && typeof b.config === 'object') patch.config = b.config;
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' });
      return done(await sb(`rate_sources?id=eq.${encodeURIComponent(b.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) }));
    }
    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
