// Decides whether an action costs money for this user and, if so, creates a Razorpay order.
// The price is computed HERE from pricing_rules - the browser never gets to say how much to charge.
//
// Rules:
//  - Manufacturers pay ONE flat fee per product (order) to unlock bidding. Once paid, it stays unlocked.
//  - Editing an existing bid is always free.
//  - Buyers pay the flat fee for each new order they post.
//  - If any lookup fails, we stop with an error (we never let an action through as "free" by accident).
//
// Vercel environment variables needed:
//   SUPABASE_SERVICE_KEY (always), RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET (only when a price is switched on)

const SUPA_URL = 'https://nmjkzhquoxuuebzyotnx.supabase.co';

const ACTIONS = {
  manufacturer_bid: { label: 'Bid unlock fee' },
  buyer_order: { label: 'Order posting fee' }
};

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
}

async function sbJson(path) {
  const r = await sb(path);
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d)) throw new Error('Could not complete the check. Please try again.');
  return d;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (/^https:\/\/(www\.)?invictusimc\.com$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, user_id, order_id } = req.body || {};
  const cfg = ACTIONS[action];
  if (!cfg || !user_id) return res.status(400).json({ error: 'Missing or invalid fields' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(500).json({ error: 'Server not configured (SUPABASE_SERVICE_KEY)' });

  try {
    if (action === 'manufacturer_bid') {
      if (!order_id) return res.status(400).json({ error: 'Missing order' });

      // Editing a bid you already placed is always free.
      const existing = await sbJson(`order_bids?order_id=eq.${encodeURIComponent(order_id)}&manufacturer_id=eq.${encodeURIComponent(user_id)}&select=id`);
      if (existing.length) return res.status(200).json({ free: true });

      // Already paid for this product? It stays unlocked - never charge twice.
      const paid = await sbJson(`payments?action=eq.manufacturer_bid&user_id=eq.${encodeURIComponent(String(user_id))}&order_ref=eq.${encodeURIComponent(String(order_id))}&status=eq.paid&select=id,amount_paise&limit=1`);
      if (paid.length) return res.status(200).json({ free: true, unlocked: true, payment_id: paid[0].id, amount: paid[0].amount_paise / 100 });
    }

    // One flat fee per action (admin sets it; 0 = free).
    const rules = await sbJson(`pricing_rules?action=eq.${action}&order=from_n.asc&limit=1&select=price`);
    const price = rules.length ? Number(rules[0].price) : 0;
    if (!(price > 0)) return res.status(200).json({ free: true });

    const amountPaise = Math.round(price * 100);
    const rzKey = process.env.RAZORPAY_KEY_ID, rzSecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzKey || !rzSecret) return res.status(500).json({ error: 'Payments are not switched on yet. Please contact connect@invictusimc.com.' });

    const rzRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${rzKey}:${rzSecret}`).toString('base64') },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: `${action}-${Date.now()}`.slice(0, 40), notes: { action, user_id: String(user_id), order_ref: String(order_id || '') } })
    });
    const rz = await rzRes.json();
    if (!rzRes.ok) return res.status(502).json({ error: rz?.error?.description || 'Razorpay order failed' });

    const ins = await sb('payments', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ action, user_id: String(user_id), order_ref: order_id ? String(order_id) : null, amount_paise: amountPaise, razorpay_order_id: rz.id })
    });
    if (!ins.ok) return res.status(500).json({ error: 'Could not record payment' });

    return res.status(200).json({ free: false, key_id: rzKey, razorpay_order_id: rz.id, amount: amountPaise, currency: 'INR', label: cfg.label });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
