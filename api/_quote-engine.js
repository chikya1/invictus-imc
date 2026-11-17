// Quote engine. AI only READS the design (see quote-analyse.js). Every price here comes from formulas
// and the RATES below. All rates are PLACEHOLDER estimates (INR) until checked against real quotes.
// Files starting with "_" are not public API routes on Vercel.

export const MATERIALS = {
  // key: [label, family, density g/cm3, raw rate INR/kg, machining removal cm3/min]
  mild_steel:   ['Mild steel',            'metal', 7.85,   70, 12],
  alloy_steel:  ['Alloy / tool steel',    'metal', 7.85,  130,  8],
  stainless_304:['Stainless steel 304',   'metal', 8.0,   260,  5],
  stainless_316:['Stainless steel 316',   'metal', 8.0,   380,  4],
  aluminium:    ['Aluminium (6061 type)', 'metal', 2.7,   290, 40],
  brass:        ['Brass',                 'metal', 8.5,   650, 35],
  copper:       ['Copper',                'metal', 8.9,   900, 25],
  cast_iron:    ['Cast iron',             'metal', 7.2,    65, 14],
  zinc_alloy:   ['Zinc alloy',            'metal', 6.7,   330, 40],
  titanium:     ['Titanium',              'metal', 4.5,  2500,  2],
  abs:          ['ABS',                   'plastic', 1.05, 170, 60],
  pp:           ['Polypropylene (PP)',    'plastic', 0.91, 115, 60],
  hdpe:         ['HDPE',                  'plastic', 0.95, 110, 60],
  pc:           ['Polycarbonate (PC)',    'plastic', 1.2,  260, 50],
  pa6:          ['Nylon (PA6)',           'plastic', 1.14, 280, 50],
  pom:          ['Acetal (POM)',          'plastic', 1.41, 320, 60],
  pvc:          ['PVC',                   'plastic', 1.4,   95, 60],
  tpu:          ['TPU (soft)',            'plastic', 1.2,  330, 40],
  pet:          ['PET',                   'plastic', 1.38, 120, 60]
};

export const RATES = {
  cnc_rate_metal: 1100, cnc_rate_plastic: 900, laser_rate: 1800, press_rate: 1000,
  cnc_setup: 4000, cnc_setup_per_complexity: 1800,
  stock_block_premium_plastic: 2.2,
  labour_per_piece: { cnc: 15, sheet: 10, casting: 20, forging: 15, extrusion: 6, print: 40, injection: 1.5, vacuum: 150, blow: 2, pcb: 4 },
  packaging: 5, transport: 4, margin_pct: 15,
  inr_cm3_metal_print: 350, inr_cm3_titanium_print: 700, inr_cm3_plastic_print: 22
};

// ---------- central rates ----------
// The numbers above are the built-in DEFAULTS. If the rate tables exist in Supabase, loadRates() overwrites the defaults
// with the table values (cached for 5 minutes). If the database cannot be reached, the defaults keep working.
const RATES_SUPA = 'https://nmjkzhquoxuuebzyotnx.supabase.co';
let _ratesLoadedAt = 0;
export async function loadRates() {
  if (Date.now() - _ratesLoadedAt < 5 * 60 * 1000) return;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return;
  try {
    const h = { apikey: key, Authorization: `Bearer ${key}` };
    const [mr, sr] = await Promise.all([
      fetch(`${RATES_SUPA}/rest/v1/rate_materials?active=eq.true&select=*`, { headers: h }),
      fetch(`${RATES_SUPA}/rest/v1/rate_settings?select=key,value`, { headers: h })
    ]);
    if (!mr.ok || !sr.ok) return;
    const mats = await mr.json(), sets = await sr.json();
    if (!Array.isArray(mats) || !Array.isArray(sets)) return;
    for (const m of mats) {
      const d = Number(m.density), r = Number(m.rate_inr_kg), c = Number(m.removal_cm3_min);
      if (m.key && d > 0 && r >= 0 && c > 0) MATERIALS[m.key] = [m.label, m.family, d, r, c];
    }
    for (const x of sets) {
      const v = Number(x.value); if (!(v >= 0)) continue;
      if (String(x.key).startsWith('labour_per_piece.')) RATES.labour_per_piece[x.key.slice('labour_per_piece.'.length)] = v;
      else if (Object.prototype.hasOwnProperty.call(RATES, x.key) && typeof RATES[x.key] === 'number') RATES[x.key] = v;
    }
    _ratesLoadedAt = Date.now();
  } catch (e) { /* keep defaults */ }
}

const TOL = { loose: 0.9, standard: 1, tight: 1.3, precision: 1.7 };
const FINISH_COST_PER_CM2 = { as_made: 0, machined: 0, polished: 0.06, coated: 0.04, plated: 0.08, anodised: 0.05 };
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const r2 = n => Math.round(n * 100) / 100;

// Merge default inputs with user overrides: ov[key] wins.
function pick(defaults, ov) {
  const out = {};
  for (const k of Object.keys(defaults)) out[k] = num(ov && ov[k], defaults[k]);
  return out;
}

function geometry(a) {
  const d = a.dimensions_mm || {};
  const L = num(d.l, 100), W = num(d.w, 60), H = num(d.h, 40);
  const fill = Math.min(1, Math.max(0.03, num(a.fill_factor, 0.35)));
  const bboxCm3 = (L * W * H) / 1000;
  const partCm3 = bboxCm3 * fill;
  const areaCm2 = (2 * (L * W + L * H + W * H)) / 100;
  return { L, W, H, fill, bboxCm3, partCm3, areaCm2 };
}

function finishCost(a, g) {
  return (FINISH_COST_PER_CM2[a.surface_finish] || 0) * g.areaCm2;
}

function leadDays(tooling, prod, finishing, ship = 4) {
  return { tooling: Math.round(tooling), production: Math.max(1, Math.round(prod)), finishing: Math.round(finishing), shipping: ship, total: Math.round(tooling + Math.max(1, prod) + finishing + ship) };
}

function wrap(base, g, a, qty, o, extra) {
  // base: {name, group, lines:[{label,amount,per:'piece'|'order'}], ...}; adds common lines + totals.
  const pack = o.packaging, trans = o.transport;
  const lines = base.lines.slice();
  const fin = finishCost(a, g);
  if (fin > 0) lines.push({ label: 'Surface finishing', amount: fin });
  lines.push({ label: 'Packaging', amount: pack });
  lines.push({ label: 'Transport', amount: trans });
  const sub = lines.reduce((s, l) => s + l.amount, 0);
  const margin = sub * o.margin_pct / 100;
  lines.push({ label: 'Manufacturer margin', amount: margin });
  const unit = sub + margin;
  return Object.assign({}, base, { lines: lines.map(l => ({ label: l.label, amount: r2(l.amount) })), unit: r2(unit), total: r2(unit * qty), qty }, extra || {});
}

// Getters, so the values follow RATES after loadRates() refreshes them from the database.
const COMMON = { get packaging() { return RATES.packaging; }, get transport() { return RATES.transport; }, get margin_pct() { return RATES.margin_pct; } };
const field = (key, label, unit) => ({ key, label, unit });

/* ---------- METAL PROCESSES ---------- */
function cnc(a, qty, ov, mkey, plastic) {
  const g = geometry(a), m = MATERIALS[mkey], dens = m[2], rate = m[3] * (plastic ? RATES.stock_block_premium_plastic : 1);
  const c = Math.min(5, Math.max(1, num(a.complexity, 3)));
  const o = pick(Object.assign({ material_rate: rate, machine_rate: plastic ? RATES.cnc_rate_plastic : RATES.cnc_rate_metal, setup_cost: RATES.cnc_setup + RATES.cnc_setup_per_complexity * c, labour: RATES.labour_per_piece.cnc }, COMMON), ov);
  const stockCm3 = ((g.L + 6) * (g.W + 6) * (g.H + 6)) / 1000;
  const removed = Math.max(0, stockCm3 - g.partCm3);
  const mins = (removed / m[4]) * (1 + 0.25 * (c - 1)) * (TOL[a.tolerance_class] || 1) + 1.5;
  const matCost = (stockCm3 * dens / 1000) * o.material_rate;
  const lines = [
    { label: 'Raw material (stock block)', amount: matCost },
    { label: 'Machining time (' + r2(mins) + ' min)', amount: mins / 60 * o.machine_rate },
    { label: 'Setup and programming (shared across order)', amount: o.setup_cost / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const prodDays = qty * mins / 60 / 8 / 2;
  const base = { id: plastic ? 'cnc_plastic' : 'cnc', name: plastic ? 'CNC machining (plastic)' : 'CNC machining', group: plastic ? 'plastic' : 'metal', lines,
    wastage_pct: Math.round(removed / stockCm3 * 100), tooling_cost: 0, strength: plastic ? 'Good (solid stock)' : 'Excellent (solid wrought material)', finish: 'Best surface and tight tolerances', min_qty_note: 'Best for 1 to 500 pieces',
    lead: leadDays(0, prodDays + 3, 2), steps: ['Programming and fixture', 'Stock cutting', 'CNC machining', 'Deburring and inspection', 'Finishing (if any)'],
    inputs: [field('material_rate', 'Raw material rate', 'INR/kg'), field('machine_rate', 'CNC machine rate', 'INR/hour'), field('setup_cost', 'Setup and programming (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty <= 500 ? 3 : qty <= 2000 ? 2 : 1 };
  return wrap(base, g, a, qty, o);
}

function sheetMetal(a, qty, ov, mkey) {
  const t = num(a.sheet_thickness_mm, 0);
  if (!t || t > 12 || a.form === 'solid') return null;
  const g = geometry(a), m = MATERIALS[mkey];
  const bends = Math.round(num(a.bends, 2));
  const o = pick(Object.assign({ material_rate: m[3] * 1.1, laser_rate: RATES.laser_rate, bend_cost: 7, setup_cost: 2500, labour: RATES.labour_per_piece.sheet }, COMMON), ov);
  const blankCm2 = (g.L * g.W) / 100 * 1.15;
  const massKg = blankCm2 * (t / 10) * m[2] / 1000 * 1.25;
  const cutLen = 2 * (g.L + g.W) + 80 * num(a.hole_count, 2);
  const speed = Math.max(300, 6000 / t);
  const cutMin = cutLen / speed + 0.4;
  const lines = [
    { label: 'Sheet material (with scrap)', amount: massKg * o.material_rate },
    { label: 'Laser cutting (' + r2(cutMin) + ' min)', amount: cutMin / 60 * o.laser_rate },
    { label: 'Bending (' + bends + ' bends)', amount: bends * o.bend_cost },
    { label: 'Setup (shared across order)', amount: o.setup_cost / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'sheet', name: 'Sheet metal (laser cut and bend)', group: 'metal', lines, wastage_pct: 20, tooling_cost: 0, strength: 'Good (rolled sheet)', finish: 'Good, edges may need deburring', min_qty_note: 'Best for 10 to 5,000 pieces',
    lead: leadDays(0, qty * (cutMin + bends * 0.5) / 60 / 8 / 1.5 + 2, 2), steps: ['Nesting and programming', 'Laser or shear cutting', 'Bending / forming', 'Deburring', 'Welding or finishing (if any)'],
    inputs: [field('material_rate', 'Sheet rate', 'INR/kg'), field('laser_rate', 'Laser rate', 'INR/hour'), field('bend_cost', 'Cost per bend', 'INR'), field('setup_cost', 'Setup (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 10 ? 3 : 2 };
  return wrap(base, g, a, qty, o);
}

function casting(a, qty, ov, mkey, kind) {
  if (a.form === 'sheet') return null;
  const m = MATERIALS[mkey], g = geometry(a), c = Math.min(5, Math.max(1, num(a.complexity, 3)));
  const K = {
    sand:       { name: 'Sand casting',        tool: 40000 + 15000 * c,  yield: 0.6,  process: 45,  base: 15,  cleanup: 0.30, minq: 20,   lead: 25, ok: ['cast_iron', 'mild_steel', 'alloy_steel', 'aluminium', 'brass', 'copper'], note: 'Best for 20 to 2,000 pieces' },
    investment: { name: 'Investment casting',  tool: 60000 + 25000 * c,  yield: 0.7,  process: 150, base: 60, cleanup: 0.15, minq: 50,   lead: 35, ok: ['stainless_304', 'stainless_316', 'mild_steel', 'alloy_steel', 'aluminium', 'brass', 'copper'], note: 'Best for 50 to 5,000 pieces' },
    die:        { name: 'Die casting',         tool: 350000 + 120000 * c + 400 * Math.pow(g.bboxCm3, 0.67), yield: 0.85, process: 90,  base: 12,  cleanup: 0.10, minq: 1000, lead: 55, ok: ['aluminium', 'zinc_alloy'], note: 'Best for 5,000 plus pieces' }
  }[kind];
  if (!K.ok.includes(mkey)) return null;
  if (g.partCm3 * m[2] / 1000 > 40) return null;
  const castRate = mkey === 'aluminium' && kind !== 'sand' ? 230 : m[3] * 0.85;
  const cncRef = cnc(a, qty, {}, mkey, false);
  const o = pick(Object.assign({ material_rate: castRate, process_rate: K.process, tooling: K.tool, labour: RATES.labour_per_piece.casting }, COMMON), ov);
  const massKg = g.partCm3 * m[2] / 1000;
  const pour = massKg / K.yield;
  const machining = cncRef.lines[1].amount * K.cleanup * 2;
  const lines = [
    { label: 'Metal (with gating and runners)', amount: pour * o.material_rate },
    { label: 'Melting, pouring and fettling', amount: pour * o.process_rate + K.base },
    { label: 'Cleanup machining (critical faces)', amount: machining },
    { label: 'Tooling / pattern (shared across order)', amount: o.tooling / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'cast_' + kind, name: K.name, group: 'metal', lines, wastage_pct: Math.round((1 - K.yield) * 100), tooling_cost: o.tooling, strength: kind === 'die' ? 'Moderate (porosity possible)' : 'Moderate to good (cast structure)', finish: kind === 'sand' ? 'Rough, needs machining for fits' : 'Good, minor machining on fits', min_qty_note: K.note,
    lead: leadDays(K.lead, qty * 0.15 / 8 + 4, 3), steps: ['Pattern or die making', 'Melting and casting', 'Fettling and heat treatment', 'Cleanup machining', 'Inspection and finishing'],
    inputs: [field('material_rate', 'Metal rate', 'INR/kg'), field('process_rate', 'Casting process rate', 'INR/kg poured'), field('tooling', 'Tooling / pattern (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= K.minq ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

function forging(a, qty, ov, mkey) {
  if (a.form === 'sheet') return null;
  if (!['mild_steel', 'alloy_steel', 'stainless_304', 'stainless_316', 'aluminium', 'brass'].includes(mkey)) return null;
  const m = MATERIALS[mkey], g = geometry(a), c = Math.min(5, Math.max(1, num(a.complexity, 3)));
  const massKg = g.partCm3 * m[2] / 1000;
  if (massKg > 25) return null;
  const cncRef = cnc(a, qty, {}, mkey, false);
  const o = pick(Object.assign({ material_rate: m[3], process_rate: 60, tooling: 150000 + 40000 * c, labour: RATES.labour_per_piece.forging }, COMMON), ov);
  const stockKg = massKg * 1.3;
  const lines = [
    { label: 'Forging stock (with flash)', amount: stockKg * o.material_rate },
    { label: 'Heating and forging', amount: stockKg * o.process_rate },
    { label: 'Finish machining', amount: cncRef.lines[1].amount * 0.3 },
    { label: 'Die cost (shared across order)', amount: o.tooling / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'forging', name: 'Closed-die forging', group: 'metal', lines, wastage_pct: 23, tooling_cost: o.tooling, strength: 'Best (grain flow, highest strength)', finish: 'Rough, machine critical faces', min_qty_note: 'Best for 500 plus pieces',
    lead: leadDays(40, qty * 0.1 / 8 + 4, 3), steps: ['Die making', 'Billet cutting and heating', 'Forging and trimming', 'Heat treatment', 'Finish machining'],
    inputs: [field('material_rate', 'Billet rate', 'INR/kg'), field('process_rate', 'Forging process rate', 'INR/kg'), field('tooling', 'Die cost (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 500 ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

function extrusionMetal(a, qty, ov, mkey) {
  if (!a.constant_cross_section || !['aluminium', 'copper', 'brass'].includes(mkey)) return null;
  const m = MATERIALS[mkey], g = geometry(a);
  const o = pick(Object.assign({ material_rate: m[3] * 0.95, process_rate: 60, tooling: 45000, labour: RATES.labour_per_piece.extrusion }, COMMON), ov);
  const kg = g.partCm3 * m[2] / 1000 * 1.1;
  const lines = [
    { label: 'Metal (with end scrap)', amount: kg * o.material_rate },
    { label: 'Extruding and cutting to length', amount: kg * o.process_rate + 5 },
    { label: 'Die cost (shared across order)', amount: o.tooling / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'extrusion_metal', name: 'Metal extrusion', group: 'metal', lines, wastage_pct: 10, tooling_cost: o.tooling, strength: 'Good', finish: 'Good along the profile', min_qty_note: 'Best for 500 plus metres or pieces',
    lead: leadDays(18, qty * 0.02 / 8 + 3, 2), steps: ['Die making', 'Billet heating and extrusion', 'Cutting to length', 'Ageing / finishing'],
    inputs: [field('material_rate', 'Metal rate', 'INR/kg'), field('process_rate', 'Extrusion rate', 'INR/kg'), field('tooling', 'Die cost (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 500 ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

function print3d(a, qty, ov, mkey, plastic) {
  const g = geometry(a), m = MATERIALS[mkey];
  if (Math.max(g.L, g.W, g.H) > (plastic ? 300 : 250)) return null;
  if (!plastic && !['stainless_304', 'stainless_316', 'aluminium', 'titanium', 'alloy_steel'].includes(mkey)) return null;
  const perCm3 = plastic ? RATES.inr_cm3_plastic_print : (mkey === 'titanium' ? RATES.inr_cm3_titanium_print : RATES.inr_cm3_metal_print);
  const o = pick(Object.assign({ rate_per_cm3: perCm3, setup_cost: plastic ? 1500 : 6000, labour: RATES.labour_per_piece.print }, COMMON), ov);
  const lines = [
    { label: (plastic ? 'Printing (material and machine time)' : 'Metal printing (powder and machine time)'), amount: g.partCm3 * o.rate_per_cm3 * (plastic ? 1 : 1.1) },
    { label: 'Build setup (shared across order)', amount: o.setup_cost / qty },
    { label: 'Support removal and cleaning', amount: plastic ? 20 : g.partCm3 * 8 },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: plastic ? 'print_plastic' : 'print_metal', name: plastic ? '3D printing (plastic)' : 'Metal 3D printing', group: plastic ? 'plastic' : 'metal', lines, wastage_pct: 5, tooling_cost: 0, strength: plastic ? 'Fair (layered, depends on technology)' : 'Good (dense, some anisotropy)', finish: plastic ? 'Visible layers, can be smoothed' : 'Rough as-built, machine fits', min_qty_note: plastic ? 'Best for 1 to 200 pieces' : 'Best for 1 to 50 pieces',
    lead: leadDays(0, plastic ? 3 + qty / 40 : 6 + qty / 4, 2), steps: plastic ? ['Slicing', 'Printing', 'Support removal', 'Finishing'] : ['Build preparation', 'Metal printing', 'Stress relief and cutting from plate', 'Support removal and machining of fits'],
    inputs: [field('rate_per_cm3', 'Print rate', 'INR/cm3'), field('setup_cost', 'Build setup (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty <= (plastic ? 200 : 50) ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

/* ---------- PLASTIC PROCESSES ---------- */
function injection(a, qty, ov, mkey) {
  const m = MATERIALS[mkey], g = geometry(a), c = Math.min(5, Math.max(1, num(a.complexity, 3)));
  const wall = num(a.wall_thickness_mm, 2.5);
  const cav = qty < 5000 ? 1 : qty < 25000 ? 2 : 4;
  const massG = g.partCm3 * m[2];
  const cycle = 10 + 2.5 * wall * wall + massG * 0.02;
  const mach = massG < 100 ? 700 : massG < 500 ? 1100 : 1800;
  const moldDefault = (100000 + 60000 * (c - 1) + 1200 * Math.pow(g.bboxCm3, 0.67)) * (1 + 0.55 * (cav - 1));
  const o = pick(Object.assign({ material_rate: m[3], machine_rate: mach, tooling: moldDefault, labour: RATES.labour_per_piece.injection, colour_cost: 0.5 }, COMMON), ov);
  const lines = [
    { label: 'Plastic resin (with 5% scrap)', amount: massG / 1000 * 1.05 * o.material_rate },
    { label: 'Moulding (' + Math.round(cycle) + ' sec cycle, ' + cav + ' cavity)', amount: cycle / cav / 3600 * o.machine_rate },
    { label: 'Colour and additives', amount: o.colour_cost },
    { label: 'Mould cost (shared across order)', amount: o.tooling / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'injection', name: 'Injection moulding', group: 'plastic', lines, wastage_pct: 5, tooling_cost: o.tooling, strength: 'Good (depends on resin)', finish: 'Excellent, can be textured', min_qty_note: 'Best for 2,000 plus pieces',
    lead: leadDays(40, qty * cycle / cav / 3600 / 20 + 2, 2), steps: ['Mould design and making', 'Mould trials (T1)', 'Moulding', 'Trimming and inspection', 'Printing / assembly (if any)'],
    inputs: [field('material_rate', 'Resin rate', 'INR/kg'), field('machine_rate', 'Moulding machine rate', 'INR/hour'), field('tooling', 'Mould cost (one-time)', 'INR'), field('colour_cost', 'Colour and additives', 'INR/pc'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 2000 ? 3 : qty >= 500 ? 2 : 1 };
  return wrap(base, g, a, qty, o);
}

function vacuumCast(a, qty, ov, mkey) {
  const g = geometry(a);
  if (qty > 300 || Math.max(g.L, g.W, g.H) > 350) return null;
  const m = MATERIALS[mkey];
  const massG = g.partCm3 * m[2];
  const o = pick(Object.assign({ resin_rate_per_kg: 1200, master_cost: 9000, mould_cost: 6000, labour: RATES.labour_per_piece.vacuum }, COMMON), ov);
  const moulds = Math.ceil(qty / 20);
  const lines = [
    { label: 'Casting resin', amount: massG / 1000 * o.resin_rate_per_kg },
    { label: 'Master model (shared across order)', amount: o.master_cost / qty },
    { label: 'Silicone moulds x' + moulds + ' (shared across order)', amount: moulds * o.mould_cost / qty },
    { label: 'Labour and finishing', amount: o.labour }
  ];
  const base = { id: 'vacuum', name: 'Vacuum casting (silicone mould)', group: 'plastic', lines, wastage_pct: 5, tooling_cost: o.master_cost + moulds * o.mould_cost, strength: 'Fair (prototype grade)', finish: 'Very good, near moulded look', min_qty_note: 'Best for 5 to 100 pieces',
    lead: leadDays(5, 3 + qty / 10, 2), steps: ['Master model', 'Silicone mould', 'Vacuum casting', 'Trimming and painting'],
    inputs: [field('resin_rate_per_kg', 'Resin rate', 'INR/kg'), field('master_cost', 'Master model (one-time)', 'INR'), field('mould_cost', 'Cost per silicone mould', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty <= 100 ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

function blow(a, qty, ov, mkey) {
  if (!a.hollow) return null;
  const m = MATERIALS[mkey], g = geometry(a);
  const wall = num(a.wall_thickness_mm, 1.5);
  const massG = g.areaCm2 * 0.8 * (wall / 10) * m[2];
  const o = pick(Object.assign({ material_rate: m[3], machine_rate: 1100, tooling: 250000 + 600 * Math.pow(g.bboxCm3, 0.67), labour: RATES.labour_per_piece.blow }, COMMON), ov);
  const lines = [
    { label: 'Plastic resin (with scrap)', amount: massG / 1000 * 1.08 * o.material_rate },
    { label: 'Blow moulding (about 25 sec cycle)', amount: 25 / 3600 * o.machine_rate },
    { label: 'Mould cost (shared across order)', amount: o.tooling / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'blow', name: 'Blow moulding', group: 'plastic', lines, wastage_pct: 8, tooling_cost: o.tooling, strength: 'Good for hollow parts', finish: 'Good, thin even walls', min_qty_note: 'Best for 3,000 plus pieces',
    lead: leadDays(45, qty * 25 / 3600 / 20 + 2, 2), steps: ['Mould making', 'Parison and blowing', 'Trimming and leak test', 'Printing / packing'],
    inputs: [field('material_rate', 'Resin rate', 'INR/kg'), field('machine_rate', 'Blow moulding machine rate', 'INR/hour'), field('tooling', 'Mould cost (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 3000 ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

function extrusionPlastic(a, qty, ov, mkey) {
  if (!a.constant_cross_section) return null;
  const m = MATERIALS[mkey], g = geometry(a);
  const o = pick(Object.assign({ material_rate: m[3], process_rate: 25, tooling: 60000, labour: RATES.labour_per_piece.extrusion }, COMMON), ov);
  const kg = g.partCm3 * m[2] / 1000 * 1.05;
  const lines = [
    { label: 'Plastic resin', amount: kg * o.material_rate },
    { label: 'Extruding and cutting', amount: kg * o.process_rate + 2 },
    { label: 'Die cost (shared across order)', amount: o.tooling / qty },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'extrusion_plastic', name: 'Plastic extrusion', group: 'plastic', lines, wastage_pct: 5, tooling_cost: o.tooling, strength: 'Good along the profile', finish: 'Good', min_qty_note: 'Best for 1,000 plus metres or pieces',
    lead: leadDays(20, qty * 0.01 / 8 + 2, 1), steps: ['Die making', 'Extrusion', 'Cooling and cutting', 'Packing'],
    inputs: [field('material_rate', 'Resin rate', 'INR/kg'), field('process_rate', 'Extrusion rate', 'INR/kg'), field('tooling', 'Die cost (one-time)', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 1000 ? 3 : 1 };
  return wrap(base, g, a, qty, o);
}

/* ---------- ELECTRONICS ---------- */
function electronics(a, qty, ov) {
  const e = a.electronics || {};
  const L = num(e.board_l_mm, 80), W = num(e.board_w_mm, 50), layers = Math.round(num(e.layers, 2));
  const comps = Math.round(num(e.component_count, 40)), tht = Math.round(num(e.through_hole_count, 4));
  const smt = Math.max(0, comps - tht);
  const g = { L, W, H: 15, fill: 1, bboxCm3: 0, partCm3: 0, areaCm2: L * W / 100 };
  const cm2 = L * W / 100;
  const o = pick(Object.assign({ pcb_rate_per_cm2_layer: 0.9, bom_cost: comps * 12, smt_per_placement: 0.6, tht_per_joint: 3, stencil_setup: 6500, test_cost: 18, labour: RATES.labour_per_piece.pcb }, COMMON), ov);
  const lines = [
    { label: 'PCB fabrication (' + layers + ' layer)', amount: cm2 * layers * o.pcb_rate_per_cm2_layer + 2500 / qty },
    { label: 'Components (BOM, edit this)', amount: o.bom_cost },
    { label: 'SMT assembly (' + smt + ' placements)', amount: smt * o.smt_per_placement },
    { label: 'Through-hole assembly (' + tht + ' joints)', amount: tht * o.tht_per_joint },
    { label: 'Stencil and line setup (shared across order)', amount: o.stencil_setup / qty },
    { label: 'Testing', amount: o.test_cost },
    { label: 'Labour', amount: o.labour }
  ];
  const base = { id: 'pcba', name: 'PCB fabrication and assembly (PCBA)', group: 'electronics', lines, wastage_pct: 3, tooling_cost: o.stencil_setup, strength: 'n/a', finish: 'n/a', min_qty_note: 'Best for 50 plus boards (lower is prototype pricing)',
    lead: leadDays(8, qty / 200 + 4, 2, 4), steps: ['Gerber and BOM review', 'PCB fabrication', 'Component procurement', 'SMT and through-hole assembly', 'Testing and programming'],
    inputs: [field('pcb_rate_per_cm2_layer', 'PCB rate', 'INR/cm2/layer'), field('bom_cost', 'Component cost per board (BOM)', 'INR'), field('smt_per_placement', 'SMT cost per placement', 'INR'), field('tht_per_joint', 'Through-hole cost per joint', 'INR'), field('stencil_setup', 'Stencil and setup (one-time)', 'INR'), field('test_cost', 'Testing per board', 'INR'), field('labour', 'Labour per piece', 'INR'), field('packaging', 'Packaging', 'INR/pc'), field('transport', 'Transport', 'INR/pc'), field('margin_pct', 'Manufacturer margin', '%')],
    values: o, fit: qty >= 50 ? 3 : 2 };
  const res = wrap(base, g, a, qty, o);
  if (a.electronics && a.electronics.needs_enclosure) res.notes = ['Enclosure is not included. Run the plastic or sheet metal route separately for the box.'];
  return res;
}

/* ---------- MAIN ---------- */
export function calcAll(a, qty, overrides) {
  qty = Math.max(1, Math.round(num(qty, 100)));
  const ov = overrides || {};
  const industry = a.industry;
  const mkey = MATERIALS[a.material_key] ? a.material_key : (industry === 'plastic' ? 'abs' : 'mild_steel');
  const fam = MATERIALS[mkey][1];
  const opts = [];
  const run = (key, fn, ...args) => { try { const r = fn(a, qty, ov[key] || {}, ...args); if (r) { r.id = key; opts.push(r); } } catch (e) { /* skip */ } };
  if (industry === 'metal' && fam === 'metal') {
    run('cnc', (aa, q, o) => cnc(aa, q, o, mkey, false));
    run('sheet', (aa, q, o) => sheetMetal(aa, q, o, mkey));
    run('cast_sand', (aa, q, o) => casting(aa, q, o, mkey, 'sand'));
    run('cast_investment', (aa, q, o) => casting(aa, q, o, mkey, 'investment'));
    run('cast_die', (aa, q, o) => casting(aa, q, o, mkey, 'die'));
    run('forging', (aa, q, o) => forging(aa, q, o, mkey));
    run('extrusion_metal', (aa, q, o) => extrusionMetal(aa, q, o, mkey));
    run('print_metal', (aa, q, o) => print3d(aa, q, o, mkey, false));
  } else if (industry === 'plastic' && fam === 'plastic') {
    run('injection', (aa, q, o) => injection(aa, q, o, mkey));
    run('blow', (aa, q, o) => blow(aa, q, o, mkey));
    run('extrusion_plastic', (aa, q, o) => extrusionPlastic(aa, q, o, mkey));
    run('print_plastic', (aa, q, o) => print3d(aa, q, o, mkey, true));
    run('vacuum', (aa, q, o) => vacuumCast(aa, q, o, mkey));
    run('cnc_plastic', (aa, q, o) => cnc(aa, q, o, mkey, true));
  } else if (industry === 'electronics') {
    run('pcba', (aa, q, o) => electronics(aa, q, o));
  }
  // recommendation: lowest unit cost among options that fit the quantity, else lowest overall
  const fits = opts.filter(o => o.fit >= 2);
  const pool = fits.length ? fits : opts;
  pool.sort((x, y) => x.unit - y.unit);
  const best = pool[0] || null;
  const cheapest = opts.slice().sort((x, y) => x.unit - y.unit)[0] || null;
  opts.forEach(o => { o.recommended = best && o.id === best.id; });
  return { qty, material_key: mkey, material_label: MATERIALS[mkey][0], options: opts, recommended_id: best ? best.id : null, cheapest_id: cheapest ? cheapest.id : null };
}

// price at other quantities for one process
export function breakEven(a, process, overrides, qtys) {
  return qtys.map(q => {
    const r = calcAll(a, q, overrides).options.find(o => o.id === process);
    return { qty: q, unit: r ? r.unit : null };
  });
}
