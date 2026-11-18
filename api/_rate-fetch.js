// Helpers for the daily rate refresh. Pure functions, so they can be tested without the internet.
//
// A source's "config" (in the rate_sources table) looks like:
//  { "targets": [
//     { "table": "material",            // 'material' (rate_materials.rate_inr_kg) or 'setting' (rate_settings.value)
//       "key": "copper",
//       "path": "data.copper.price",    // json_api: where the number is in the JSON
//       "anchor": "Copper",             // html_anchor: the label text that must appear right before the number
//       "scale": 1,                     // multiply the number by this to get the stored unit (e.g. 0.01 to go from per quintal to per kg)
//       "min": 100, "max": 3000,        // the allowed range after scaling
//       "max_change_pct": 25 } ] }      // largest allowed change from the current stored value in one refresh

export const BLOCK_STATUS = new Set([401, 402, 403, 407, 429, 451]);
const LOGIN_WALL = /(log\s?in|sign\s?in)\s+to\s+(view|see|access)|login to view|please (log|sign) ?in|captcha|access denied|are you a robot/i;

// Decide what kind of problem a response is, before looking at the numbers.
export function classifyResponse(status, body) {
  if (BLOCK_STATUS.has(status)) return { status: 'blocked', message: `The source answered HTTP ${status}, which usually means it wants a login, a key, a licence or a slower pace.` };
  if (status >= 400) return { status: 'failed', message: `The source answered HTTP ${status}.` };
  if (!body || String(body).length < 50) return { status: 'failed', message: 'The source returned an empty page.' };
  return null;
}

export function readPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Find the first number after an anchor label in a page's text.
export function readAnchor(html, anchor) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
  const i = text.toLowerCase().indexOf(String(anchor).toLowerCase());
  if (i < 0) return { found: false };
  const after = text.slice(i + anchor.length, i + anchor.length + 120);
  const m = after.match(/-?\d[\d,]*\.?\d*/);
  if (!m) return { found: true, value: null };
  return { found: true, value: Number(m[0].replace(/,/g, '')) };
}

// Turn a fetched page into numbers. Returns { results:[{key,table,value}], problems:[{status,message}] }.
export function extractTargets(kind, raw, config) {
  const results = [], problems = [];
  let json = null;
  if (kind === 'json_api') { try { json = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return { results, problems: [{ status: 'format_changed', message: 'The source no longer returns valid JSON.' }] }; } }
  else if (LOGIN_WALL.test(String(raw).slice(0, 200000)) && !(config.targets || []).some(t => t.anchor && String(raw).toLowerCase().includes(String(t.anchor).toLowerCase()))) {
    return { results, problems: [{ status: 'blocked', message: 'The page now asks for a login or shows an access check.' }] };
  }
  for (const t of config.targets || []) {
    let v = null;
    if (kind === 'json_api') {
      const x = readPath(json, t.path);
      if (x === undefined) { problems.push({ status: 'format_changed', message: `Field "${t.path}" for ${t.key} is missing. The source format probably changed.` }); continue; }
      v = Number(x);
    } else {
      const r = readAnchor(raw, t.anchor);
      if (!r.found) { problems.push({ status: 'format_changed', message: `Label "${t.anchor}" for ${t.key} was not found on the page. The page layout probably changed.` }); continue; }
      v = r.value;
    }
    if (!Number.isFinite(v)) { problems.push({ status: 'format_changed', message: `No number could be read for ${t.key}.` }); continue; }
    results.push({ table: t.table, key: t.key, value: Math.round(v * (t.scale || 1) * 100) / 100, t });
  }
  return { results, problems };
}

// Reject a value that is outside its allowed range or jumped too much since the last stored value.
export function validateValue(r, current) {
  const t = r.t || {};
  if (Number.isFinite(t.min) && r.value < t.min) return `${r.key}: ${r.value} is below the allowed minimum ${t.min}.`;
  if (Number.isFinite(t.max) && r.value > t.max) return `${r.key}: ${r.value} is above the allowed maximum ${t.max}.`;
  if (Number.isFinite(t.max_change_pct) && Number(current) > 0) {
    const ch = Math.abs(r.value - current) / current * 100;
    if (ch > t.max_change_pct) return `${r.key}: moved ${ch.toFixed(1)}% in one refresh (from ${current} to ${r.value}), more than the allowed ${t.max_change_pct}%.`;
  }
  return null;
}
