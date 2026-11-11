// dashboard/js/34-brokers-valuation.js — Brokers → Valuation (Angel One, Groww): the
// valuation the brokers-dashboard engine publishes after each ADR run
// (src/engine/valuation.py there; table sb_valuation_lines, read through
// /api/brokers?view=valuation). Three methods, triangulated by weight:
//   Regression  price = intercept + slope × 45-day ADR (plain least squares)
//   Ratio       mean ± 1 SD of price ÷ 45-day ADR, × the current quarter's ADR
// (both fitted over the Timeline window the reader picks; 'All' is the workbook's)
//   ADR         the PAT model's FY 2028 target price today (PAT Predictor tab)
// and the charts of AB's workbook ADR model sheets. This file lays the published
// lines out and computes nothing but chart lines from published parameters: the
// mean ± SD bands, and a window's fit line and implied price (slope × ADR + intercept);
// and, while the reader has edited the PAT Predictor's inputs (BRK_PAT_LIVE), the ADR
// method at those inputs with the net value and upside re-weighted (brkValReweight).
// The three weights are inputs too: the net value and upside are re-weighted on the page
// with the reader's weights (scaled to add up to 100 %), kept in memory per broker and run.

const BRK_VAL_METHODS = [['regression', 'Regression'], ['ratio', 'Ratio analysis'], ['adr', 'ADR (PAT model)']];
const BRK_VAL_SCEN = [['bear', 'Bear'], ['base', 'Base'], ['bull', 'Bull']];
// Timeline: the regression and ratio are fitted over the window, and the P/E bands drawn over it ('all' = the
// workbook's own window, the whole series). The engine publishes every window the data cover.
const BRK_VAL_WINDOWS = [['all', 'All'], ['3m', '3M'], ['6m', '6M'], ['1y', '1Y'], ['2y', '2Y'], ['3y', '3Y'], ['apr25', 'Since Apr 2025']];
BRK.valView = { win: 'all' };
// The method weights as the reader set them, per broker id: { run, w: { method: fraction } }. Kept only
// while they differ from the published weights; memory only, never saved.
const BRK_VAL_W = {};

function brkValIndex(rows) {
  const sum = {}, inputs = {}, common = {}, weight = {}, series = {}, pe = [], bands = {};
  rows.forEach(r => {
    if (r.section === 'weights') weight[r.period_key] = r;
    else if (r.section === 'summary') ((sum[r.period_key] = sum[r.period_key] || {})[r.line] = sum[r.period_key][r.line] || {})[r.scenario] = r;
    else if (r.section === 'inputs') (inputs[r.period_key] = inputs[r.period_key] || {})[r.line] = r;
    else if (r.section === 'common') common[r.line] = r;
    else if (r.section === 'series') (series[r.period_key] = series[r.period_key] || { date: r.period_key })[r.line] = r.value;
    else if (r.section === 'pe') pe.push({ date: r.period_key, pe: r.value, rule: r.rule });
    else if (r.section === 'pe_bands') (bands[r.period_key] = bands[r.period_key] || {})[r.line] = r;
  });
  const days = Object.values(series).sort((a, b) => (a.date < b.date ? -1 : 1));
  pe.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { sum, inputs, common, weight, days, pe, bands };
}

// The weighted net value and upside per scenario, with the ADR method's values replaced by
// `adr` (the PAT Predictor's target price today at the reader's inputs): the engine's
// triangulation (valuation.py triangulate: Σ weight × value) on the published weights.
// values: { method: { scenario: price } }; weights: { method: w }. Returns { adr, net, upside }.
function brkValReweight(values, weights, adr, close) {
  const out = { adr: { ...adr }, net: {}, upside: {} };
  BRK_VAL_SCEN.forEach(([s]) => {
    out.net[s] = BRK_VAL_METHODS.reduce((a, [m]) => a + weights[m] * (m === 'adr' ? adr[s] : values[m][s]), 0);
    out.upside[s] = out.net[s] / close - 1;
  });
  return out;
}

// The reader's weights { method: fraction } scaled to add up to 1, and what they added up to.
// All zero: scaled is null (no weighted value).
function brkValScale(w) {
  const sum = BRK_VAL_METHODS.reduce((a, [m]) => a + (w[m] || 0), 0);
  return { sum, scaled: sum > 0 ? Object.fromEntries(BRK_VAL_METHODS.map(([m]) => [m, (w[m] || 0) / sum])) : null };
}

// The weight inputs of the triangulation table: the net value, upside and their KPI tiles are
// re-weighted in place as the reader types (the charts don't depend on the weights).
// W: published weights; wst: the weights shown (edited in place); vals: each method's price per
// scenario (ADR leg at the PAT Predictor's inputs when patOn); ovr: brkValReweight at W, or null.
function brkValWeightInputs(root, { W, wst, vals, S, ovr, close, patOn, patLive, runId, broker }) {
  const ins = [...root.querySelectorAll('[data-vw]')];
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const pctTxt = x => `${fmtNum(x * 100, 0)} %`;
  const setInputs = () => ins.forEach(i => { i.value = String(+(wst[i.dataset.vw] * 100).toFixed(4)); });
  const paint = () => {
    const { sum, scaled } = brkValScale(wst);
    const edited = BRK_VAL_METHODS.some(([m]) => !near(wst[m], W[m]));
    const re = edited ? (scaled ? brkValReweight(vals, scaled, vals.adr, close) : null) : ovr;
    const fig = (line, s) => (re ? re[line][s] : edited ? null : S[line]?.[s]?.value ?? null);
    const why = re ? `recalculated on this page: Σ weight × price at ${edited
      ? `your weights ${BRK_VAL_METHODS.map(([m]) => fmtNum(wst[m] * 100, 0)).join(' / ')} %${near(sum, 1) ? '' : ' (scaled to 100 %)'}`
      : 'the published weights'}${patOn ? `, the ADR leg at the PAT Predictor's inputs (${patLive.desc})` : ''}` : '';
    root.querySelectorAll('[data-vv]').forEach(td => {
      const [line, s] = td.dataset.vv.split('|'), x = fig(line, s);
      td.textContent = x == null ? '—' : line === 'upside' ? rxSignedPct(x) : fmtNum(x, 2);
      td.classList.toggle('brk-pat-chg', !!re);
      if (line === 'upside') { td.classList.toggle('rx-up', x != null && x >= 0); td.classList.toggle('rx-dn', x != null && x < 0); }
      const rule = why || S[line]?.[s]?.rule || '';
      if (rule) td.title = rule; else td.removeAttribute('title');
    });
    const k = sel => root.querySelector(`[data-vk="${sel}"]`);
    const setK = (sel, html) => { const e = k(sel); if (e) e.innerHTML = html; };
    BRK_VAL_SCEN.forEach(([s]) => {
      const n = fig('net', s), u = fig('upside', s);
      setK(`net-${s}`, n == null ? '—' : rxRupee(n, 0));
      setK(`up-${s}`, u == null ? '—' : rxChangeHTML(u));
    });
    setK('lbl', re && (edited || patOn) ? 'Net value · base (your inputs)' : 'Net value · base');
    const sumCell = root.querySelector('[data-vsum]');
    sumCell.textContent = pctTxt(sum);
    sumCell.classList.toggle('brk-val-off', !near(sum, 1));
    if (near(sum, 1)) sumCell.removeAttribute('title'); else sumCell.title = 'The weights do not add up to 100 %: the net value uses them scaled to 100 %';
    ins.forEach(i => i.classList.toggle('is-edited', !near(wst[i.dataset.vw], W[i.dataset.vw])));
    root.querySelector('[data-val-reset]').disabled = !edited;
    root.querySelector('[data-val-state]').textContent = !edited ? `Published weights: ${BRK_VAL_METHODS.map(([m, l]) => `${l} ${pctTxt(W[m])}`).join(', ')}.`
      : !scaled ? 'Your weights add up to 0 %: there is no weighted value.'
        : `Showing your weights${near(sum, 1) ? '' : `, which add up to ${pctTxt(sum)} and are scaled to 100 %`}; the net value and upside are recalculated (tinted). Not saved.`;
    if (edited) BRK_VAL_W[broker] = { run: runId, w: { ...wst } }; else delete BRK_VAL_W[broker];
  };
  setInputs();
  paint();
  root.addEventListener('input', e => {
    const i = e.target.closest('[data-vw]');
    if (!i) return;
    const x = parseFloat(i.value);
    if (!isFinite(x) || x < 0 || x > 100) return;   // half-typed or out of range: keep the last good value
    wst[i.dataset.vw] = x / 100;
    paint();
  });
  root.querySelector('[data-val-reset]').addEventListener('click', () => {
    Object.assign(wst, W);
    setInputs();
    paint();
  });
}

// The window's first date, from its fit or P/E-band rule ("2026-08-06 to …")
function brkValSince(r) { return (/^(\d{4}-\d{2}-\d{2})/.exec(r?.rule || '') || [])[1] || ''; }

// The P/E bands to draw for a Timeline window, as band keys of `bands` (the published pe_bands by window).
// A window: its own band. All: the workbook's two Angel One windows (last 3 years, since Apr 2025) where the
// series covers them, else the whole series (band 'all': Groww, from its listing in Nov 2025).
function brkValPeWindows(win, bands) {
  if (win !== 'all') return bands[win] ? [win] : [];
  const wb = ['3y', 'apr25'].filter(k => bands[k]);
  return wb.length ? wb : bands.all ? ['all'] : [];
}

async function buildBrokersValuation() {
  const el = brkSection('val'), summary = BRK.summary;
  if (!BRK.val || BRK.valFor !== summary) {
    el.innerHTML = '<div class="brk-wrap"><div class="brk-empty">Loading the valuation…</div></div>';
    let val;
    try { val = await brkFetch('valuation', BRK.mode); } catch (err) {
      el.innerHTML = `<div class="brk-wrap"><div class="brk-empty">Couldn't load the valuation: ${escHtml(err.message)}</div></div>`;
      return;
    }
    if (BRK.summary !== summary) return;   // the broker or run changed meanwhile
    BRK.val = val; BRK.valFor = summary;
  }
  const val = BRK.val, name = escHtml(BRK_BROKER.name);
  if (!val.run || !val.rows.length) {
    el.innerHTML = `<div class="brk-wrap">${summary.run ? brkRunBar({ legend: false }) : ''}<div class="chart-panel brk-norun" role="status">
      <b>No valuation published for ${name} yet.</b>
      <p>${escHtml(val.reason || '')}. The brokers-dashboard engine publishes it to <code>sb_valuation_lines</code> after each ${escHtml(BRK.mode)} ADR run, with the PAT model; nothing is estimated on this page in the meantime.</p></div></div>`;
    return;
  }

  const X = brkValIndex(val.rows), st = BRK.valView;
  const avail = BRK_VAL_WINDOWS.filter(([k]) => X.sum[k] || X.bands[k]).map(([k]) => k);
  if (!avail.includes(st.win)) st.win = 'all';
  const win = st.win, fitWin = X.sum[win] ? win : 'all';   // a window only the P/E history covers keeps the All fit
  const S = X.sum[fitWin], I = { ...X.common, ...X.inputs[fitWin] };
  const inp = k => I[k]?.value ?? null;
  const close = inp('close'), closeOn = /close on (\d{4}-\d{2}-\d{2})/.exec(I.close?.rule || '');
  // The ADR method at the PAT Predictor's inputs, while the reader has edited them (BRK_PAT_LIVE, js/33)
  const patLive = BRK_PAT_LIVE[BRK_BROKER.id];
  const W = Object.fromEntries(BRK_VAL_METHODS.map(([m]) => [m, X.weight[m]?.value]));
  const complete = !!close && BRK_VAL_METHODS.every(([m]) => W[m] != null && BRK_VAL_SCEN.every(([s]) => S[m]?.[s]?.value != null));
  const patOn = !!(patLive?.edited && complete);
  // each method's price per scenario; the ADR leg at the PAT Predictor's inputs while those are edited
  const vals = complete ? Object.fromEntries(BRK_VAL_METHODS.map(([m]) => [m, Object.fromEntries(BRK_VAL_SCEN.map(([s]) =>
    [s, m === 'adr' && patOn ? patLive.targets[s] : S[m][s].value]))])) : null;
  const ovr = patOn ? brkValReweight(vals, W, vals.adr, close) : null;   // at the published weights
  // the weights as inputs (only with every method's figures published): the reader's, else the published
  const wSaved = BRK_VAL_W[BRK_BROKER.id];
  const wst = complete ? (wSaved && wSaved.run === val.run.run_id ? { ...wSaved.w } : { ...W }) : null;
  const v = (line, s) => (ovr && ovr[line] ? ovr[line][s] : S[line]?.[s]?.value ?? null);
  const ovrRule = line => (ovr && ovr[line] ? ` title="${escHtml(`recalculated on this page from the PAT Predictor tab's inputs (${patLive.desc})`)}"` : null);
  const winLabel = k => BRK_VAL_WINDOWS.find(w => w[0] === k)[1];
  const seg = `<div class="rx-seg" role="group" aria-label="Timeline" data-rx-seg="brkValWin">${BRK_VAL_WINDOWS.map(([k, l]) => {
    const on = avail.includes(k);
    return `<button type="button" data-value="${k}" aria-pressed="${k === win}"${on ? '' : ` disabled title="${escHtml(BRK_BROKER.name)}'s data do not cover ${l}"`}>${l}</button>`;
  }).join('')}</div>`;
  const fitSince = brkValSince(I.fit_days);
  const controls = `<div class="brk-price-controls"><div><div class="rx-lbl">Timeline</div>${seg}</div></div>
    <p class="rx-foot brk-price-foot">${win === 'all'
      ? `All: the workbook's window, every day with a 45-day ADR and a close (${escHtml(fmtLongDate(fitSince))} on).`
      : fitWin === win ? `${winLabel(win)}: the regression and the ratio bands are fitted over the days from ${escHtml(fmtLongDate(fitSince))}; the ADR leg does not depend on the window.`
        : `${winLabel(win)}: ${escHtml(BRK_BROKER.name)}'s daily ADR starts later than the window, so the regression and ratio stay on All (from ${escHtml(fmtLongDate(fitSince))}); the P/E band uses ${winLabel(win)}.`}
      Greyed-out periods start before the data do.</p>`;
  const sameRun = summary.run && summary.run.run_id === val.run.run_id;
  const view = BRK_BROKER.view, id = s => `brk-${view}-val-${s}`;
  const tip = (r, line) => (line && ovrRule(line)) || (r?.rule ? ` title="${escHtml(r.rule)}"` : '');
  const pct = w => `${fmtNum(w * 100, 0)} %`;

  // ── KPIs ──
  const kpis = [
    rxKpi('Share price', rxRupee(close, 2), closeOn ? `close on ${escHtml(fmtLongDate(closeOn[1]))}` : ''),
    rxKpi(`<span data-vk="lbl">${ovr ? 'Net value · base (your inputs)' : 'Net value · base'}</span>`, `<span data-vk="net-base">${rxRupee(v('net', 'base'), 0)}</span>`,
      v('upside', 'base') == null ? '' : `<span data-vk="up-base">${rxChangeHTML(v('upside', 'base'))}</span> vs the close`, { accent: true }),
    rxKpi('Bear – bull', `<span data-vk="net-bear">${rxRupee(v('net', 'bear'), 0)}</span> – <span data-vk="net-bull">${rxRupee(v('net', 'bull'), 0)}</span>`,
      `<span data-vk="up-bear">${rxChangeHTML(v('upside', 'bear'))}</span> to <span data-vk="up-bull">${rxChangeHTML(v('upside', 'bull'))}</span>`),
    rxKpi('Current ADR', `${rxCr(inp('adr_now'), 2)}<small> / day</small>`, escHtml((I.adr_now?.rule || '').replace(/^mean daily ADR \(broking \+ MTF\) over /, ''))),
    rxKpi('Regression R²', fmtNum(inp('r2'), 3), `${fmtNum(inp('fit_days'), 0)} days in the fit`),
  ].join('');

  // ── Triangulation ──
  const wCell = (m, lbl) => (wst
    ? `<td class="brk-val-w"><input class="rx-in rx-num-in" type="number" step="5" min="0" max="100" inputmode="decimal" data-vw="${m}" aria-label="Weight of ${escHtml(lbl)}, %"${X.weight[m]?.rule ? ` title="${escHtml(`published: ${pct(W[m])} · ${X.weight[m].rule}`)}"` : ''}><span class="brk-val-unit">%</span></td>`
    : `<td>${X.weight[m] ? pct(X.weight[m].value) : '—'}</td>`);
  const row = ([m, lbl]) => `<tr><td class="rx-l">${escHtml(lbl)}</td>${wCell(m, lbl)}${BRK_VAL_SCEN.map(([s]) =>
    `<td${tip(S[m]?.[s], m)}${ovr && ovr[m] ? ' class="brk-pat-chg"' : ''}>${v(m, s) == null ? '—' : fmtNum(v(m, s), 2)}</td>`).join('')}</tr>`;
  const triangulation = rxPanel({
    title: 'Valuation: three methods', meta: `₹ per share · ${escHtml(winLabel(fitWin))}${ovr ? ' · ADR method at the PAT Predictor\'s inputs' : ''} · hover a figure for its arithmetic`,
    body: `<div class="rx-scroll"><table class="rx-table brk-val-table">
      <thead><tr><th scope="col" class="rx-l">Method</th><th scope="col">Weight</th>${BRK_VAL_SCEN.map(([, l]) => `<th scope="col">${l}</th>`).join('')}</tr></thead>
      <tbody>${BRK_VAL_METHODS.map(row).join('')}
        <tr class="rx-sub"><td class="rx-l">Net value (weighted)</td><td data-vsum>100 %</td>${BRK_VAL_SCEN.map(([s]) => `<td data-vv="net|${s}"${tip(S.net?.[s], 'net')}${ovr ? ' class="brk-pat-chg"' : ''}>${fmtNum(v('net', s), 2)}</td>`).join('')}</tr>
        <tr><td class="rx-l">Upside vs the close</td><td></td>${BRK_VAL_SCEN.map(([s]) => { const u = v('upside', s); return `<td data-vv="upside|${s}" class="${u >= 0 ? 'rx-up' : 'rx-dn'}${ovr ? ' brk-pat-chg' : ''}"${tip(S.upside?.[s], 'upside')}>${rxSignedPct(u)}</td>`; }).join('')}</tr>
      </tbody></table></div>
      ${wst ? `<div class="brk-val-wbar"><button type="button" class="rx-btn" data-val-reset>Reset weights to published</button>
        <p class="rx-foot" data-val-state role="status" aria-live="polite"></p></div>` : ''}`,
    foot: `Regression: ${escHtml(I.slope ? `price = ${fmtNum(inp('slope'), 3)} × 45-day ADR + ${fmtNum(inp('intercept'), 2)}` : '—')}; bear / bull move the slope term by ∓ ${pct(inp('band') || 0)}.
      Ratio: price ÷ 45-day ADR, mean ${fmtNum(inp('ratio_mean'), 2)} ± 1 SD ${fmtNum(inp('ratio_sd'), 2)}, × the current ADR.
      ADR: the PAT Predictor tab's FY 2028 target price today (P/E × EPS, discounted)${ovr ? `, here at the inputs you set on that tab (${escHtml(patLive.desc)}), so the ADR row, the net value and the upside are recalculated on this page with the weights in the table; reset them there to see the published figures` : ''}.
      ${wst ? 'Weights: type your own and the net value and upside are recalculated on this page (Σ weight × price; weights that do not add up to 100 % are scaled to it); edits are not saved.' : ''}`,
    how: rxHow('Inputs and their source', `<div class="rx-scroll"><table class="rx-table">
      <tbody>${Object.values(I).sort((a, b) => a.sort_order - b.sort_order).map(r => `<tr><td class="rx-l">${escHtml(r.label)}</td><td>${r.unit === 'fraction' ? fmtNum(r.value, 3) : fmtNum(r.value, r.unit === 'days' ? 0 : 2)}</td><td class="rx-l rx-wrap">${escHtml(r.rule || '')}</td></tr>`).join('')}</tbody></table></div>
      <p class="rx-foot">The weights, band, 45-day window and series start are rows of <code>sb_assumptions</code> (key prefix <code>val_</code>) in the brokers-dashboard project, each naming its workbook cell.</p>`),
  });

  // ── Charts (the workbook's ADR model sheets) ──
  const since = win === 'all' ? '' : fitWin === win ? fitSince : (brkValSince(X.bands[win]?.pe_mean) || fitSince);
  const D = X.days.filter(d => d.dma != null && d.price != null && d.date >= (fitWin === win ? since : ''));
  const peP = rxPanel;
  const charts = [
    rxPanel({ cls: 'rx-col-half', title: 'Share price vs 45-day ADR', meta: '₹ (left) · ₹ Cr / day (right)', body: `<div class="rx-pb">${rxCanvas(id('line'))}<div data-brk-leg="line"></div></div>` }),
    rxPanel({ cls: 'rx-col-half', title: 'Share price vs 45-day ADR: fit', meta: escHtml(`price = ${fmtNum(inp('slope'), 2)} × ADR + ${fmtNum(inp('intercept'), 2)} · R² ${fmtNum(inp('r2'), 3)}`), body: `<div class="rx-pb">${rxCanvas(id('scatter'))}<div data-brk-leg="scatter"></div></div>` }),
    rxPanel({ cls: 'rx-col-half', title: 'Share price ÷ 45-day ADR', meta: 'mean ± 1 / 2 SD (population)', body: `<div class="rx-pb">${rxCanvas(id('ratio'))}<div data-brk-leg="ratio"></div></div>` }),
    rxPanel({ cls: 'rx-col-half', title: 'Actual vs regression-implied price', meta: '₹', body: `<div class="rx-pb">${rxCanvas(id('implied'))}<div data-brk-leg="implied"></div></div>` }),
  ];
  // P/E bands: the workbook's two windows under All (or the whole series where they are not covered), else the chosen one
  const peLabel = k => (k === '3y' ? 'last 3 years' : k === 'apr25' ? 'since Apr 2025'
    : k === 'all' ? `all days, from ${fmtLongDate(brkValSince(X.bands.all.pe_mean))}` : winLabel(k));
  const peWin = brkValPeWindows(win, X.bands).map(k => [k, peLabel(k)]);
  if (X.pe.length && peWin.length) {
    peWin.forEach(([k, l]) => charts.push(peP({ cls: 'rx-col-half', title: `Consolidated TTM P/E · ${l}`,
      meta: escHtml(`mean ${fmtNum(X.bands[k].pe_mean.value, 1)}× ± 1 / 2 SD ${fmtNum(X.bands[k].pe_sd.value, 1)} · ${X.bands[k].pe_mean.rule}`),
      body: `<div class="rx-pb">${rxCanvas(id('pe-' + k))}<div data-brk-leg="pe-${k}"></div></div>` })));
  }

  el.innerHTML = `<div class="brk-wrap">${summary.run ? brkRunBar({ legend: false }) : ''}<div class="rx">
    ${rxAlert(`<strong>Valuation, as the engine published it</strong> from ${name}'s daily ADR (run <code title="${escHtml(val.run.run_id)}">${escHtml(val.run.run_id.slice(0, 8))}</code>, as of ${escHtml(fmtLongDate(val.run.as_of_date))})${sameRun ? '' : ', an earlier run than the ADR tabs show: the valuation has not been published for the latest run yet'}. ${ovr ? `The ADR method uses the PAT Predictor tab's inputs as you edited them (${escHtml(patLive.desc)}): it, the net value and the upside are recalculated on this page; every other figure is the engine's.` : 'Every figure is the engine\'s; the page only draws chart lines from its published parameters.'}`, 'info')}
    ${controls}
    <section class="rx-kpis" aria-label="Valuation summary">${kpis}</section>
    ${triangulation}
    <div class="rx-row">${charts.join('')}</div>
  </div></div>`;
  const root = el.firstElementChild;
  rxOnSeg(root, 'brkValWin', k => { st.win = k; buildBrokersValuation(); });
  if (wst) brkValWeightInputs(root, { W, wst, vals, S, ovr, close, patOn, patLive, runId: val.run.run_id, broker: BRK_BROKER.id });

  const labels = D.map(r => fmtChartDate(r.date));
  const dateTitle = items => rxDate(D[items[0].dataIndex].date);
  const xTicks = dates => ({ grid: { display: false }, afterBuildTicks: brkMonthTicks(dates, 6), ticks: { maxTicksLimit: 6, maxRotation: 0, autoSkip: true } });
  const rupee = { ticks: { callback: x => '₹' + fmtNum(x, 0) } };

  rxChart(`brk-${view}-val-line`, id('line'), 260, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Share price', data: D.map(r => r.price), borderColor: RX.ink, borderWidth: 1.75, pointRadius: 0, tension: 0, yAxisID: 'y' },
      { label: '45-day ADR', data: D.map(r => r.dma), borderColor: RX.rev, borderWidth: 1.5, pointRadius: 0, tension: 0, yAxisID: 'y1' },
    ] },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { title: dateTitle, label: c => c.datasetIndex ? ` 45-day ADR ₹${fmtNum(c.raw, 2)} Cr` : ` Close ₹${fmtNum(c.raw, 2)}` } } },
      scales: { x: xTicks(D.map(r => r.date)), y: rupee, y1: { position: 'right', grid: { display: false }, ticks: { callback: x => fmtNum(x, 0) } } },
    },
  });
  root.querySelector('[data-brk-leg="line"]').innerHTML = rxLegend([
    { label: 'Share price (₹, left)', color: RX.ink, kind: 'line' }, { label: '45-day ADR (₹ Cr / day, right)', color: RX.rev, kind: 'line' }]);

  const xs = D.map(r => r.dma), xMin = Math.min(...xs), xMax = Math.max(...xs), last = D[D.length - 1];
  const fitAt = x => inp('slope') * x + inp('intercept');
  rxChart(`brk-${view}-val-scatter`, id('scatter'), 260, {
    type: 'scatter',
    data: { datasets: [
      { label: 'Day', data: D.map(r => ({ x: r.dma, y: r.price, date: r.date })), pointBackgroundColor: D.map((r, i) => RX.seq[Math.min(4, Math.floor(i / D.length * 5))]),
        pointBorderColor: '#FFFFFF', pointBorderWidth: 0.5, pointRadius: 3, pointHoverRadius: 5 },
      { label: 'Latest', data: [{ x: last.dma, y: last.price, date: last.date }], pointBackgroundColor: '#FFFFFF', pointBorderColor: RX.ink, pointBorderWidth: 2, pointRadius: 6 },
      { type: 'line', label: 'Fit', data: [{ x: xMin, y: fitAt(xMin) }, { x: xMax, y: fitAt(xMax) }], borderColor: RX.model, borderDash: [5, 3], borderWidth: 1.75, pointRadius: 0 },
    ] },
    options: {
      plugins: { tooltip: { filter: i => i.dataset.label !== 'Fit', callbacks: { title: items => rxDate(items[0].raw.date), label: c => ` 45-day ADR ₹${fmtNum(c.parsed.x, 2)} Cr · close ₹${fmtNum(c.parsed.y, 0)}` } } },
      scales: { x: { type: 'linear', grace: '4%', title: { display: true, text: '45-day ADR, ₹ Cr / day' } }, y: { grace: '4%', ...rupee } },
    },
  });
  root.querySelector('[data-brk-leg="scatter"]').innerHTML = rxLegend([
    { label: 'Older', color: RX.seq[0] }, { label: 'Recent', color: RX.seq[4] },
    { label: `Latest (${fmtTradeDate(last.date)})`, color: '#FFFFFF', style: `border:2px solid ${RX.ink};border-radius:50%;width:11px;height:11px` },
    { label: 'Fit', color: RX.model, kind: 'dash' }]);

  // mean ± 1 / 2 SD bands, drawn from a published mean and SD
  const bandChart = (key, canvasId, dates, values, m, sd, fmt, tipLabel) => {
    const flat = x => dates.map(() => x);
    const band = (lbl, x, fill, bg) => ({ label: lbl, data: flat(x), borderWidth: 0, pointRadius: 0, fill, backgroundColor: bg, tension: 0 });
    rxChart(key, canvasId, 260, {
      type: 'line',
      data: { labels: dates.map(fmtChartDate), datasets: [
        band('+2 SD', m + 2 * sd, { target: 4 }, 'rgba(43, 92, 200, 0.07)'),
        band('+1 SD', m + sd, { target: 3 }, 'rgba(43, 92, 200, 0.12)'),
        { label: 'Mean', data: flat(m), borderColor: RX.muted, borderWidth: 1, borderDash: [4, 3], pointRadius: 0, fill: false },
        band('−1 SD', m - sd, false, 'transparent'),
        band('−2 SD', m - 2 * sd, false, 'transparent'),
        { label: tipLabel, data: values, borderColor: RX.ink, borderWidth: 1.75, pointRadius: 0, tension: 0, fill: false },
      ] },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { filter: i => i.datasetIndex === 5, callbacks: {
          title: items => rxDate(dates[items[0].dataIndex]),
          label: c => { const z = (c.raw - m) / sd; return ` ${tipLabel} ${fmt(c.raw)} (${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)} SD)`; } } } },
        scales: { x: xTicks(dates), y: { ticks: { callback: x => fmtNum(x, 0) } } },
      },
    });
    return rxLegend([
      { label: tipLabel, color: RX.ink, kind: 'line' },
      { label: `± 1 SD (${fmtNum(m - sd, 1)}–${fmtNum(m + sd, 1)})`, color: 'rgba(43, 92, 200, 0.19)' },
      { label: `± 2 SD (${fmtNum(m - 2 * sd, 1)}–${fmtNum(m + 2 * sd, 1)})`, color: 'rgba(43, 92, 200, 0.07)', style: 'box-shadow:inset 0 0 0 1px #DCE5F7' },
      { label: `Mean ${fmtNum(m, 1)}`, color: RX.muted, kind: 'dash' }]);
  };
  root.querySelector('[data-brk-leg="ratio"]').innerHTML = bandChart(`brk-${view}-val-ratio`, id('ratio'), D.map(r => r.date), D.map(r => r.ratio),
    inp('ratio_mean'), inp('ratio_sd'), x => fmtNum(x, 2) + '×', 'Price ÷ 45-day ADR');

  rxChart(`brk-${view}-val-implied`, id('implied'), 260, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Actual', data: D.map(r => r.price), borderColor: RX.ink, borderWidth: 1.75, pointRadius: 0, tension: 0 },
      { label: 'Regression-implied', data: D.map(r => (fitWin === 'all' ? r.implied : fitAt(r.dma))), borderColor: RX.model, borderWidth: 1.5, borderDash: [5, 3], pointRadius: 0, tension: 0 },
    ] },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { title: dateTitle, label: c => ` ${c.dataset.label} ₹${fmtNum(c.raw, 0)}` } } },
      scales: { x: xTicks(D.map(r => r.date)), y: rupee },
    },
  });
  root.querySelector('[data-brk-leg="implied"]').innerHTML = rxLegend([
    { label: 'Actual share price', color: RX.ink, kind: 'line' }, { label: 'Regression-implied price', color: RX.model, kind: 'dash' }]);

  peWin.forEach(([k]) => {
    const b = X.bands[k], from = brkValSince(b.pe_mean);
    const P = X.pe.filter(r => r.date >= from);
    const leg = root.querySelector(`[data-brk-leg="pe-${k}"]`);
    if (leg) leg.innerHTML = bandChart(`brk-${view}-val-pe-${k}`, id('pe-' + k), P.map(r => r.date), P.map(r => r.pe),
      b.pe_mean.value, b.pe_sd.value, x => fmtNum(x, 1) + '×', 'Consolidated TTM P/E');
  });
}
