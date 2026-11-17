// Prices a (user-corrected) design in every available process, and again when inputs are edited.
// No AI call here, so it is cheap. When the paywall is switched on, check payment in this file.
import { calcAll, breakEven, loadRates } from './_quote-engine.js';

const SUPA_URL = 'https://nmjkzhquoxuuebzyotnx.supabase.co';
const MATERIAL_OK = /^[a-z0-9_]{2,30}$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (/^https:\/\/(www\.)?invictusimc\.com$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, analysis, qty, overrides, selected } = req.body || {};
  if (!analysis || typeof analysis !== 'object' || !MATERIAL_OK.test(String(analysis.material_key || 'abs'))) return res.status(400).json({ error: 'Missing design details' });
  const q = Math.max(1, Math.min(10000000, Math.round(Number(qty) || 0)));
  if (!q) return res.status(400).json({ error: 'Please enter a quantity' });
  try {
    await loadRates();
    const ov = overrides && typeof overrides === 'object' ? overrides : {};
    const result = calcAll(analysis, q, ov);
    const chosen = selected ? (result.options.find(o => o.id === selected) || null) : null;
    let curve = null;
    if (chosen) {
      const set = Array.from(new Set([10, 100, 500, 1000, 5000, 10000, 50000, q])).sort((a, b) => a - b);
      curve = breakEven(analysis, chosen.id, ov, set);
    }
    // Save the chosen process and totals (best effort, never blocks the answer)
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (id && key && chosen && /^[0-9a-f-]{36}$/.test(String(id))) {
      fetch(`${SUPA_URL}/rest/v1/quote_requests?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: q, analysis, selected_process: chosen.id, overrides: ov, unit_cost: chosen.unit, total_cost: chosen.total, lead_days: chosen.lead.total })
      }).catch(() => {});
    }
    return res.status(200).json({ ...result, chosen_id: chosen ? chosen.id : null, curve });
  } catch (e) {
    return res.status(500).json({ error: 'Could not calculate. Please check your inputs.' });
  }
}
