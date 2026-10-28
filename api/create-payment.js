// Decides whether an action costs money for this user and, if so, creates a Razorpay order.
// The price is computed HERE from pricing_rules - the browser never gets to say how much to charge.
//
// Vercel environment variables needed:
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, SUPABASE_SERVICE_KEY

const SUPA_URL = 'https://nmjkzhquoxuuebzyotnx.supabase.co';

const ACTIONS = {
  manufacturer_bid: { table: 'order_bids', userCol: 'manufacturer_id', label: 'Bid fee' },
  buyer_order: { table: 'manufacturing_orders', userCol: 'buyer_id', label: 'Order posting fee' }
};

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
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
    // Editing a bid you already placed is always free - only NEW bids are charged.
    if (action === 'manufacturer_bid' && order_id) {
      const ex = await (await sb(`order_bids?order_id=eq.${encodeURIComponent(order_id)}&manufacturer_id=eq.${encodeURIComponent(user_id)}&select=id`)).json();
      if (Array.isArray(ex) && ex.length) return res.status(200).json({ free: true });
    }

    // How many of this action has the user already done? This one is number (count + 1).
    const cntRes = await sb(`${cfg.table}?${cfg.userCol}=eq.${encodeURIComponent(user_id)}&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    const range = cntRes.headers.get('content-range') || '';
    const count = parseInt(range.split('/')[1], 10);
    if (Number.isNaN(count)) return res.status(500).json({ error: 'Could not read usage count' });
    const n = count + 1;

    // Pick the tier with the highest from_n that is <= n.
    const rules = await (await sb(`pricing_rules?action=eq.${action}&from_n=lte.${n}&order=from_n.desc&limit=1&select=price,from_n`)).json();
    const price = Array.isArray(rules) && rules.length ? Number(rules[0].price) : 0;
    if (!(price > 0)) return res.status(200).json({ free: true });

    const amountPaise = Math.round(price * 100);
    const rzKey = process.env.RAZORPAY_KEY_ID, rzSecret = process.env.RAZORPAY_KEY_SECRET;
    if (!rzKey || !rzSecret) return res.status(500).json({ error: 'Payments not configured yet' });

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

    return res.status(200).json({ free: false, key_id: rzKey, razorpay_order_id: rz.id, amount: amountPaise, currency: 'INR', label: cfg.label, bid_number: n });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
