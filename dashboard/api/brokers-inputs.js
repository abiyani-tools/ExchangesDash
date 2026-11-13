/**
 * Vercel Serverless Function: /api/brokers-inputs
 *
 * The PAT Predictor's saved inputs (AB, 13 Nov 2026): QoQ growth of broking ADR and of MTF ADR,
 * P/E per scenario and the two discounts, kept as the broker's sb_assumptions rows in the
 * brokers-dashboard Supabase project, which its engine reads on every run. Both calls go to
 * that project's own functions (migrations 20261113_sb_pat_input_saves.sql and
 * 20261113_sb_pat_save_no_password.sql in abiyani-tools/brokersdashboard) with the publishable
 * key already used by /api/brokers (BROKERS_SUPABASE_KEY), so this function holds no secret of
 * its own. No password (AB, 13 Nov 2026): whoever saves last sets the inputs; the value ranges,
 * a guard of 30 Saves a minute and the log of every Save (with the values it replaced) are in
 * the database.
 *
 *   GET  /api/brokers-inputs?broker=GROWW
 *        → { inputs: { g, gm, gm_own, pe: [bear, base, bull], disc, today, saved_at } }
 *          (inputs: null when the database functions are not there yet)
 *   POST /api/brokers-inputs  { broker, inputs: { g, gm, pe, disc, today } }
 *        → { ok: true, inputs } or { ok: false, error } (400, or 429 for too many saves)
 *
 * Never cached (dashboard/vercel.json: no-store), so a Save shows on the next load.
 */

const DEFAULT_URL = 'https://everjfpbnlbcpuarnhob.supabase.co';
const BROKER = /^[A-Z0-9_]{2,32}$/;

async function rpc(fn, body) {
  const base = process.env.BROKERS_SUPABASE_URL || DEFAULT_URL;
  const key = process.env.BROKERS_SUPABASE_KEY;
  if (!key) throw Object.assign(new Error('BROKERS_SUPABASE_KEY is not set'), { status: 500 });
  const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Object.assign(new Error(`Supabase returned ${res.status} for ${fn}`), { status: 502, supabaseStatus: res.status });
  return res.json();
}

const num = v => (v == null ? null : Number(v));

function clean(x) {
  if (!x) return null;
  return { g: num(x.g), gm: num(x.gm), gm_own: !!x.gm_own, pe: Array.isArray(x.pe) ? x.pe.map(Number) : null,
    disc: num(x.disc), today: num(x.today), saved_at: x.saved_at || null };
}

// The error's HTTP status: too many saves 429, anything else the reader can fix 400
function statusOf(error) {
  return /too many/i.test(error) ? 429 : 400;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET') {
      const broker = String(req.query.broker || '').toUpperCase();
      if (!BROKER.test(broker)) return res.status(400).json({ error: 'Invalid broker' });
      let saved = null;
      try {
        saved = await rpc('sb_pat_saved_inputs', { p_broker: broker });
      } catch (err) {
        if (err.supabaseStatus !== 404) throw err;   // the database functions are not there yet
      }
      return res.status(200).json({ broker, inputs: clean(saved) });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      const broker = String(body?.broker || '').toUpperCase();
      const inp = body?.inputs || {};
      if (!BROKER.test(broker)) return res.status(400).json({ ok: false, error: 'Invalid broker' });
      const inputs = { g: num(inp.g), gm: num(inp.gm), pe: Array.isArray(inp.pe) ? inp.pe.map(Number) : null, disc: num(inp.disc), today: num(inp.today) };
      if ([inputs.g, inputs.gm, inputs.disc, inputs.today].some(v => v == null || !isFinite(v))
        || !inputs.pe || inputs.pe.length !== 3 || !inputs.pe.every(isFinite)) {
        return res.status(400).json({ ok: false, error: 'Every input needs a number' });
      }
      let out;
      try {
        out = await rpc('sb_save_pat_inputs', { p_broker: broker, p_inputs: inputs });
      } catch (err) {
        if (err.supabaseStatus === 404) return res.status(503).json({ ok: false, error: 'Saving is not set up in the database yet' });
        throw err;
      }
      if (!out?.ok) return res.status(statusOf(out?.error || '')).json({ ok: false, error: out?.error || 'Not saved' });
      return res.status(200).json({ ok: true, inputs: clean(out.saved) });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Use GET or POST' });
  } catch (err) {
    return res.status(err.status || 502).json({ ok: false, error: err.message });
  }
};

module.exports.clean = clean;         // tests/test_brokers_inputs_api.py
module.exports.statusOf = statusOf;
