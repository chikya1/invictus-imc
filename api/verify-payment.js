// Confirms a Razorpay payment is genuine (HMAC signature check) and marks it paid in the ledger.
// Returns the internal payment id, which the browser attaches to the bid / order it then saves.
//
// Vercel environment variables needed: RAZORPAY_KEY_SECRET, SUPABASE_SERVICE_KEY

import crypto from 'crypto';

const SUPA_URL = 'https://nmjkzhquoxuuebzyotnx.supabase.co';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (/^https:\/\/(www\.)?invictusimc\.com$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return res.status(400).json({ error: 'Missing fields' });

  const secret = process.env.RAZORPAY_KEY_SECRET, key = process.env.SUPABASE_SERVICE_KEY;
  if (!secret || !key) return res.status(500).json({ error: 'Server not configured' });

  const expected = crypto.createHmac('sha256', secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(razorpay_signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: 'Payment verification failed' });

  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/payments?razorpay_order_id=eq.${encodeURIComponent(razorpay_order_id)}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'paid', razorpay_payment_id, paid_at: new Date().toISOString() })
    });
    const rows = await r.json();
    if (!r.ok || !rows?.length) return res.status(404).json({ error: 'Payment record not found' });
    return res.status(200).json({ ok: true, payment_id: rows[0].id, amount: rows[0].amount_paise / 100 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
