// Daily job (Vercel cron). Refreshes live rates from every source that is enabled AND marked terms_status = 'permitted'.
// It never saves a number it is not sure about: bad, missing or suspicious numbers are rejected, the old rate stays,
// and you get an email. Needs Vercel settings: CRON_SECRET, SUPABASE_SERVICE_KEY, RESEND_API_KEY (and ALERT_EMAIL, optional).
import { classifyResponse, extractTargets, validateValue } from './_rate-fetch.js';

const SUPA = 'https://nmjkzhquoxuuebzyotnx.supabase.co';
const UA = 'InvictusIMC-RateBot/1.0 (+https://www.invictusimc.com; connect@invictusimc.com)';

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPA}/rest/v1/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

async function sendAlert(subject, lines) {
  const key = process.env.RESEND_API_KEY; if (!key) return;
  const html = `<p>${lines.map(l => String(l).replace(/</g, '&lt;')).join('</p><p>')}</p><p>Nothing was changed: the old rates are still in use. Check the source, then fix or switch it off in the rate_sources table.</p>`;
  await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: 'Invictus IMC <connect@invictusimc.com>', to: [process.env.ALERT_EMAIL || 'connect@invictusimc.com'], subject, html }) }).catch(() => {});
}

async function runSource(src) {
  const cfg = src.config || {}; let status = 'ok', message = 'ok'; const read = {}; const problems = [];
  try {
    const headers = { 'User-Agent': UA, Accept: src.kind === 'json_api' ? 'application/json' : 'text/html' };
    if (cfg.api_key_env && process.env[cfg.api_key_env]) headers[cfg.api_key_header || 'Authorization'] = (cfg.api_key_prefix || '') + process.env[cfg.api_key_env];
    const resp = await fetch(src.url, { headers, redirect: 'follow' });
    const body = await resp.text();
    const bad = classifyResponse(resp.status, body);
    if (bad) problems.push(bad);
    else {
      const { results, problems: p2 } = extractTargets(src.kind, body, cfg);
      problems.push(...p2);
      for (const r of results) {
        const tbl = r.table === 'material' ? 'rate_materials' : 'rate_settings', col = r.table === 'material' ? 'rate_inr_kg' : 'value';
        const cur = await sb(`${tbl}?key=eq.${encodeURIComponent(r.key)}&select=${col}`).then(x => x.json()).catch(() => null);
        const current = Array.isArray(cur) && cur[0] ? Number(cur[0][col]) : null;
        const why = validateValue(r, current);
        if (why) { problems.push({ status: 'out_of_range', message: why }); continue; }
        const upd = await sb(`${tbl}?key=eq.${encodeURIComponent(r.key)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ [col]: r.value, source: src.name, source_url: src.url }) });
        const saved = upd.ok ? await upd.json().catch(() => []) : [];
        if (Array.isArray(saved) && saved.length) read[r.key] = r.value; else problems.push({ status: 'failed', message: `Could not save ${r.key}. Is there a row with that key in the rates table?` });
      }
    }
  } catch (e) { problems.push({ status: 'failed', message: 'Could not reach the source: ' + (e.message || e) }); }
  if (problems.length) { status = problems.find(p => p.status === 'blocked') ? 'blocked' : problems[0].status; message = problems.map(p => p.message).join(' | '); }
  return { status, message, read, anyOk: Object.keys(read).length > 0 };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Not allowed' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Server not configured' });
  const sr = await sb('rate_sources?enabled=eq.true&terms_status=eq.permitted&select=*');
  const sources = await sr.json().catch(() => null);
  if (!sr.ok || !Array.isArray(sources)) return res.status(500).json({ error: 'Could not load sources' });
  const out = [];
  for (const src of sources) {
    if (!src.url) { out.push({ id: src.id, status: 'failed', message: 'No URL set' }); continue; }
    const r = await runSource(src);
    const now = new Date().toISOString();
    await sb('rate_source_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ source_id: src.id, status: r.status, message: r.message.slice(0, 1000), values_read: r.read }) });
    const patch = { last_run_at: now, last_status: r.status, last_message: r.message.slice(0, 1000) };
    if (r.status === 'ok') patch.last_success_at = now;
    // Email on a problem: when it is new, or at most once a day while it continues.
    if (r.status !== 'ok') {
      const lastAlert = src.last_alert_at ? new Date(src.last_alert_at).getTime() : 0;
      if (src.last_status === 'ok' || src.last_status == null || Date.now() - lastAlert > 23 * 3600 * 1000) {
        await sendAlert(`Rate source problem: ${src.name} (${r.status})`, [`Source: ${src.name}`, `Problem: ${r.status}`, r.message]);
        patch.last_alert_at = now;
      }
    }
    await sb(`rate_sources?id=eq.${encodeURIComponent(src.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    out.push({ id: src.id, status: r.status, message: r.message, updated: r.read });
  }
  return res.status(200).json({ ok: true, ran: out.length, results: out });
}
