// Step 1 of the quote platform: read an uploaded design with AI and return what it understood.
// The AI never gives prices. Prices come from _quote-engine.js.
import { MATERIALS } from './_quote-engine.js';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

const SUPA_URL = 'https://nmjkzhquoxuuebzyotnx.supabase.co';
const DAILY_LIMIT = 10; // free testing limit per phone, email and IP per 24 hours

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SUPA_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

const MATERIAL_LIST = Object.entries(MATERIALS).map(([k, v]) => `${k} (${v[0]})`).join(', ');

const PROMPT = `You are a senior manufacturing estimator at an Indian contract manufacturer. Read the attached design (drawing, image or PDF) and describe the part so a cost engine can price it. Do NOT give any prices.

Return ONLY valid JSON, no markdown, no code fences, exactly this shape:
{
  "industry": "metal" | "plastic" | "electronics" | "other",
  "part_name": "short name",
  "description": "one plain sentence on what the part is and does",
  "source_quality": "dimensioned_drawing" | "drawing_no_dimensions" | "photo" | "render_or_3d" | "other",
  "form": "solid" | "sheet" | "hollow" | "profile",
  "material_key": one of: ${MATERIAL_LIST},
  "material_confidence": "high" | "medium" | "low",
  "material_reason": "one short sentence why",
  "dimensions_mm": { "l": number, "w": number, "h": number },
  "dimensions_confidence": "high" | "medium" | "low",
  "dimensions_source": "printed" (numbers for the size are written on the drawing) | "estimated" (you guessed from the picture) | "unknown" (no way to tell the real size, for example a photo with no scale),
  "thickness_source": "printed" | "estimated" | "unknown" (for sheet thickness or plastic wall thickness),
  "grade_text": "material grade or specification exactly as written on the drawing, such as EN8, SS304, 6061-T6 or PA66 GF30. Empty string if none is written",
  "grade_source": "printed" | "inferred" | "unknown",
  "fill_factor": number between 0.03 and 1 (part volume divided by bounding box volume),
  "complexity": integer 1 to 5 (1 simple block, 5 very intricate),
  "tolerance_class": "loose" | "standard" | "tight" | "precision",
  "surface_finish": "as_made" | "machined" | "polished" | "coated" | "plated" | "anodised",
  "sheet_thickness_mm": number or 0,
  "bends": integer,
  "hole_count": integer,
  "wall_thickness_mm": number or 0 (plastic parts),
  "hollow": true or false,
  "constant_cross_section": true or false (true only if the part is the same profile along its length, like a tube or rail),
  "features": ["short feature names such as threads, undercuts, thin walls, deep pockets"],
  "assumptions": ["each guess you had to make, in plain words"],
  "questions_for_user": ["things the user should confirm, such as grade of steel or surface finish"],
  "dfm_warnings": ["manufacturing risks you can see, such as walls too thin or sharp internal corners"],
  "electronics": { "board_l_mm": number, "board_w_mm": number, "layers": integer, "component_count": integer, "through_hole_count": integer, "needs_enclosure": true or false }
}
Rules: if a dimension is printed on the drawing, use it and set dimensions_source to "printed". If there is none, still give your best guess in dimensions_mm but set dimensions_source to "estimated" or "unknown" and dimensions_confidence to low. Never present a guess as printed. Set grade_source to "printed" only if the grade is written on the drawing. Use only the material_key values listed. For electronics, fill the electronics object and use rough values for the rest. If the file is not a manufacturable part, set industry to "other" and explain in description. Be honest about uncertainty.`;

function clamp(n, lo, hi, d) { n = Number(n); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; }

const src = v => (['printed', 'estimated', 'unknown'].includes(v) ? v : 'unknown');

function clean(a) {
  const industry = ['metal', 'plastic', 'electronics', 'other'].includes(a.industry) ? a.industry : 'other';
  const d = a.dimensions_mm || {};
  const e = a.electronics || {};
  const strs = v => (Array.isArray(v) ? v.slice(0, 8).map(x => String(x).slice(0, 200)) : []);
  return {
    industry,
    part_name: String(a.part_name || 'Part').slice(0, 80),
    description: String(a.description || '').slice(0, 300),
    source_quality: String(a.source_quality || 'other').slice(0, 30),
    form: ['solid', 'sheet', 'hollow', 'profile'].includes(a.form) ? a.form : 'solid',
    material_key: MATERIALS[a.material_key] ? a.material_key : (industry === 'plastic' ? 'abs' : 'mild_steel'),
    material_confidence: ['high', 'medium', 'low'].includes(a.material_confidence) ? a.material_confidence : 'low',
    material_reason: String(a.material_reason || '').slice(0, 200),
    dimensions_mm: { l: clamp(d.l, 1, 3000, 100), w: clamp(d.w, 1, 3000, 60), h: clamp(d.h, 1, 3000, 40) },
    dimensions_source: src(a.dimensions_source),
    thickness_source: src(a.thickness_source),
    grade_text: String(a.grade_text || '').slice(0, 60),
    grade_source: ['printed', 'inferred', 'unknown'].includes(a.grade_source) ? a.grade_source : 'unknown',
    dimensions_confidence: ['high', 'medium', 'low'].includes(a.dimensions_confidence) ? a.dimensions_confidence : 'low',
    fill_factor: clamp(a.fill_factor, 0.03, 1, 0.35),
    complexity: Math.round(clamp(a.complexity, 1, 5, 3)),
    tolerance_class: ['loose', 'standard', 'tight', 'precision'].includes(a.tolerance_class) ? a.tolerance_class : 'standard',
    surface_finish: ['as_made', 'machined', 'polished', 'coated', 'plated', 'anodised'].includes(a.surface_finish) ? a.surface_finish : 'as_made',
    sheet_thickness_mm: clamp(a.sheet_thickness_mm, 0, 50, 0),
    bends: Math.round(clamp(a.bends, 0, 60, 0)),
    hole_count: Math.round(clamp(a.hole_count, 0, 500, 0)),
    wall_thickness_mm: clamp(a.wall_thickness_mm, 0, 30, 0),
    hollow: !!a.hollow,
    constant_cross_section: !!a.constant_cross_section,
    features: strs(a.features), assumptions: strs(a.assumptions), questions_for_user: strs(a.questions_for_user), dfm_warnings: strs(a.dfm_warnings),
    electronics: { board_l_mm: clamp(e.board_l_mm, 5, 600, 80), board_w_mm: clamp(e.board_w_mm, 5, 600, 50), layers: Math.round(clamp(e.layers, 1, 16, 2)), component_count: Math.round(clamp(e.component_count, 0, 5000, 40)), through_hole_count: Math.round(clamp(e.through_hole_count, 0, 1000, 4)), needs_enclosure: !!e.needs_enclosure }
  };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (/^https:\/\/(www\.)?invictusimc\.com$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.SUPABASE_SERVICE_KEY || !process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Server not configured' });

  const { name, phone, email, qty, file, mimeType, payment_id } = req.body || {};
  // Logged-in app users send their Supabase token. We verify it and use their saved identity.
  let userId = null, mName = '', mPhone = '', mEmail = '';
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    try {
      const ur = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearer}` } });
      if (!ur.ok) return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
      const u = await ur.json();
      if (!u || !u.id) return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
      userId = u.id; mEmail = u.email || ''; const md = u.user_metadata || {}; mName = md.full_name || ''; mPhone = md.phone || u.phone || '';
    } catch (e) { return res.status(401).json({ error: 'Could not check your login. Please try again.' }); }
  }
  const n = String(name || mName || '').trim(), p = String(phone || mPhone || '').replace(/[^\d+]/g, ''), em = String(email || mEmail || '').trim().toLowerCase();
  if (n.length < 2 || p.replace(/\D/g, '').length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return res.status(400).json({ error: 'Please enter a valid name, phone number and email.' });
  const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!file || !okTypes.includes(mimeType)) return res.status(400).json({ error: 'Please upload a JPG, PNG, WebP or PDF file.' });
  if (file.length > 5.5 * 1024 * 1024) return res.status(400).json({ error: 'This file is too large. Please upload a file under 4 MB.' });
  const q = Math.max(1, Math.min(10000000, Math.round(Number(qty) || 0)));
  if (!q) return res.status(400).json({ error: 'Please enter the quantity you need.' });

  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || null;
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const orParts = [`phone.eq.${encodeURIComponent(p)}`, `email.eq.${encodeURIComponent(em)}`];
    if (ip) orParts.push(`ip.eq.${encodeURIComponent(ip)}`);
    if (userId) orParts.push(`user_id.eq.${userId}`);
    const cr = await sb(`quote_requests?created_at=gte.${encodeURIComponent(since)}&or=(${orParts.join(',')})&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    const total = parseInt((cr.headers.get('content-range') || '0/0').split('/')[1], 10) || 0;
    if (!cr.ok) throw new Error('limit check failed');
    // Testers: emails listed in the QUOTE_TEST_EMAILS setting skip the daily limit. Only counts for a verified app login.
    const testers = String(process.env.QUOTE_TEST_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
    const isTester = !!userId && testers.includes(mEmail.toLowerCase());
    if (!isTester && total >= DAILY_LIMIT) return res.status(429).json({ error: 'Daily limit reached. Please try again tomorrow or contact us.' });

    // PAYWALL. The price for this person's Nth quote comes from the pricing_rules table (action 'quote_analysis').
    // Example: rows (from_n 1, price 0) and (from_n 4, price 20) mean 3 free quotes, then Rs 20 each. Admin can edit the table.
    let payRow = null;
    if (!isTester) {
      const idParts = [`phone.eq.${encodeURIComponent(p)}`, `email.eq.${encodeURIComponent(em)}`];
      if (userId) idParts.push(`user_id.eq.${userId}`);
      const lr = await sb(`quote_requests?or=(${idParts.join(',')})&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
      if (!lr.ok) throw new Error('limit check failed');
      const used = parseInt((lr.headers.get('content-range') || '0/0').split('/')[1], 10) || 0;
      const rr = await sb(`pricing_rules?action=eq.quote_analysis&from_n=lte.${used + 1}&order=from_n.desc&limit=1&select=price`);
      const rrows = await rr.json().catch(() => null);
      if (!rr.ok || !Array.isArray(rrows)) throw new Error('price check failed');
      const price = rrows.length ? Number(rrows[0].price) : 0;
      if (price > 0) {
        const appMsg = 'You have used your free quotes. Paid quotes inside the app are coming soon.';
        if (userId) return res.status(402).json({ error: appMsg, payment_required: true, price, used });
        const webMsg = `You have used your ${used} free quote${used === 1 ? '' : 's'}. Each new quote costs \u20B9${price}.`;
        if (!payment_id || !/^[0-9a-f-]{36}$/i.test(String(payment_id))) return res.status(402).json({ error: webMsg, payment_required: true, price, used });
        const pr = await sb(`payments?id=eq.${payment_id}&action=eq.quote_analysis&status=eq.paid&order_ref=is.null&user_id=eq.${encodeURIComponent(em)}&select=id,amount_paise&limit=1`);
        const prows = await pr.json().catch(() => null);
        if (!pr.ok || !Array.isArray(prows) || !prows.length || prows[0].amount_paise < Math.round(price * 100)) return res.status(402).json({ error: 'We could not find your payment for this quote. Please try again.', payment_required: true, price, used });
        payRow = prows[0];
      }
    }

    const block = mimeType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mimeType, data: file } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType, data: file } };
    const ai = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 3000, messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }] })
    });
    if (!ai.ok) { const e = await ai.json().catch(() => ({})); throw new Error((e.error && e.error.message) || 'AI error'); }
    const data = await ai.json();
    if (data.usage) console.log('quote-analyse usage', JSON.stringify(data.usage));
    const textBlock = (data.content || []).find(b => b.type === 'text');
    const rawAll = (textBlock && textBlock.text) || '';
    const raw = rawAll.slice(rawAll.indexOf('{'), rawAll.lastIndexOf('}') + 1);
    const analysis = clean(JSON.parse(raw));

    const ins = await sb('quote_requests', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: n.slice(0, 80), phone: p.slice(0, 20), email: em.slice(0, 120), ip, user_id: userId, qty: q, file_kind: mimeType, analysis }) });
    const row = await ins.json().catch(() => null);
    if (!ins.ok || !Array.isArray(row) || !row[0]) throw new Error('save failed');
    if (payRow) { // mark this payment as used up by this quote, so it cannot pay for a second one
      await sb(`payments?id=eq.${payRow.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ order_ref: String(row[0].id) }) }).catch(() => {});
    }
    return res.status(200).json({ id: row[0].id, qty: q, analysis, materials: Object.entries(MATERIALS).map(([k, v]) => [k, v[0], v[1]]) });
  } catch (err) {
    console.error('quote-analyse', err);
    if (err instanceof SyntaxError) return res.status(500).json({ error: 'We could not read this design clearly. Please try a clearer image or a dimensioned drawing.' });
    return res.status(500).json({ error: 'Something went wrong while reading your design. Please try again.' });
  }
}
