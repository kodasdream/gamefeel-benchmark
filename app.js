/* ============================================================
   DATA: read at start-up from data/ and lab-icons/. build-benchmark.py writes these files from
   gamefeelbench.xlsx on Google Drive. Edit the spreadsheet, not the files.
   ============================================================ */
let DATA = [];
let ICONS = {};
let META = {};

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}
/* Minimal CSV reader: commas, quoted fields, doubled quotes, and line breaks inside quotes. */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((v) => v !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
/* A lab icon as the charts need it: its viewBox and inner markup, recoloured to currentColor. */
function parseIcon(svgText) {
  const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
  const inner = svg.innerHTML
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/fill="(?!none)[^"]*"/g, 'fill="currentColor"');
  return { vb: svg.getAttribute('viewBox') || '0 0 24 24', inner: inner.trim() };
}
async function loadData() {
  const [csv, labsCsv, meta] = await Promise.all([
    fetchText('data/gamefeelbench.csv'), fetchText('data/labs.csv'), fetchText('data/meta.json'),
  ]);
  const labs = Object.fromEntries(parseCSV(labsCsv).map((l) => [l.lab_key, l]));
  const slugs = [...new Set([...Object.values(labs).map((l) => l.icon), 'unknown'])];
  const icons = Object.fromEntries(await Promise.all(
    slugs.map(async (s) => [s, parseIcon(await fetchText(`lab-icons/${s}.svg`))]),
  ));
  const num = (v) => (v === '' ? null : Number(v));
  const rows = parseCSV(csv).map((r) => {
    const lab = labs[r.lab_key] || labs.unknown;
    return {
      id: [r.model, r.effort].filter(Boolean).join(' · '), model: r.model, effort: r.effort,
      lab: lab.lab, tint: lab.colour, icon: lab.icon,
      price: num(r.price_per_task_usd), basis: r.billing, context: r.context,
      timeMin: num(r.minutes_per_task), compress: num(r.context_compression_per_task),
      tps: num(r.tokens_per_second),
      openWeights: r.open_weights === 'yes', size: num(r.size_gb), sizeBasis: r.size_basis || '',
      reNote: r.re_test || '',   // set only on a result from the semi-private subset of the RE test
      ...Object.fromEntries(SCORE_KEYS.map((k) => [k, num(r[k === 're' ? 're_combined' : k])])),
      re_blind: num(r.re_blind), re_assisted: num(r.re_assisted), re_combined: num(r.re_combined),
    };
  });
  return { rows, icons, meta: JSON.parse(meta) };
}

/* ---------- constants ---------- */
const SCORE_KEYS = ['create', 'bugfix', 'gamefeel', 'ideas', 'visuals', 'audio', 're'];
const SCOPES = [
  ['overall', 'Overall'], ['create', 'Coding · create'], ['bugfix', 'Coding · bugfix'], ['gamefeel', 'Gamefeel'],
  ['ideas', 'Creativity · ideas'], ['visuals', 'Creativity · visuals'], ['audio', 'Creativity · audio'],
  ['re', 'Gamefeel · RE'],
];
const SCOPE_LABEL = Object.fromEntries(SCOPES);
// Overall averages RE combined only — the explorer's RE view toggle (blind/assisted) never changes that.
const SUBCATEGORY_LIST = SCOPES.slice(1).map(([k, l]) => (k === 're' ? `${l} (combined)` : l)).join(', ');   // the seven subcategories the overall averages
const TABS = [['overview', 'Overview'], ['explorer', 'Explorer'], ['profiles', 'Profiles'], ['speed', 'Speed'], ['ledger', 'Ledger']];
const BASIS_WORD = { sub: 'subscription', api: 'API', free: 'free' };
const PRICE_FLOOR = 0.02;          // free models are drawn at this price on the log axis
const HIGHLIGHTS = ['Qwen-4-27B-Early? (qoDuck)', 'Qwen-4-Flash-Early? (qoHawk)'];   // measured in purple against the frontier line
const HIGHLIGHT_NAMES = HIGHLIGHTS.join(' and ');
const HIGHLIGHT_TITLE = 'QWEN-4 HIGHLIGHT';
const isHighlight = (d) => HIGHLIGHTS.includes(d.model);
const HIGHLIGHT_SCOPES = new Set(['overall', 're']);   // price charts where it is left off the line
const NEW_MODELS = [];   // only the latest additions: a small NEW! over their columns, in the bar's colour (none this round: Gemini-4-Carbon High is already published)
const isNew = (d) => NEW_MODELS.includes(d.model);
const W = 1600;                    // figure width (ledger uses WL)
const WC = 2600;                   // bar charts: 24 columns side by side, wide enough for chunky bars
const WL = 2480;
const WP = 3400;                 // price-to-performance canvas: 2:1 (18:9), wider than the rest for room
const TOP = 280;                   // first content line, below the title block
const C = { ink: '#1b2434', soft: '#5a6478', faint: '#98a1b5', track: '#e6ebf5', azure: '#2b6cee', gold: '#c89600', zebra: '#f5f7fb', purple: '#9c27b0' };
const NONE = new Set();
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const standardTag = () => (META.standard ? ` · ${esc(META.standard).toUpperCase()}` : '');

/* ---------- derived fields (run once the data has loaded) ---------- */
function deriveFields() {
  DATA.forEach((d) => {
    d.complete = SCORE_KEYS.every((k) => d[k] != null);
    // the average is only for a model with all seven scores: a partial record has none
    d.avg = d.complete ? Math.round((SCORE_KEYS.reduce((a, k) => a + d[k], 0) / SCORE_KEYS.length) * 10) / 10 : null;
    d.free = d.price === 0;
    d.px = d.price == null ? null : Math.max(d.price, PRICE_FLOOR);   // no price: not drawn on a price chart
    d.value = d.avg != null && d.price > 0 ? Math.round((d.avg / d.price) * 10) / 10 : null;
  });
}
// Overall only ranks models with all seven scores (six scores plus Gamefeel RE combined). Subcategories rank any model with that score.
// The explorer's RE section can toggle between combined / blind / assisted. RE_VIEW is set by render() for that
// view only; renderExport() resets it to 'combined', so exports and every other tab always use the combined score.
const RE_VIEWS = ['combined', 'blind', 'assisted'];
const RE_FIELD = { combined: 're_combined', blind: 're_blind', assisted: 're_assisted' };
let RE_VIEW = 'combined';
const scoreOf = (d, scope) => (scope === 'overall' ? (d.complete ? d.avg : null)
  : scope === 're' ? (d[RE_FIELD[RE_VIEW]] ?? null) : (d[scope] ?? null));
// One column per model: keep the best-scoring reasoning effort. Callers pass rows sorted best-first.
const bestPerModel = (rows) => { const seen = new Set(); return rows.filter((d) => (seen.has(d.model) ? false : (seen.add(d.model), true))); };
const priceText = (d) => (d.price == null ? 'no price given' : d.free ? 'free' : `$${d.price.toFixed(2)}/task${d.basis ? ` · ${BASIS_WORD[d.basis] || d.basis}` : ''}`);
const priceLabel = (d) => (d.price == null ? 'no price' : d.free ? 'free' : `$${d.price.toFixed(2)}`);   // under a column
// A result from the semi-private subset of the RE test has a note (workbook column V) and an asterisk.
const shortName = (d) => d.model + (d.reNote ? '*' : '');
const modelEffort = (d) => [d.model, d.effort].filter(Boolean).join(' · ');
const namesOf = (rows) => [...new Set(rows.map((d) => d.model))].join(', ');
const RE_FULL = 'Every other result is the full RE test, over 8,000 tasks.';
const reFootnote = (rows) => `* ${namesOf(rows)}: ${[...new Set(rows.map((d) => d.reNote))].join('; ')}. ${RE_FULL}`;
const fmtScore = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const scopeTitle = (s) => (s === 'overall' ? 'OVERALL' : SCOPE_LABEL[s].toUpperCase());
const figTitle = (s) => (s === 're' ? `GAMEFEEL · RE (${RE_VIEW.toUpperCase()})` : scopeTitle(s));
const RE_TIP = {
  combined: '66% blind + 33% assisted — the score Overall uses',
  blind: 'No worked examples shown — the model rates the proposals cold',
  assisted: 'The model studies 39 rated worked examples before rating the rest',
};
const RE_LINES = {
  combined: [
    'Gamefeel Reverse-Evaluation (RE) combined score: the model\'s ability to give feedback on game proposals, especially balancing feedback.',
    'Combined = 66% blind + 33% assisted; assisted results get 39 rated examples to calibrate their feedback. Overall uses RE combined.',
    'A result with no assisted score gets a 1.5x boost on its blind share: combined = 0.66 × blind × 1.5 = 99% of blind, so it can still rank overall.',
  ],
  blind: [
    'Gamefeel Reverse-Evaluation (RE) blind score: the model\'s ability to give feedback on game proposals, especially balancing feedback.',
    'Blind: no worked examples shown — the model rates the game proposals cold. Overall uses RE combined, not this view.',
  ],
  assisted: [
    'Gamefeel Reverse-Evaluation (RE) assisted score: the model\'s ability to give feedback on game proposals, especially balancing feedback.',
    'Assisted: the model studies 39 rated worked examples as help for how to calibrate its feedback, then rates the rest. Overall uses RE combined, not this view.',
  ],
};
const reContextLine = () => (RE_VIEW === 'combined'
  ? 'Score = RE combined (66% blind + 33% assisted; a blind-only result gets a 1.5x boost on its 66% share). Overall uses this score.'
  : RE_VIEW === 'blind'
    ? 'Score = RE blind (no worked examples shown). Overall uses RE combined, not this view.'
    : 'Score = RE assisted (39 rated worked examples studied first). Overall uses RE combined, not this view.');

/* ---------- drawing helpers ---------- */
function iconSvg(d, x, y, size) {
  const ic = ICONS[d.icon] || ICONS.unknown;
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="${ic.vb}" color="${d.tint}" fill="currentColor">${ic.inner}</svg>`;
}
function iconHTML(d) {
  const ic = ICONS[d.icon] || ICONS.unknown;
  return `<span class="mico" style="color:${d.tint}"><svg viewBox="${ic.vb}" fill="currentColor" aria-hidden="true">${ic.inner}</svg></span>`;
}
function frame(w, h, title, lines) {
  let s = `<rect width="${w}" height="${h}" rx="36" fill="#ffffff"/>`;
  s += `<text x="64" y="74" font-size="22" font-weight="700" letter-spacing="5" fill="${C.faint}">THE GAMEFEEL BENCHMARK${standardTag()}</text>`;
  s += `<text x="64" y="140" font-size="60" font-weight="800" fill="${C.ink}">${esc(title)}</text>`;
  lines.forEach((t, i) => { s += `<text x="64" y="${188 + i * 36}" font-size="25" font-weight="500" fill="${C.soft}">${esc(t)}</text>`; });
  return s;
}
function emptyNote(w, y, text) {
  return `<text x="${w / 2}" y="${y}" font-size="26" font-weight="700" text-anchor="middle" fill="${C.faint}">${esc(text)}</text>`;
}
/* ---------- vertical columns: overview, scores and speed ---------- */
const COL = { axis: 120, label: 330, plot: 620 };   // left gutter for the scale, room under the axis for names, plot height
/* A column: square at the baseline, rounded at the data end (its top). */
function capPath(xl, xr, yTop, yBot, r) {
  const f = (n) => n.toFixed(1);
  return `M${f(xl)} ${f(yBot)}V${f(yTop + r)}Q${f(xl)} ${f(yTop)} ${f(xl + r)} ${f(yTop)}H${f(xr - r)}Q${f(xr)} ${f(yTop)} ${f(xr)} ${f(yTop + r)}V${f(yBot)}Z`;
}
/* The scale of one chart: 0 up to its largest value, so the tallest column reaches the top. Round
   gridlines sit well below that top, and the top itself is labelled with the value. */
function fitAxis(maxVal) {
  if (!(maxVal > 0)) return { max: 1, ticks: [0, 1] };   // every column is zero: a 0 to 1 scale, no loop
  const raw = maxVal / 6, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const ticks = [];
  for (let k = 0; k * step <= maxVal * 0.93 + 1e-9; k++) ticks.push(Number((k * step).toFixed(6)));
  return { max: maxVal, ticks: [...ticks, maxVal] };
}
/* One column per item, left to right in the order given. Items are { d, v, value, tip }.
   The value sits on each cap. Under the axis come the lab icon, effort and price, and the model
   name hangs diagonally below. Fewer models give wider columns. Returns the figure height and the
   body; the caller adds the frame. */
function columnChart(items, o) {
  if (!items.length) return { H: o.top + 700, body: emptyNote(WC, o.top + 200, o.empty) };
  const X0 = 64 + COL.axis, X1 = WC - 64, PW = X1 - X0;
  const yT = o.top + 70, yB = yT + COL.plot, H = yB + COL.label + 150;
  const Y = (v) => yB - (v / o.max) * COL.plot;
  const pitch = Math.min(PW / items.length, 220), bw = Math.min(pitch * 0.74, 160);
  // dense charts (every model at its best effort) shrink the cap labels so neighbours never collide
  const vFont = Math.min(30, Math.max(15, pitch * 0.45));
  const sFont = Math.min(20, Math.max(11, pitch * 0.26));
  const iSize = Math.min(40, pitch * 0.8);
  const x0 = X0 + (PW - pitch * items.length) / 2;
  let s = '';
  o.ticks.forEach((t) => {
    const y = Y(t).toFixed(1);
    s += `<line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${t === 0 ? C.ink : C.track}" stroke-opacity="${t === 0 ? 0.25 : 1}" stroke-width="2"/>`;
    s += `<text x="${X0 - 18}" y="${(Y(t) + 8).toFixed(1)}" font-size="22" font-weight="700" text-anchor="end" fill="${C.soft}">${t}</text>`;
  });
  s += `<text x="${X0 - 18}" y="${yT - 30}" font-size="20" font-weight="700" text-anchor="end" fill="${C.faint}">${esc(o.unit)}</text>`;
  items.forEach((it, i) => {
    const d = it.d, cx = x0 + pitch * (i + 0.5);
    const h = Math.max(6, (it.v / o.max) * COL.plot), top = yB - h;
    const nx = Math.max(cx + 12, 24 + textW(shortName(d), 23, 800) * Math.SQRT1_2);   // a long diagonal name stays inside the figure
    s += `<g class="col" data-m="${esc(d.id)}" data-tip="${esc([shortName(d), d.effort, d.lab, it.tip].filter(Boolean).join(' · '))}">`;
    s += `<rect x="${(cx - pitch / 2).toFixed(1)}" y="${yT - 60}" width="${pitch.toFixed(1)}" height="${COL.plot + COL.label + 60}" fill="transparent"/>`;
    s += `<path d="${capPath(cx - bw / 2, cx + bw / 2, top, yB, Math.min(8, bw / 2, h))}" fill="${d.tint}"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(top - 14).toFixed(1)}" font-size="${vFont.toFixed(1)}" font-weight="800" text-anchor="middle" fill="${C.ink}">${esc(it.value)}</text>`;
    if (isNew(d)) s += `<text x="${cx.toFixed(1)}" y="${(top - 52).toFixed(1)}" font-size="20" font-weight="800" letter-spacing="1" text-anchor="middle" fill="${d.tint}">NEW!</text>`;
    s += iconSvg(d, (cx - iSize / 2).toFixed(1), yB + 20, iSize);
    s += `<text x="${cx.toFixed(1)}" y="${yB + 92}" font-size="${sFont.toFixed(1)}" font-weight="700" text-anchor="middle" fill="${C.soft}">${esc(d.effort)}</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${yB + 120}" font-size="${sFont.toFixed(1)}" font-weight="600" text-anchor="middle" fill="${C.soft}">${priceLabel(d)}</text>`;
    s += `<text transform="translate(${nx.toFixed(1)} ${yB + 150}) rotate(-45)" font-size="23" font-weight="800" text-anchor="end" fill="${C.ink}">${esc(shortName(d))}</text>`;
    s += `</g>`;
  });
  return { H, body: s };
}

/* ---------- figure: overview ---------- */
function overviewFig(hidden) {
  const vis = DATA.filter((d) => !hidden.has(d.id));
  const rows = vis.filter((d) => d.complete).sort((a, b) => b.avg - a.avg);
  const partial = vis.filter((d) => !d.complete);
  const best = rows[0];
  const paid = rows.filter((d) => d.price > 0).sort((a, b) => a.price - b.price)[0];
  const fast = vis.filter((d) => d.tps != null).sort((a, b) => b.tps - a.tps)[0];
  const tiles = [
    ['BEST OVERALL', best ? best.avg.toFixed(1) : '—', best ? `${best.model} · ${best.effort}` : 'no model shown'],
    ['CHEAPEST PAID TASK', paid ? `$${paid.price.toFixed(2)}` : '—', paid ? `${paid.model} · ${paid.effort}` : 'no paid model shown'],
    ['FASTEST OUTPUT', fast ? `${fast.tps} tok/s` : '—', fast ? `${fast.model} · ${fast.effort}` : 'no model shown'],
  ];
  const TH = 150, tw = (WC - 128 - 48) / 3, y0 = TOP + TH + 40;
  // best on the right: the columns run from the lowest average on the left to the best on the right
  const chart = columnChart(rows.slice().reverse().map((d) => ({ d, v: d.avg, value: d.avg.toFixed(1), tip: `avg ${d.avg.toFixed(1)} · ${priceText(d)}` })),
    { top: y0, ...fitAxis(rows.length ? rows[0].avg : 1), unit: 'score', empty: 'No model is shown. Tick one on the left.' });
  const H = chart.H;
  let body = frame(WC, H, 'OVERALL · SCORES', [`Average of: ${SUBCATEGORY_LIST}`]);
  tiles.forEach(([label, value, sub], i) => {
    const x = 64 + i * (tw + 24), y = TOP;
    body += `<rect x="${x.toFixed(1)}" y="${y}" width="${tw.toFixed(1)}" height="${TH}" rx="26" fill="${C.zebra}"/>`;
    body += `<text x="${(x + 30).toFixed(1)}" y="${y + 42}" font-size="18" font-weight="700" letter-spacing="3" fill="${C.faint}">${label}</text>`;
    body += `<text x="${(x + 30).toFixed(1)}" y="${y + 102}" font-size="58" font-weight="800" fill="${C.ink}">${esc(value)}</text>`;
    body += `<text x="${(x + 30).toFixed(1)}" y="${y + 134}" font-size="20" font-weight="600" fill="${C.soft}">${esc(sub)}</text>`;
  });
  body += chart.body;
  if (partial.length) {
    body += `<text x="64" y="${H - 40}" font-size="20" font-weight="600" fill="${C.soft}">Not in overall (partial record): ${esc(partial.map((d) => `${d.model} ${d.effort}`).join(' · '))}</text>`;
  }
  return { W: WC, H, body, wide: true };
}

/* ---------- figure: scores columns (overall or one subcategory) ---------- */
function scoresFig(scope, hidden) {
  let rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null)
    .sort((a, b) => scoreOf(b, scope) - scoreOf(a, scope));
  if (scope === 're') rows = bestPerModel(rows);   // match the RE export: every model once, at its best reasoning effort
  const countNote = `One column per model at its best reasoning effort — showing all ${rows.length} models.`;
  const partial = scope === 'overall' ? DATA.filter((d) => !d.complete && !hidden.has(d.id)) : [];
  const lines = scope === 'overall'
    ? [`Average of: ${SUBCATEGORY_LIST}`]
    : scope === 're'
      ? [...RE_LINES[RE_VIEW], `The scale runs from 0 to the best score on this chart. Price per task is under each column. ${countNote}`]
      : [`${SCOPE_LABEL[scope]} score alone. The scale runs from 0 to the best score on this chart. Price per task is under each column.`, 'Only models with a score in this subcategory are listed.'];
  // best on the right: the columns run from the lowest score on the left to the best on the right
  const chart = columnChart(rows.slice().reverse().map((d) => { const v = scoreOf(d, scope); return { d, v, value: fmtScore(v), tip: `score ${fmtScore(v)} · ${priceText(d)}` }; }),
    { top: TOP, ...fitAxis(rows.length ? scoreOf(rows[0], scope) : 1), unit: 'score', empty: 'No model is shown for this view.' });
  const H = chart.H;
  let body = frame(WC, H, `${figTitle(scope)} · SCORES`, lines) + chart.body;
  if (partial.length) {
    body += `<text x="64" y="${H - 40}" font-size="20" font-weight="600" fill="${C.soft}">Not in overall (partial record): ${esc(partial.map((d) => `${d.model} ${d.effort}`).join(' · '))}. They appear in each subcategory they have a score in.</text>`;
  }
  const subset = rows.filter((d) => d.reNote);
  if (subset.length) body += `<text x="64" y="${H - 40}" font-size="20" font-weight="600" fill="${C.soft}">${esc(reFootnote(subset))}</text>`;
  return { W: WC, H, body, wide: true };
}

/* ---------- figure: the RE export — blind / assisted / combined as three bar charts stacked vertically ---------- */
function reStackedFig() {
  const sections = [
    ['re_blind', 'BLIND', 'No worked examples shown — the model rates the game proposals cold.'],
    ['re_assisted', 'ASSISTED', 'The model studies 39 rated worked examples as help for how to calibrate its feedback, then rates the rest.'],
    ['re_combined', 'COMBINED', '66% blind + 33% assisted. A model with no assisted score gets a 1.5x boost on its blind score so it can still rank overall.'],
  ];
  const GAP = 90;
  let body = '', top = TOP, H = TOP;
  for (const [key, label, desc] of sections) {
    const byScore = DATA.filter((d) => d[key] != null).sort((a, b) => b[key] - a[key]);
    const rows = bestPerModel(byScore).reverse();   // every model once at its best effort; lowest left, best right
    const note = `  All ${rows.length} models, each at its best reasoning effort.`;
    body += `<text x="64" y="${top + 26}" font-size="36" font-weight="800" fill="${C.ink}">${label}</text>`;
    body += `<text x="64" y="${top + 60}" font-size="21" font-weight="500" fill="${C.soft}">${esc(desc + note)}</text>`;
    const items = rows.map((d) => ({ d, v: d[key], value: fmtScore(d[key]), tip: `${label} ${fmtScore(d[key])} · ${priceText(d)}` }));
    const chart = columnChart(items, { top: top + 80, ...fitAxis(rows.length ? rows[rows.length - 1][key] : 1), unit: 'score', empty: `No model has a ${label.toLowerCase()} score yet.` });
    body += chart.body;
    top = chart.H + GAP;
    H = chart.H;
  }
  H = top - GAP + 60;
  const lines = [
    'Gamefeel Reverse-Evaluation (RE): the model\'s ability to give feedback on game proposals, especially balancing feedback.',
    'Assisted results get 39 rated examples as help for how they should calibrate their feedback. Overall uses RE combined only.',
    'Every model is shown once per chart, at its best reasoning effort.',
  ];
  return { W: WC, H, body: frame(WC, H, 'GAMEFEEL · RE', lines) + body, wide: true };
}

/* ---------- figure: price to performance (log price vs score) ---------- */
function paretoFront(rows, scope) {
  const sorted = [...rows].sort((a, b) => a.px - b.px || scoreOf(b, scope) - scoreOf(a, scope));
  const front = [];
  let best = -Infinity;
  for (const d of sorted) {
    if (scoreOf(d, scope) > best) { front.push(d); best = scoreOf(d, scope); }
  }
  return front;
}
/* The frontier line itself, as drawn (straight segments in log price): its score at a given price,
   and the price at which it reaches a given score. Null where the line does not reach. */
function lineScoreAt(front, scope, px) {
  for (let i = 0; i + 1 < front.length; i++) {
    const a = front[i], b = front[i + 1];
    if (px >= a.px && px <= b.px) {
      const t = Math.log(px / a.px) / Math.log(b.px / a.px);
      return scoreOf(a, scope) + t * (scoreOf(b, scope) - scoreOf(a, scope));
    }
  }
  return null;
}
function linePriceAt(front, scope, sc) {
  for (let i = 0; i + 1 < front.length; i++) {
    const a = front[i], b = front[i + 1], sa = scoreOf(a, scope), sb = scoreOf(b, scope);
    if (sc >= sa && sc <= sb) {
      const t = (sc - sa) / (sb - sa);
      return Math.exp(Math.log(a.px) + t * Math.log(b.px / a.px));
    }
  }
  return null;
}
/* Real glyph widths (in figure units) from the browser, so label boxes match the drawn text. */
const _measure = document.createElement('canvas').getContext('2d');
const textW = (t, size, weight) => {
  _measure.font = `${weight} ${size}px "Ubuntu Sans", "Segoe UI", system-ui, sans-serif`;
  return _measure.measureText(t).width;
};
/* Boxes for the purple marks, so that point labels keep clear of them (placeLabels takes them as marks). */
const markBox = (x0, x1, y0, y1) => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) });
const textBox = (t, size, weight, anchor, x, baseline) => {
  const w = textW(t, size, weight), left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
  return markBox(left - 6, left + w + 6, baseline - size * 0.8, baseline + size * 0.3);
};
/* Places each point label where it displaces least: nearest slot above or below the dot, on either side.
   A label must stay inside the plot and clear of every other label, dot and icon, and of every purple mark. */
const LABEL_STATS = { fallback: 0, purple: 0 };   // labels that found no clear slot (checked by the test run)
function placeLabels(pts, T, B, WP, marks = []) {
  const R = WP - 80, placed = [];
  const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const dots = pts.map((p) => ({ x0: p.x - 32, x1: p.x + 32, y0: p.y - 32, y1: p.y + 32 }));
  const boxFor = (p, right, ly) => {
    const iconX = right ? p.x + 44 : p.x - 84;
    const textX = right ? iconX + 50 : iconX - 10;
    const x0 = right ? iconX : textX - p.w, x1 = right ? textX + p.w : iconX + 40;
    return { iconX, textX, anchor: right ? 'start' : 'end', x0, x1, y: ly, y0: ly - 25, y1: ly + 10 };
  };
  [...pts].sort((a, b) => a.y - b.y).forEach((p) => {
    const sides = p.x + 100 + p.w <= R + 60 ? [true, false] : [false, true];
    let best = null;
    for (let k = 0; k <= 40 && !best; k++) {
      for (const dy of k === 0 ? [0] : [32 * k, -32 * k]) {
        for (const right of sides) {
          const ly = p.y + dy;
          if (ly < T + 16 || ly > B - 16) continue;
          const box = boxFor(p, right, ly);
          if (box.x0 < 40 || box.x1 > WP - 30) continue;
          if (placed.some((q) => hits(q, box))) continue;   // label boxes are 31 units tall
          if (dots.some((d) => hits(d, box))) continue;
          if (marks.some((m) => hits(m, box))) continue;   // the purple marks
          best = box;
          break;
        }
        if (best) break;
      }
    }
    if (!best) { best = boxFor(p, sides[0], p.y); LABEL_STATS.fallback++; }   // no free slot: stay beside the dot
    // Only the label's slot is stored on the point. p.y stays the point's own score position,
    // so the dot is never moved to the label's height.
    p.iconX = best.iconX; p.textX = best.textX; p.anchor = best.anchor; p.ly = best.y;
    placed.push(best);
  });
  return pts;
}
/* The purple marks of the highlight figures. Each Qwen-4 model has a bracket (from the middle of its dot down to the blue line)
   and a line across (from its price to the price the blue line expects for its score). Each label takes the first spot in
   its list that clears the purple lines, every dot, the other purple labels and the plot. */
const purpleText = (c) => `<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" font-size="26" font-weight="800" text-anchor="${c.anchor}" fill="${C.purple}">${esc(c.text)}</text>`;
const styleNote = (ms) => (ms.length > 1 ? ` Solid: ${ms[0].q.model}. Dashed: ${ms[1].q.model}.` : '');
function bracketSpots(m) {   // beside the bracket, at its middle; moved up or down if that spot is taken
  const mid = (m.yq + m.yFoot) / 2 + 8, out = [];
  for (const dy of [0, -36, 36, -72, 72]) {
    out.push({ text: m.bracketText, x: m.bx - 40, y: mid + dy, anchor: 'end' });
    out.push({ text: m.bracketText, x: m.bx + 40, y: mid + dy, anchor: 'start' });
  }
  return out;
}
function lineSpots(m) {   // above or below the line across, centred on it; then past its end, or before the dot
  const mx = (m.bx + m.xPrice) / 2, out = [];
  for (const y of [m.yq - 36, m.yq + 52, m.yq - 72, m.yq + 88, m.yq - 108, m.yq + 124]) out.push({ text: m.lineText, x: mx, y, anchor: 'middle' });
  out.push({ text: m.lineText, x: m.xPrice + 14, y: m.yq + 8, anchor: 'start' }, { text: m.lineText, x: m.bx - 14, y: m.yq + 8, anchor: 'end' });
  return out;
}
function placePurpleLabels(items, dotBoxes, bounds) {
  const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const boxes = [];   // every purple mark so far: the lines first, then each label as it is placed
  items.forEach((m) => {
    if (m.yFoot != null) boxes.push(markBox(m.bx - 8, m.bx + 8, m.yq, m.yFoot));
    if (m.xPrice != null) boxes.push(markBox(m.bx, m.xPrice, m.yq - 8, m.yq + 8));
  });
  const pick = (spots) => {
    for (const c of spots) {
      const box = textBox(c.text, 26, 800, c.anchor, c.x, c.y);
      const inside = box.x0 >= bounds.L && box.x1 <= bounds.R && box.y0 >= bounds.T && box.y1 <= bounds.B;
      if (inside && !boxes.some((b) => hit(b, box)) && !dotBoxes.some((b) => hit(b, box))) { boxes.push(box); return c; }
    }
    LABEL_STATS.purple++;   // no clear spot: the first choice
    const c = spots[0];
    boxes.push(textBox(c.text, 26, 800, c.anchor, c.x, c.y));
    return c;
  };
  const spots = items.map((m) => ({
    bracket: m.yFoot != null ? pick(bracketSpots(m)) : null,
    line: m.xPrice != null ? pick(lineSpots(m)) : null,
  }));
  return { spots, boxes };
}
function purpleMarks(items, placed) {   // the purple lines and labels; the second model's lines are dashed
  let out = '';
  items.forEach((m, i) => {
    const dash = i ? ' stroke-dasharray="14 10"' : '';
    if (m.yFoot != null) {
      out += `<line x1="${m.bx.toFixed(1)}" y1="${m.yFoot.toFixed(1)}" x2="${m.bx.toFixed(1)}" y2="${m.yq.toFixed(1)}" stroke="${C.purple}" stroke-width="5" stroke-linecap="round"${dash}/>`;
      out += purpleText(placed.spots[i].bracket);
    }
    if (m.xPrice != null) {
      out += `<line x1="${m.bx.toFixed(1)}" y1="${m.yq.toFixed(1)}" x2="${m.xPrice.toFixed(1)}" y2="${m.yq.toFixed(1)}" stroke="${C.purple}" stroke-width="5" stroke-linecap="round"${dash}/>`;
      out += purpleText(placed.spots[i].line);
    }
  });
  return out;
}
function ppFig(scope, hidden, highlight = false) {
  const L = 170, R = WP - 80, T = TOP + 30;
  const hl = highlight && HIGHLIGHT_SCOPES.has(scope);   // the Qwen highlight figure: Qwen off the blue line, measured in purple
  const title = `${figTitle(scope)} · PRICE TO PERFORMANCE${hl ? ` · ${HIGHLIGHT_TITLE}` : ''}`;
  const lines = [
    'Price per task against score, log scale. Up and to the left is cheaper and higher.',
    'Blue ring and line: pareto frontier, no model on it is both cheaper and higher. Dotted = effort levels.',
  ];
  if (scope === 're') lines.push(reContextLine());
  if (hl) lines.push(`${HIGHLIGHT_NAMES} are left off the blue line, so the purple lines can measure each against that line.`);
  const rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null && d.price != null);
  const unpriced = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null && d.price == null);
  if (!rows.length) return { W: WP, H: 600, body: frame(WP, 600, title, lines) + emptyNote(WP, 360, 'No model is shown for this view.') };

  // the highlight figure takes the Qwen-4 models off the blue line so the purple marks can measure them; every other chart includes them like any model
  const qs = hl ? rows.filter(isHighlight) : [];
  const front = paretoFront(rows.filter((d) => !qs.includes(d)), scope);
  const measures = qs.map((q) => ({ q, sq: scoreOf(q, scope), foot: lineScoreAt(front, scope, q.px), priceAt: linePriceAt(front, scope, scoreOf(q, scope)) }));
  const notes = [];
  for (const m of measures) {
    if (m.foot == null) notes.push(`The blue line does not reach the price of ${m.q.model}, so its gap to the line is not drawn.`);
    if (m.priceAt == null) notes.push(`The blue line does not reach a score of ${fmtScore(m.sq)}, so the price ${m.q.model} would be expected at is not drawn.`);
  }
  if (measures.length) notes.push(`Purple: how far each Qwen-4 model sits above the blue line at its price (the bracket), and the line across at its score, from its price to the price the blue line expects. The length of that line is how much cheaper it is.${styleNote(measures)}`);
  if (unpriced.length) notes.push(`Not shown, no price given: ${namesOf(unpriced)}.`);
  const noteLines = notes.flatMap((t) => wrapText(t, 22, 600, WP - 128));
  const B = 1530, H = 1700 + 36 * Math.max(0, noteLines.length - 1);
  const ys = rows.map((d) => scoreOf(d, scope));
  const x0 = Math.min(...rows.map((d) => d.px)) / 1.8, x1 = Math.max(...rows.map((d) => d.px)) * 1.8;
  // score axis fitted to the data in steps of 5: the points get the height, not empty space
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 6) / 5) * 5);
  const y1 = Math.min(100, Math.max(y0 + 20, Math.ceil((Math.max(...ys) + 4) / 5) * 5));
  const yStep = y1 - y0 <= 50 ? 5 : 10;
  const X = (v) => L + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * (R - L);
  const Y = (v) => B - ((v - y0) / (y1 - y0)) * (B - T);
  let s = '';

  // iso-value curves: score = k * price, i.e. k points per dollar
  const ratios = rows.map((d) => scoreOf(d, scope) / d.px);
  const lo = Math.min(...ratios) / 2, hi = Math.max(...ratios) * 2;
  for (const k of [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].filter((k) => k >= lo && k <= hi)) {
    let p = '';
    for (let i = 0; i <= 80; i++) {
      const pr = x0 * Math.pow(x1 / x0, i / 80), sc = k * pr;
      if (sc >= y0 && sc <= y1) p += (p ? 'L' : 'M') + X(pr).toFixed(1) + ' ' + Y(sc).toFixed(1);
    }
    if (!p) continue;
    s += `<path d="${p}" fill="none" stroke="${C.gold}" stroke-opacity=".4" stroke-width="2.5" stroke-dasharray="6 9"/>`;
    const ex = Math.min(x1, y1 / k), ey = k * ex;
    if (ex >= x0 && ey >= y0) s += `<text x="${(X(ex) + 10).toFixed(1)}" y="${(Y(ey) - 10).toFixed(1)}" font-size="17" font-weight="700" fill="${C.gold}" fill-opacity=".85">${k} pts/$</text>`;
  }

  // axes and grid
  s += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="${C.ink}" stroke-opacity=".2" stroke-width="2"/>`;
  s += `<line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="${C.ink}" stroke-opacity=".2" stroke-width="2"/>`;
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    s += `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${R}" y2="${Y(v).toFixed(1)}" stroke="${C.ink}" stroke-opacity=".06" stroke-width="2"/>`;
    s += `<text x="${L - 18}" y="${(Y(v) + 8).toFixed(1)}" font-size="22" font-weight="700" text-anchor="end" fill="${C.soft}">${v}</text>`;
  }
  for (const t of [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]) {
    if (t < x0 || t > x1) continue;
    s += `<line x1="${X(t).toFixed(1)}" y1="${B}" x2="${X(t).toFixed(1)}" y2="${B + 10}" stroke="${C.ink}" stroke-opacity=".3" stroke-width="2"/>`;
    s += `<text x="${X(t).toFixed(1)}" y="${B + 42}" font-size="22" font-weight="700" text-anchor="middle" fill="${C.soft}">$${t}</text>`;
  }
  s += `<text x="${(L + R) / 2}" y="${B + 86}" font-size="22" font-weight="600" text-anchor="middle" fill="${C.soft}">price per task (log scale) · free models are drawn at $0.02</text>`;
  s += `<text x="34" y="${(T + B) / 2}" font-size="22" font-weight="600" text-anchor="middle" fill="${C.soft}" transform="rotate(-90 34 ${(T + B) / 2})">score (out of 100)</text>`;

  // pareto frontier: straight segments between the non-dominated points
  // the blue line is the frontier of the rows that are not left off it (see the measures above)
  if (front.length > 1) {
    s += `<path d="${front.map((d, i) => (i ? 'L' : 'M') + X(d.px).toFixed(1) + ' ' + Y(scoreOf(d, scope)).toFixed(1)).join('')}" fill="none" stroke="${C.azure}" stroke-width="6" stroke-linejoin="round" opacity=".85"/>`;
  }
  // purple, highlight figure only: each Qwen-4 model gets a bracket from the middle of its dot straight down to the blue line directly below it
  // (the dot covers its top), and a line across at its score, from its price to the price the blue line expects
  const dotBoxes = rows.map((d) => ({ x0: X(d.px) - 32, x1: X(d.px) + 32, y0: Y(scoreOf(d, scope)) - 32, y1: Y(scoreOf(d, scope)) + 32 }));
  const items = measures.map((m) => ({
    bx: X(m.q.px), yq: Y(m.sq), yFoot: m.foot != null ? Y(m.foot) : null, xPrice: m.priceAt != null ? X(m.priceAt) : null,
    bracketText: m.foot != null ? `${m.q.model}: +${(m.sq - m.foot).toFixed(1)} ahead for its cost` : '',
    lineText: m.priceAt != null ? `${m.q.model}: $${m.priceAt.toFixed(2)} expected · ${(m.priceAt / m.q.price).toFixed(1)}× cheaper` : '',
  }));
  const placed = placePurpleLabels(items, dotBoxes, { L, R, T, B });
  const marks = placed.boxes;   // the purple marks; point labels keep clear of them
  s += purpleMarks(items, placed);
  // same model at several effort levels: a dotted line joins them
  const fam = {};
  rows.forEach((d) => { (fam[d.model] = fam[d.model] || []).push(d); });
  Object.values(fam).forEach((g) => {
    if (g.length < 2) return;
    const seq = [...g].sort((a, b) => a.px - b.px);
    s += `<path d="${seq.map((d, i) => (i ? 'L' : 'M') + X(d.px).toFixed(1) + ' ' + Y(scoreOf(d, scope)).toFixed(1)).join('')}" fill="none" stroke="${g[0].tint}" stroke-opacity=".6" stroke-width="4" stroke-dasharray="2 10" stroke-linecap="round"/>`;
  });

  const pts = placeLabels(rows.map((d) => {
    const sc = scoreOf(d, scope), text = `${d.model} (${d.effort})  ${fmtScore(sc)}`;
    return { d, x: X(d.px), y: Y(sc), sc, text, w: textW(text, 28, 800) + 6 };
  }), T, B, WP, marks);
  pts.forEach((p) => {
    const d = p.d;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${d.model} · ${d.effort} · ${priceText(d)} · score ${fmtScore(p.sc)}`)}">`;
    if (front.includes(d)) s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="30" fill="none" stroke="${C.azure}" stroke-width="5"/>`;
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="26" fill="${d.tint}" fill-opacity=".15"/>`;
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="${d.tint}"/>`;
    if (Math.abs(p.ly - p.y) > 18) s += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.iconX + 20}" y2="${p.ly}" stroke="${C.faint}" stroke-width="2"/>`;
    s += iconSvg(d, p.iconX, p.ly - 20, 40);
    s += `<text x="${p.textX}" y="${p.ly + 10}" font-size="28" font-weight="800" text-anchor="${p.anchor}" fill="${C.ink}" stroke="#ffffff" stroke-width="7" paint-order="stroke">${esc(d.model)} <tspan font-weight="600" fill="${C.soft}">(${esc(d.effort)})</tspan> <tspan font-weight="700" fill="${C.soft}">${fmtScore(p.sc)}</tspan></text>`;
    s += `</g>`;
  });
  noteLines.forEach((t, i) => { s += `<text x="64" y="${B + 130 + 36 * i}" font-size="22" font-weight="600" fill="${C.soft}">${esc(t)}</text>`; });
  return { W: WP, H, body: frame(WP, H, title, lines) + s, wide: true };
}

// splits a footnote into lines no wider than maxW, measured in the figure's own units
function wrapText(t, size, weight, maxW) {
  const out = [];
  let cur = '';
  for (const word of t.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textW(next, size, weight) > maxW) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------- figure: size to performance (log model size vs score; open-weight models with a size only) ---------- */
function sizeFig(scope, hidden, highlight = false) {
  const title = `${figTitle(scope)} · SIZE TO PERFORMANCE${highlight ? ` · ${HIGHLIGHT_TITLE}` : ''}`;
  const lines = [
    'Model size against score, log scale. Up and to the left is smaller and higher.',
    'Open-weight models with a recorded size only. Blue ring and line: pareto frontier, no model on it is both smaller and higher.',
  ];
  if (scope === 're') lines.push(reContextLine());
  if (highlight) lines.push(`${HIGHLIGHT_NAMES} are left off the blue line (purple rings), so the purple lines measure each against the line only where the line reaches it.`);
  const shown = DATA.filter((d) => !hidden.has(d.id) && d.openWeights && d.size != null && scoreOf(d, scope) != null);
  if (!shown.length) return { W: WP, H: 600, body: frame(WP, 600, title, lines) + emptyNote(WP, 360, 'No open-weight model with a size is shown for this view.') };
  const rows = shown.map((d) => ({ ...d, px: d.size }));     // paretoFront reads px as the cost; here the cost is the size
  const qs = highlight ? rows.filter(isHighlight) : [];   // only the highlight figure takes Qwen off the line
  const front = paretoFront(rows.filter((d) => !qs.includes(d)), scope);

  // footnotes: the sizes with their quantization, what is still missing, what the line cannot measure, and the purple marks
  const notes = [`Sizes: ${rows.map((d) => `${d.model} ${d.size} GB${d.sizeBasis ? ` (${d.sizeBasis})` : ''}`).join('; ')}.`];
  const unsized = [...new Set(DATA.filter((d) => !hidden.has(d.id) && d.openWeights && d.size == null).map((d) => d.model))];
  if (unsized.length) notes.push(`Not shown, open weights but no size yet: ${unsized.join(', ')}.`);
  const measures = qs.map((q) => ({ q, sq: scoreOf(q, scope), foot: lineScoreAt(front, scope, q.px), priceAt: linePriceAt(front, scope, scoreOf(q, scope)) }));
  for (const m of measures) {
    if (m.foot == null) notes.push(`The blue line does not reach ${m.q.size} GB, so it cannot measure ${m.q.model} at its size.`);
    if (m.priceAt == null) notes.push(`The blue line does not reach a score of ${fmtScore(m.sq)}, so the size ${m.q.model} would be expected at is not drawn.`);
  }
  if (measures.length) notes.push(`Purple: how far each Qwen-4 model sits above the blue line at its size (the bracket), and the line across at its score, from its size to the size the line expects.${styleNote(measures)}`);
  const noteLines = notes.flatMap((t) => wrapText(t, 22, 600, WP - 128));
  const B = 1530, H = B + 170 + 36 * noteLines.length, T = TOP + 30, L = 170, R = WP - 80;
  const xs = rows.map((d) => d.size), ys = rows.map((d) => scoreOf(d, scope));
  const x0 = Math.min(...xs) / 1.8, x1 = Math.max(...xs) * 1.8;
  // score axis fitted to the data in steps of 5, as in the price chart
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 6) / 5) * 5);
  const y1 = Math.min(100, Math.max(y0 + 20, Math.ceil((Math.max(...ys) + 4) / 5) * 5));
  const yStep = y1 - y0 <= 50 ? 5 : 10;
  const X = (v) => L + ((Math.log10(v) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0))) * (R - L);
  const Y = (v) => B - ((v - y0) / (y1 - y0)) * (B - T);
  let s = '';

  // axes and grid
  s += `<line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="${C.ink}" stroke-opacity=".2" stroke-width="2"/>`;
  s += `<line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="${C.ink}" stroke-opacity=".2" stroke-width="2"/>`;
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1; v += yStep) {
    s += `<line x1="${L}" y1="${Y(v).toFixed(1)}" x2="${R}" y2="${Y(v).toFixed(1)}" stroke="${C.ink}" stroke-opacity=".06" stroke-width="2"/>`;
    s += `<text x="${L - 18}" y="${(Y(v) + 8).toFixed(1)}" font-size="22" font-weight="700" text-anchor="end" fill="${C.soft}">${v}</text>`;
  }
  for (const t of [10, 20, 50, 100, 200, 500, 1000, 2000]) {
    if (t < x0 || t > x1) continue;
    s += `<line x1="${X(t).toFixed(1)}" y1="${B}" x2="${X(t).toFixed(1)}" y2="${B + 10}" stroke="${C.ink}" stroke-opacity=".3" stroke-width="2"/>`;
    s += `<text x="${X(t).toFixed(1)}" y="${B + 42}" font-size="22" font-weight="700" text-anchor="middle" fill="${C.soft}">${t} GB</text>`;
  }
  s += `<text x="${(L + R) / 2}" y="${B + 86}" font-size="22" font-weight="600" text-anchor="middle" fill="${C.soft}">model size (GB, log scale)</text>`;
  s += `<text x="34" y="${(T + B) / 2}" font-size="22" font-weight="600" text-anchor="middle" fill="${C.soft}" transform="rotate(-90 34 ${(T + B) / 2})">score (out of 100)</text>`;

  // pareto frontier: straight segments between the non-dominated points, in log size
  if (front.length > 1) {
    s += `<path d="${front.map((d, i) => (i ? 'L' : 'M') + X(d.px).toFixed(1) + ' ' + Y(scoreOf(d, scope)).toFixed(1)).join('')}" fill="none" stroke="${C.azure}" stroke-width="6" stroke-linejoin="round" opacity=".85"/>`;
  }
  // purple, highlight figure only, as in the price chart: each Qwen-4 model's bracket and line across, labels placed where they clear everything
  const dotBoxes = rows.map((d) => ({ x0: X(d.px) - 32, x1: X(d.px) + 32, y0: Y(scoreOf(d, scope)) - 32, y1: Y(scoreOf(d, scope)) + 32 }));
  const items = measures.map((m) => ({
    bx: X(m.q.px), yq: Y(m.sq), yFoot: m.foot != null ? Y(m.foot) : null, xPrice: m.priceAt != null ? X(m.priceAt) : null,
    bracketText: m.foot != null ? `${m.q.model}: +${(m.sq - m.foot).toFixed(1)} ahead for its size` : '',
    lineText: m.priceAt != null ? `${m.q.model}: ${Math.round(m.priceAt)} GB expected · ${(m.priceAt / m.q.size).toFixed(1)}× smaller` : '',
  }));
  const placed = placePurpleLabels(items, dotBoxes, { L, R, T, B });
  const marks = placed.boxes;   // point labels keep clear of the purple marks
  s += purpleMarks(items, placed);
  const pts = placeLabels(rows.map((d) => {
    const sc = scoreOf(d, scope), text = `${d.model} (${d.effort})  ${fmtScore(sc)}  ${d.size} GB`;
    return { d, x: X(d.px), y: Y(sc), sc, text, w: textW(text, 28, 800) + 6 };
  }), T, B, WP, marks);
  pts.forEach((p) => {
    const d = p.d;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${d.model} · ${d.effort} · ${d.size} GB · score ${fmtScore(p.sc)}`)}">`;
    if (front.includes(d)) s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="30" fill="none" stroke="${C.azure}" stroke-width="5"/>`;
    if (qs.includes(d)) s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="30" fill="none" stroke="${C.purple}" stroke-width="5"/>`;
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="26" fill="${d.tint}" fill-opacity=".15"/>`;
    s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="13" fill="${d.tint}"/>`;
    if (Math.abs(p.ly - p.y) > 18) s += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.iconX + 20}" y2="${p.ly}" stroke="${C.faint}" stroke-width="2"/>`;
    s += iconSvg(d, p.iconX, p.ly - 20, 40);
    s += `<text x="${p.textX}" y="${p.ly + 10}" font-size="28" font-weight="800" text-anchor="${p.anchor}" fill="${C.ink}" stroke="#ffffff" stroke-width="7" paint-order="stroke">${esc(d.model)} <tspan font-weight="600" fill="${C.soft}">(${esc(d.effort)})</tspan> <tspan font-weight="700" fill="${C.soft}">${fmtScore(p.sc)}</tspan> <tspan font-weight="600" fill="${C.soft}">${d.size} GB</tspan></text>`;
    s += `</g>`;
  });
  noteLines.forEach((t, i) => { s += `<text x="64" y="${B + 130 + 36 * i}" font-size="22" font-weight="600" fill="${C.soft}">${esc(t)}</text>`; });
  return { W: WP, H, body: frame(WP, H, title, lines) + s, wide: true };
}

/* ---------- figure: profiles (radar) ---------- */
function radarFig(ids, hidden) {
  const H = 1000, cx = 520, cy = 590, R = 280;
  const AX = [['create', 'coding · create'], ['bugfix', 'coding · bugfix'], ['gamefeel', 'gamefeel'],
    ['ideas', 'creativity · ideas'], ['visuals', 'creativity · visuals'], ['audio', 'creativity · audio'],
    ['re', 'gamefeel · RE']];
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / AX.length;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const sel = DATA.filter((d) => ids.includes(d.id) && !hidden.has(d.id));
  const lines = [
    'Seven scores as one shape per model. Rings are 20 points apart, out to 100.',
    'Pick models with the chips above. The list on the right shows each model’s strongest score.',
  ];
  let s = '';
  const ringPath = (r) => AX.map((_, i) => { const [x, y] = pt(i, r); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('') + 'Z';
  for (let ring = 1; ring <= 5; ring++) {
    s += `<path d="${ringPath((R * ring) / 5)}" fill="none" stroke="${C.ink}" stroke-opacity=".1" stroke-width="2"/>`;
    const [tx, ty] = pt(0, (R * ring) / 5);
    s += `<text x="${(tx + 10).toFixed(1)}" y="${(ty - 6).toFixed(1)}" font-size="17" font-weight="700" fill="${C.faint}">${ring * 20}</text>`;
  }
  AX.forEach(([, label], i) => {
    const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 64), c = Math.cos(ang(i));
    s += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.ink}" stroke-opacity=".12" stroke-width="2"/>`;
    const anchor = Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end';
    s += `<text x="${lx.toFixed(1)}" y="${(ly + 7).toFixed(1)}" font-size="22" font-weight="700" text-anchor="${anchor}" fill="${C.soft}">${esc(label)}</text>`;
  });
  sel.forEach((d) => {
    const poly = AX.map(([k], i) => { const [x, y] = pt(i, (R * (d[k] ?? 0)) / 100); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }).join('') + 'Z';
    s += `<g data-m="${esc(d.id)}"><path d="${poly}" fill="${d.tint}" fill-opacity=".1" stroke="${d.tint}" stroke-width="4" stroke-linejoin="round"/>`;
    AX.forEach(([k, label], i) => {
      if (d[k] == null) return;
      const [x, y] = pt(i, (R * d[k]) / 100);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="${d.tint}" data-tip="${esc(`${d.model} · ${d.effort} · ${label}: ${d[k]}`)}"/>`;
    });
    s += `</g>`;
  });
  const px = 1010;
  s += `<text x="${px}" y="${TOP + 10}" font-size="22" font-weight="800" letter-spacing="3" fill="${C.faint}">SELECTED · ${sel.length}</text>`;
  if (!sel.length) s += `<text x="${px}" y="${TOP + 60}" font-size="24" font-weight="600" fill="${C.soft}">Pick models with the chips above.</text>`;
  sel.slice(0, 10).forEach((d, i) => {
    const y = TOP + 50 + i * 60;
    const best = AX.filter(([k]) => d[k] != null).sort((a, b) => d[b[0]] - d[a[0]])[0];
    s += `<g data-m="${esc(d.id)}">`;
    s += iconSvg(d, px, y - 14, 44);
    s += `<text x="${px + 62}" y="${y + 6}" font-size="26" font-weight="800" fill="${C.ink}">${esc(d.model)}<tspan font-size="19" font-weight="700" fill="${C.soft}">  ${esc(d.effort)}</tspan></text>`;
    s += `<text x="${px + 62}" y="${y + 30}" font-size="18" font-weight="600" fill="${C.soft}">strongest: ${esc(best ? best[1] : '—')}</text>`;
    s += `<text x="1536" y="${y + 18}" font-size="40" font-weight="800" text-anchor="end" fill="${C.ink}">${d.complete ? d.avg.toFixed(1) : 'partial'}</text>`;
    s += `</g>`;
  });
  if (sel.length > 10) s += `<text x="${px}" y="${TOP + 50 + 10 * 60}" font-size="20" font-weight="600" fill="${C.faint}">+ ${sel.length - 10} more not listed</text>`;
  return { W, H, body: frame(W, H, 'PROFILES · SCORE SHAPES', lines) + s };
}

/* ---------- figure: speed ---------- */
function speedFig(metric, hidden) {
  const tps = metric === 'tps';
  const value = (d) => (tps ? d.tps : d.timeMin);
  const rows = DATA.filter((d) => !hidden.has(d.id) && value(d) != null)
    .sort((a, b) => (tps ? b.tps - a.tps : a.timeMin - b.timeMin));
  const vals = rows.map((d) => value(d));
  const unmeasured = DATA.filter((d) => !hidden.has(d.id) && value(d) == null);
  const chart = columnChart(rows.map((d, i) => ({ d, v: vals[i], value: String(vals[i]), tip: `${vals[i]} ${tps ? 'tok/s' : 'min per task'} · ${priceText(d)}` })),
    { top: TOP, ...fitAxis(Math.max(1, ...vals)), unit: tps ? 'tok/s' : 'min/task', empty: 'No model is shown. Tick one on the left.' });
  const title = tps ? 'THROUGHPUT · TOKENS PER SECOND' : 'TIME SPENT · MINUTES PER TASK';
  const lines = tps
    ? ['Output speed of each model. Taller column = faster.', 'Context compression (how often a model summarises to fit its window) is in the ledger.']
    : ['Minutes each model spent per task. Shorter column = quicker.', 'Context compression (how often a model summarises to fit its window) is in the ledger.'];
  let body = frame(WC, chart.H, title, lines) + chart.body;
  if (unmeasured.length) body += `<text x="64" y="${chart.H - 40}" font-size="20" font-weight="600" fill="${C.soft}">Not shown, no ${tps ? 'tokens per second' : 'minutes per task'} given: ${namesOf(unmeasured)}.</text>`;
  return { W: WC, H: chart.H, body, wide: true };
}

/* ---------- figure: ledger (every column, sortable) ---------- */
const LEDGER = [
  ['model', 'MODEL', 450, 'start'], ['effort', 'EFFORT', 130, 'start'], ['price', '$/TASK', 110, 'end'],
  ['basis', 'BASIS', 150, 'start'], ['context', 'CONTEXT', 120, 'end'], ['timeMin', 'MIN/TASK', 130, 'end'],
  ['compress', 'COMPRESS', 130, 'end'], ['tps', 'TOK/S', 110, 'end'],
  ...SCORE_KEYS.map((k) => [k, k.toUpperCase(), 120, 'end']),
  ['avg', 'AVG', 120, 'end'], ['value', 'PTS/$', 120, 'end'],
];
function sortRows(rows, sort) {
  return [...rows].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    if (va == null || vb == null) return va == null && vb == null ? 0 : va == null ? 1 : -1;
    if (typeof va === 'string') return va.localeCompare(vb) * sort.dir;
    return (va - vb) * sort.dir;
  });
}
function cellText(d, k) {
  switch (k) {
    case 'effort': return d.effort || '—';
    case 'price': return d.price == null ? '—' : d.free ? 'free' : `$${d.price.toFixed(2)}`;
    case 'basis': return BASIS_WORD[d.basis] || d.basis || '—';
    case 'context': return d.context || '—';
    case 'timeMin': return d.timeMin == null ? '—' : String(d.timeMin);
    case 'compress': return d.compress == null ? '—' : String(d.compress);
    case 'tps': return d.tps == null ? '—' : String(d.tps);
    case 're': return d.re == null ? '—' : d.re.toFixed(1);
    case 'avg': return d.avg == null ? '—' : d.avg.toFixed(1);
    case 'value': return d.value == null ? '—' : d.value.toFixed(1);
    default: return d[k] == null ? '—' : String(d[k]);
  }
}
function ledgerFig(sort, hidden) {
  const rows = sortRows(DATA.filter((d) => !hidden.has(d.id)), sort);
  const total = LEDGER.reduce((a, c) => a + c[2], 0), left = (WL - total) / 2;
  const top = TOP + 40, rowH = 74;
  const H = top + Math.max(rows.length, 1) * rowH + 150;
  const subset = rows.filter((d) => d.reNote);
  const lines = ['Click a column heading to sort. PTS/$ = average score per dollar of task price. A dash means no value for that column.',
    'RE = Gamefeel Reverse-Evaluation. A partial record (not all seven scores) has no average and is not in overall.'];
  if (subset.length) lines.push(reFootnote(subset));
  let s = '', x = left;
  LEDGER.forEach(([k, label, w, anchor]) => {
    const on = sort.key === k, arrow = on ? (sort.dir < 0 ? ' ▾' : ' ▴') : '';
    const tx = anchor === 'end' ? x + w - 14 : x + 14;
    s += `<rect data-sortkey="${k}" x="${x}" y="${top - 40}" width="${w}" height="44" rx="10" fill="transparent"/>`;
    s += `<text x="${tx}" y="${top - 10}" font-size="18" font-weight="800" letter-spacing="1" text-anchor="${anchor}" fill="${on ? C.azure : C.faint}" pointer-events="none">${label}${arrow}</text>`;
    x += w;
  });
  rows.forEach((d, i) => {
    const y = top + i * rowH, ty = y + rowH / 2 + 8;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${modelEffort(d)} · ${priceText(d)}`)}">`;
    if (i % 2 === 0) s += `<rect x="${left - 16}" y="${y}" width="${total + 32}" height="${rowH - 4}" rx="12" fill="${C.zebra}"/>`;
    x = left;
    LEDGER.forEach(([k, , w, anchor]) => {
      if (k === 'model') {
        s += iconSvg(d, x + 10, y + 10, 32);
        s += `<text x="${x + 52}" y="${ty}" font-size="25" font-weight="800" fill="${C.ink}">${esc(shortName(d))}</text>`;
      } else {
        const tx = anchor === 'end' ? x + w - 14 : x + 14, avg = k === 'avg';
        s += `<text x="${tx}" y="${ty}" font-size="24" font-weight="${avg ? 800 : 600}" text-anchor="${anchor}" fill="${avg ? C.ink : C.soft}">${esc(cellText(d, k))}</text>`;
      }
      x += w;
    });
    s += `</g>`;
  });
  if (!rows.length) s += emptyNote(WL, top + 80, 'No model is shown. Tick one on the left.');
  return { W: WL, H, body: frame(WL, H, 'EVERYTHING, ON ONE LEDGER', lines) + s };
}

/* ---------- app state ---------- */
const TABS_KEYS = TABS.map((t) => t[0]);
const TOP3 = () => DATA.filter((d) => d.complete).sort((a, b) => b.avg - a.avg).slice(0, 3).map((d) => d.id);
const state = {
  tab: 'overview', scope: 'overall', mode: 'score', metric: 'tps', reView: 'combined',
  sort: { key: 'avg', dir: -1 }, hidden: new Set(), prof: new Set(), spot: null,
};

function buildCurrent() {
  switch (state.tab) {
    case 'overview': return overviewFig(state.hidden);
    case 'explorer': return state.mode === 'score' ? scoresFig(state.scope, state.hidden)
      : state.mode === 'size' ? sizeFig(state.scope, state.hidden) : ppFig(state.scope, state.hidden);
    case 'profiles': return radarFig([...state.prof], state.hidden);
    case 'speed': return speedFig(state.metric, state.hidden);
    case 'ledger': return ledgerFig(state.sort, state.hidden);
    default: return overviewFig(state.hidden);
  }
}
function controlsHTML() {
  switch (state.tab) {
    case 'overview':
      return '<span class="hint">Models with all seven scores · tick a model on the left to hide it everywhere</span>';
    case 'explorer':
      return `<div class="seg">${SCOPES.map(([k, l]) => `<button type="button" data-scope="${k}" class="${state.scope === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>` +
        `<div class="seg">${[['score', 'Scores'], ['p2p', 'Price to performance'], ['size', 'Size to performance']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${state.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>` +
        (state.scope === 're' ? `<span class="re-view-wrap"><span class="seg-cap">RE score</span><div class="seg seg-re" role="group" aria-label="RE score view">${RE_VIEWS.map((v) => `<button type="button" data-review="${v}" class="${state.reView === v ? 'on' : ''}" aria-pressed="${state.reView === v}" title="${esc(RE_TIP[v])}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></span>` : '');
    case 'profiles':
      return DATA.filter((d) => d.complete).map((d) => `<button type="button" class="chip ${state.prof.has(d.id) ? 'on' : ''}" data-prof="${esc(d.id)}">${iconHTML(d)}${esc(d.model)} <span style="opacity:.6">${esc(d.effort)}</span></button>`).join('') +
        '<button type="button" class="chip plain" data-act="top3">reset to top 3</button>';
    case 'speed':
      return `<div class="seg"><button type="button" data-metric="tps" class="${state.metric === 'tps' ? 'on' : ''}">Tokens per second</button><button type="button" data-metric="min" class="${state.metric === 'min' ? 'on' : ''}">Minutes per task</button></div>`;
    case 'ledger':
      return '<span class="hint">Click a column heading to sort, click again to reverse</span>';
    default: return '';
  }
}

function applySpot() {
  document.querySelectorAll('#stage [data-m]').forEach((el) => {
    el.style.opacity = !state.spot || el.dataset.m === state.spot ? '' : '0.16';
  });
}
function renderSidebar() {
  const q = $('#q').value.trim().toLowerCase();
  const list = DATA.filter((d) => !q || `${d.model} ${d.effort} ${d.lab}`.toLowerCase().includes(q));
  $('#modelList').innerHTML = list.map((d) => {
    const on = !state.hidden.has(d.id);
    return `<label class="mrow ${on ? '' : 'off'}" data-row="${esc(d.id)}">` +
      `<input type="checkbox" data-hide="${esc(d.id)}" ${on ? 'checked' : ''} />${iconHTML(d)}` +
      `<span class="mtxt"><b>${esc(shortName(d))}</b><small>${esc(d.lab)} · ${esc(d.effort)}</small></span>` +
      `<span class="mavg">${d.complete ? d.avg.toFixed(1) : 'partial'}</span></label>`;
  }).join('') || '<div class="side-foot">No model matches that filter.</div>';
  $('#shown').textContent = `${DATA.length - state.hidden.size} of ${DATA.length} shown`;
}
function render() {
  // the RE view toggle applies to the explorer's RE section only; every other tab and view uses combined
  RE_VIEW = state.tab === 'explorer' && state.scope === 're' ? state.reView : 'combined';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#controls').innerHTML = controlsHTML();
  const f = buildCurrent();
  $('#stage').innerHTML = `<div class="fig${f.wide ? ' wide' : ''}"><svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg">${f.body}</svg></div>`;
  $('#stage').scrollTop = 0;
  applySpot();
  renderSidebar();
  writeHash();
}
function readHash() {
  const [tab, a, b, c] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (TABS_KEYS.includes(tab)) state.tab = tab;
  if (tab === 'explorer') {
    if (SCOPES.some(([k]) => k === a)) state.scope = a;
    if (['score', 'p2p', 'size'].includes(b)) state.mode = b;
    if (a === 're') state.reView = RE_VIEWS.includes(c) ? c : 'combined';
  }
  if (tab === 'speed' && (a === 'min' || a === 'tps')) state.metric = a;
}
function writeHash() {
  let h = state.tab;
  if (state.tab === 'explorer') {
    h += `/${state.scope}/${state.mode}`;
    if (state.scope === 're' && state.reView !== 'combined') h += `/${state.reView}`;
  }
  if (state.tab === 'speed') h += `/${state.metric}`;
  history.replaceState(null, '', `#${h}`);
}
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

/* ---------- events ---------- */
$('#tabs').innerHTML = TABS.map(([k, l], i) => `<button type="button" data-tab="${k}">${l}<kbd>${i + 1}</kbd></button>`).join('');
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; render();
});
$('#controls').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const ds = b.dataset;
  if (ds.scope) state.scope = ds.scope;
  else if (ds.mode) state.mode = ds.mode;
  else if (ds.review) state.reView = ds.review;
  else if (ds.metric) state.metric = ds.metric;
  else if (ds.prof) toggle(state.prof, ds.prof);
  else if (ds.act === 'top3') state.prof = new Set(TOP3());
  else return;
  render();
});
$('#stage').addEventListener('click', (e) => {
  const h = e.target.closest('[data-sortkey]'); if (!h) return;
  const k = h.dataset.sortkey;
  state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: ['model', 'effort', 'basis'].includes(k) ? 1 : -1 };
  render();
});
$('#modelList').addEventListener('change', (e) => {
  const id = e.target.dataset.hide; if (!id) return;
  toggle(state.hidden, id); render();
});
$('#modelList').addEventListener('mouseover', (e) => {
  const r = e.target.closest('[data-row]'); const id = r ? r.dataset.row : null;
  if (id !== state.spot) { state.spot = id; applySpot(); }
});
$('#modelList').addEventListener('mouseleave', () => { state.spot = null; applySpot(); });
$('#q').addEventListener('input', renderSidebar);
$('#showAll').addEventListener('click', () => { state.hidden.clear(); render(); });
$('#hideAll').addEventListener('click', () => { state.hidden = new Set(DATA.map((d) => d.id)); render(); });
/* Collapsible model sidebar: give the charts the full width on demand (and start collapsed on small screens). */
const setSide = (show) => {
  $('#app').classList.toggle('no-side', !show);
  $('#sideToggle').setAttribute('aria-pressed', String(show));
};
$('#sideToggle').addEventListener('click', () => setSide($('#app').classList.contains('no-side')));
if (innerWidth <= 900) setSide(false);
const tip = $('#tip');
$('#stage').addEventListener('mousemove', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.style.opacity = 0; return; }
  tip.textContent = t.dataset.tip;
  tip.style.opacity = 1;
  tip.style.left = Math.min(e.clientX + 18, innerWidth - 480) + 'px';
  tip.style.top = (e.clientY + 18) + 'px';
});
$('#stage').addEventListener('mouseleave', () => { tip.style.opacity = 0; });
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const i = '12345'.indexOf(e.key);
  if (i >= 0) { state.tab = TABS_KEYS[i]; render(); }
});
window.addEventListener('hashchange', () => { readHash(); render(); });

/* ---------- export hooks (used by export-figures.mjs; they ignore the visible filters) ---------- */
const EXPORTS = [
  { name: '01-overview', build: () => overviewFig(NONE) },
  { name: '02-profiles', build: () => radarFig(TOP3(), NONE) },
  { name: '03-speed-tokens', build: () => speedFig('tps', NONE) },
  { name: '04-speed-minutes', build: () => speedFig('min', NONE) },
  { name: '05-ledger', build: () => ledgerFig({ key: 'avg', dir: -1 }, NONE) },
  ...SCOPES.flatMap(([k]) => [
    { name: `scores-${k}`, build: () => (k === 're' ? reStackedFig() : scoresFig(k, NONE)) },
    { name: `price-performance-${k}`, build: () => ppFig(k, NONE) },
  ]),
  { name: 'size-performance-overall', build: () => sizeFig('overall', NONE) },
  // the Qwen highlight: the overall and RE price charts and the overall size chart, with both Qwen-4 models left off the blue line and measured in purple
  { name: 'qwen-highlight-price-performance-overall', build: () => ppFig('overall', NONE, true) },
  { name: 'qwen-highlight-price-performance-re', build: () => ppFig('re', NONE, true) },
  { name: 'qwen-highlight-size-performance-overall', build: () => sizeFig('overall', NONE, true) },
];
window.renderExport = (name) => {
  const e = EXPORTS.find((x) => x.name === name);
  if (!e) throw new Error('unknown export ' + name);
  RE_VIEW = 'combined';   // exports always use the combined RE score, whatever the explorer is showing
  const f = e.build();
  $('#exportStage').innerHTML = `<div class="fig"><svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg">${f.body}</svg></div>`;
  document.body.classList.add('exporting');
  return { W: f.W, H: f.H };
};

/* Start-up: load the data, then draw. window.EXPORTS is set only once the data is in, so the
   export script can wait for it. */
async function init() {
  try {
    ({ rows: DATA, icons: ICONS, meta: META } = await loadData());
  } catch (err) {
    console.error(err);
    $('#stage').innerHTML = `<div class="fig"><p class="notice">The data could not be loaded (${esc(err.message)}). ` +
      'Open the page from its web address, not as a local file. The README explains how to preview it.</p></div>';
    return;
  }
  deriveFields();
  state.prof = new Set(TOP3());
  $('#meta').innerHTML = `${DATA.length} entries${META.standard ? ` · standard ${esc(META.standard)}` : ''} · updated ${esc(META.updated)}<br>` +
    '<a href="data/gamefeelbench.csv" download>Download the data (CSV)</a>';
  window.EXPORTS = EXPORTS.map((e) => e.name);
  window.LABEL_STATS = LABEL_STATS;
  readHash();
  render();
}
init();
