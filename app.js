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
      reNote: r.re_test || '', aaIndex: num(r.aa_index || ''), gci: num(r.gci || ''), firstSeen: r.first_seen || '',   // set only on a result from the semi-private subset of the RE test
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
const NEW_MODELS = ['Opus-5.5 · Max', 'Ernie-5.5 Flash Preview', 'Gemini-4-Hydrogen'];   // only the latest additions: a small NEW! over their columns, in the bar's colour
const isNew = (d) => NEW_MODELS.includes(d.model) || NEW_MODELS.includes(`${d.model} · ${d.effort}`);   // a bare name tags every effort level; 'Name · Effort' tags one
const isWarn = (d) => /qoduck|qohawk/i.test(d.model);   // kept permanently: an orange ! in a triangle over their results
const WARN_C = '#f08c00';
const warnSvg = (cx, base, h = 34) => { const w = h * 1.12, r = (v) => v.toFixed(1); return `<path d="M${r(cx)} ${r(base - h)}L${r(cx + w / 2)} ${r(base)}H${r(cx - w / 2)}Z" fill="#fff" stroke="${WARN_C}" stroke-width="3.5" stroke-linejoin="round"/><text x="${r(cx)}" y="${r(base - 6)}" font-size="${r(h * 0.62)}" font-weight="900" text-anchor="middle" fill="${WARN_C}">!</text>`; };
const warnHTML = '<span class="warnb" aria-label="warning">!</span>';
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
    'Gamefeel RE combined: how well the model gives feedback on game proposals, especially on balance. Overall uses this score.',
    '66% blind + 33% assisted (39 rated examples first). A blind-only result counts its blind score at 99%.',
  ],
  blind: [
    'Gamefeel RE blind: how well the model gives feedback on game proposals, especially on balance.',
    'Blind: no worked examples, the model rates the proposals cold. Overall uses RE combined, not this view.',
  ],
  assisted: [
    'Gamefeel RE assisted: how well the model gives feedback on game proposals, especially on balance.',
    'Assisted: the model studies 39 rated examples first, then rates the rest. Overall uses RE combined, not this view.',
  ],
};
/* Where a figure's content starts: the title block has room for two subtitle lines; each extra line pushes the content down. */
const topFor = (lines) => TOP + 36 * Math.max(0, lines.length - 2);
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
let FRAME_INFO = null;   // PROPOSAL: the last figure's title block, so the app can show it as an HTML header
function frame(w, h, title, lines) {
  FRAME_INFO = { title, lines, y: 188 + 36 * lines.length - 6 };
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
  const yT = o.top + 70, yB = yT + COL.plot;
  // room under the axis for the longest diagonal name, plus a footnote line below it
  const drop = Math.max(...items.map((it) => textW(shortName(it.d), 23, 800))) * Math.SQRT1_2;
  const H = Math.max(yB + COL.label + 150, yB + 150 + drop + 90);
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
    s += `<text x="${X0 - 18}" y="${(Y(t) + 8).toFixed(1)}" font-size="22" font-weight="700" text-anchor="end" fill="${C.soft}">${+t.toFixed(1)}</text>`;
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
    if (isWarn(d)) s += warnSvg(cx, top - (isNew(d) ? 82 : 54));
    s += iconSvg(d, (cx - iSize / 2).toFixed(1), yB + 20, iSize);
    s += `<text x="${cx.toFixed(1)}" y="${yB + 92}" font-size="${sFont.toFixed(1)}" font-weight="700" text-anchor="middle" fill="${C.soft}">${esc(d.effort)}</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${yB + 120}" font-size="${sFont.toFixed(1)}" font-weight="600" text-anchor="middle" fill="${C.soft}">${priceLabel(d)}</text>`;
    s += `<text transform="translate(${nx.toFixed(1)} ${yB + 150}) rotate(-45)" font-size="23" font-weight="800" text-anchor="end" fill="${C.ink}">${esc(shortName(d))}</text>`;
    s += `</g>`;
  });
  return { H, body: s };
}

/* Footnotes under a column figure, wrapped to its width; the figure grows by one line per extra line. */
function footNotes(texts, baseH) {
  const lines = texts.flatMap((t) => wrapText(t, 20, 600, WC - 128));
  return { H: baseH + 30 * Math.max(0, lines.length - 1),
    body: lines.map((t, i) => `<text x="64" y="${baseH - 40 + 30 * i}" font-size="20" font-weight="600" fill="${C.soft}">${esc(t)}</text>`).join('') };
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
  const foot = footNotes(partial.length ? [`Not in overall (partial record): ${partial.map((d) => `${d.model} ${d.effort}`).join(' · ')}`] : [], chart.H);
  const H = foot.H;
  let body = frame(WC, H, 'OVERALL · SCORES', [`Average of: ${SUBCATEGORY_LIST}`]);
  tiles.forEach(([label, value, sub], i) => {
    const x = 64 + i * (tw + 24), y = TOP;
    body += `<rect x="${x.toFixed(1)}" y="${y}" width="${tw.toFixed(1)}" height="${TH}" rx="26" fill="${C.zebra}"/>`;
    body += `<text x="${(x + 30).toFixed(1)}" y="${y + 42}" font-size="18" font-weight="700" letter-spacing="3" fill="${C.faint}">${label}</text>`;
    body += `<text x="${(x + 30).toFixed(1)}" y="${y + 102}" font-size="58" font-weight="800" fill="${C.ink}">${esc(value)}</text>`;
    body += `<text x="${(x + 30).toFixed(1)}" y="${y + 134}" font-size="20" font-weight="600" fill="${C.soft}">${esc(sub)}</text>`;
  });
  body += chart.body + foot.body;
  return { W: WC, H, body, wide: true };
}

/* ---------- figure: scores columns (overall or one subcategory) ---------- */
function scoresFig(scope, hidden) {
  let rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null)
    .sort((a, b) => scoreOf(b, scope) - scoreOf(a, scope));
  if (scope === 're') rows = bestPerModel(rows);   // match the RE export: every model once, at its best reasoning effort
  const partial = scope === 'overall' ? DATA.filter((d) => !d.complete && !hidden.has(d.id)) : [];
  const lines = scope === 'overall'
    ? [`Average of: ${SUBCATEGORY_LIST}`]
    : scope === 're'
      ? [...RE_LINES[RE_VIEW], `Best reasoning effort per model, all ${rows.length} models. Scale 0 to the best score; price per task under each column.`]
      : [`${SCOPE_LABEL[scope]} score alone. The scale runs from 0 to the best score on this chart. Price per task is under each column.`, 'Only models with a score in this subcategory are listed.'];
  // best on the right: the columns run from the lowest score on the left to the best on the right
  const chart = columnChart(rows.slice().reverse().map((d) => { const v = scoreOf(d, scope); return { d, v, value: fmtScore(v), tip: `score ${fmtScore(v)} · ${priceText(d)}` }; }),
    { top: topFor(lines), ...fitAxis(rows.length ? scoreOf(rows[0], scope) : 1), unit: 'score', empty: 'No model is shown for this view.' });
  const subset = rows.filter((d) => d.reNote);
  const foot = footNotes([
    ...(partial.length ? [`Not in overall (partial record): ${partial.map((d) => `${d.model} ${d.effort}`).join(' · ')}. They appear in each subcategory they have a score in.`] : []),
    ...(subset.length ? [reFootnote(subset)] : []),
  ], chart.H);
  const H = foot.H;
  let body = frame(WC, H, `${figTitle(scope)} · SCORES`, lines) + chart.body + foot.body;
  return { W: WC, H, body, wide: true };
}

/* The rows one RE chart shows: every model once, at its best reasoning effort; lowest left, best right. */
const reRows = (key) => bestPerModel(DATA.filter((d) => d[key] != null).sort((a, b) => b[key] - a[key])).reverse();

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
    const rows = reRows(key);
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

/* ---------- figure: one RE section on its own — exported separately as scores-re-blind / -assisted / -combined ---------- */
function reSingleFig(view) {
  const key = RE_FIELD[view];
  const rows = reRows(key);
  const items = rows.map((d) => ({ d, v: d[key], value: fmtScore(d[key]), tip: `${view} ${fmtScore(d[key])} · ${priceText(d)}` }));
  const lines0 = [...RE_LINES[view]];
  const chart = columnChart(items, { top: topFor([...lines0, '']), ...fitAxis(rows.length ? rows[rows.length - 1][key] : 1), unit: 'score', empty: `No model has a ${view} score yet.` });
  const lines = [...lines0,
    `Best reasoning effort per model, all ${rows.length} models. Scale 0 to the best score; price per task under each column.`];
  return { W: WC, H: chart.H, body: frame(WC, chart.H, `GAMEFEEL · RE (${view.toUpperCase()}) · SCORES`, lines) + chart.body, wide: true };
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
    if (isWarn(d)) s += warnSvg(p.x, p.y - 34, 30);
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
    if (isWarn(d)) s += warnSvg(p.x, p.y - 34, 30);
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

/* ============================================================
   EXTRA SECTIONS (reached from the ☰ menu) and the phone ranking list.
   These are HTML, not export figures: they reflow to the screen and their tables sort in place.
   ============================================================ */
const EXTRA = [
  ['glance', 'Every score at a glance', 'All seven scores in one sortable heatmap'],
  ['rehelp', 'Blind vs assisted RE', 'How much the 39 rated examples help each model'],
  ['effort', 'Is more effort worth it?', 'Each model across its reasoning-effort levels'],
  ['general', 'Gamefeel vs general capability', 'Outliers against the Artificial Analysis index'],
  ['progress', 'Progress over time', 'GCI, the best score so far, by date'],
];
const EXTRA_KEYS = EXTRA.map((e) => e[0]);
const isPhone = () => matchMedia('(max-width: 700px)').matches;
const GLANCE_COLS = [['create', 'Create'], ['bugfix', 'Bugfix'], ['gamefeel', 'Gamefeel'], ['ideas', 'Ideas'],
  ['visuals', 'Visuals'], ['audio', 'Audio'], ['re', 'RE'], ['avg', 'Overall']];
const nameCell = (d) => `${iconHTML(d)}<span class="nm"><b>${esc(shortName(d))}</b>${d.effort ? `<small>${esc(d.effort)}</small>` : ''}${isNew(d) ? `<span class="newb" style="background:${d.tint}">NEW</span>` : ''}${isWarn(d) ? warnHTML : ''}</span>`;
const card = (title, sub, inner, foot = '') => `<section class="card"><div class="kick">THE GAMEFEEL BENCHMARK${standardTag()}</div><h2>${esc(title)}</h2>` +
  `${sub ? `<p class="sub">${sub}</p>` : ''}${inner}${foot ? `<p class="foot">${foot}</p>` : ''}</section>`;
const sortBy = (rows, key, dir, val = (d, k) => d[k]) => [...rows].sort((a, b) => {
  const va = val(a, key), vb = val(b, key);
  if (va == null || vb == null) return va == null && vb == null ? 0 : va == null ? 1 : -1;
  return typeof va === 'string' ? va.localeCompare(vb) * dir : (va - vb) * dir;
});
const sortHead = (attr, key, label, sort, cls = '') => `<th class="${cls}"><button type="button" data-${attr}="${key}" class="${sort.key === key ? 'on' : ''}">${esc(label)}${sort.key === key ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;

/* ---------- phone: one ranked list per scope instead of a shrunken column chart ---------- */
function rankListHTML(scope, hidden) {
  let rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null).sort((a, b) => scoreOf(b, scope) - scoreOf(a, scope));
  if (scope === 're') rows = bestPerModel(rows);
  const max = rows.length ? scoreOf(rows[0], scope) : 1;
  const title = scope === 'overall' ? 'Overall' : scope === 're' ? `Gamefeel RE · ${RE_VIEW}` : SCOPE_LABEL[scope];
  const list = rows.map((d, i) => { const v = scoreOf(d, scope); return `<li data-m="${esc(d.id)}"><span class="rk">${i + 1}</span><div class="rl"><div class="rn">${nameCell(d)}</div>` +
    `<div class="rb"><i style="width:${Math.max(1, (v / max) * 72).toFixed(1)}%;background:${d.tint}"></i><b>${scope === 'overall' ? v.toFixed(1) : fmtScore(v)}</b><em>${priceLabel(d)}</em></div></div></li>`; }).join('');
  const sub = scope === 'overall' ? 'Average of the seven scores. Models with a partial record are not ranked.' : scope === 're' ? 'Feedback on game proposals, especially balancing. Best effort per model.' : 'Score out of 100.';
  const subset = rows.filter((d) => d.reNote);
  return card(title, sub, rows.length ? `<ol class="rank">${list}</ol>` : '<p class="sub">No model is shown.</p>', subset.length ? esc(reFootnote(subset)) : '');
}

/* ---------- every score at a glance: sortable heatmap ---------- */
function glanceHTML(sort, hidden) {
  const all = DATA.filter((d) => !hidden.has(d.id) && SCORE_KEYS.filter((k) => d[k] != null).length >= 2);
  const rows = sortBy(all, sort.key, sort.dir, (d, k) => (k === 'model' ? d.model : d[k]));
  const range = Object.fromEntries(GLANCE_COLS.map(([k]) => { const v = DATA.map((d) => d[k]).filter((x) => x != null); return [k, [Math.min(...v), Math.max(...v)]]; }));
  const shade = (k, v) => {
    if (v == null) return 'class="na"';
    const [a, b] = range[k], t = (v - a) / (b - a || 1);
    return `style="background:hsl(220 78% ${(96 - t * 52).toFixed(0)}%);color:${t > 0.55 ? '#fff' : 'var(--ink)'}"`;
  };
  const head = `<tr>${sortHead('gsort', 'model', 'Model', sort, 'm')}${GLANCE_COLS.map(([k, l]) => sortHead('gsort', k, l, sort)).join('')}</tr>`;
  const body = rows.map((d) => `<tr data-m="${esc(d.id)}"><td class="m">${nameCell(d)}</td>${GLANCE_COLS.map(([k]) =>
    `<td ${k === 'avg' && d.avg != null ? 'class="ov"' : shade(k, d[k])}>${d[k] == null ? '—' : k === 'avg' ? d.avg.toFixed(1) : fmtScore(d[k])}</td>`).join('')}</tr>`).join('');
  return card('Every score at a glance',
    'Darker = better within that column, so a strong ideas score and a strong RE score read the same way. Click a heading to sort; click again to reverse.',
    `<div class="tscroll"><table class="hm">${head}${body}</table></div>`,
    `RE is the combined score. Overall needs all seven scores; a dash means no score yet. ${rows.length} entries with at least two scores.`);
}

/* ---------- blind vs assisted RE: dumbbell ---------- */
function reHelpHTML(sort, hidden) {
  const base = DATA.filter((d) => !hidden.has(d.id) && d.re_blind != null && d.re_assisted != null);
  const rows = sortBy(base, sort.key, sort.dir, (d, k) => (k === 'gain' ? d.re_assisted - d.re_blind : k === 'model' ? d.model : d[k]));
  const ph = isPhone(), W = ph ? 660 : 1000, L = ph ? 20 : 300, R = W - (ph ? 80 : 150), rowH = ph ? 76 : 46, H = (ph ? 66 : 50) + rows.length * rowH, X = (v) => L + (v / 100) * (R - L);
  let s = '';
  [0, 20, 40, 60, 80, 100].forEach((t) => { s += `<line x1="${X(t)}" x2="${X(t)}" y1="30" y2="${H}" class="grid"/><text x="${X(t)}" y="20" class="ax" text-anchor="middle">${t}</text>`; });
  rows.forEach((d, i) => {
    const y = (ph ? 82 : 52) + i * rowH, gain = d.re_assisted - d.re_blind;   // on a phone the name sits on its own line above the bar
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${modelEffort(d)} · blind ${fmtScore(d.re_blind)} · assisted ${fmtScore(d.re_assisted)} · combined ${fmtScore(d.re_combined)}`)}">`;
    s += `<rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += ph ? `<text x="${L}" y="${y - 20}" class="lbl">${esc(modelEffort(d))}${isNew(d) ? ' · NEW' : ''}</text>` : `<text x="${L - 16}" y="${y + 5}" class="lbl" text-anchor="end">${esc(modelEffort(d))}${isNew(d) ? ' · NEW' : ''}</text>`;
    s += `<line x1="${X(d.re_blind)}" x2="${X(d.re_assisted)}" y1="${y}" y2="${y}" stroke="${d.tint}" stroke-opacity=".35" stroke-width="8" stroke-linecap="round"/>`;
    s += `<circle cx="${X(d.re_blind)}" cy="${y}" r="7.5" fill="#fff" stroke="${d.tint}" stroke-width="3"/><circle cx="${X(d.re_assisted)}" cy="${y}" r="7.5" fill="${d.tint}"/>`;
    if (d.re_combined != null) s += ph ? `<path d="M${X(d.re_combined).toFixed(1)} ${y + 12} l6 9 h-12z" fill="var(--ink)"/>` : `<path d="M${X(d.re_combined).toFixed(1)} ${y - 12} l6 -9 h-12z" fill="var(--ink)"/>`;
    s += `<text x="${X(Math.max(d.re_blind, d.re_assisted)) + 15}" y="${y + 5}" class="note">${gain >= 0 ? '+' : '−'}${Math.abs(gain).toFixed(1)}</text></g>`;
  });
  const opts = [['re_combined', 'Combined'], ['gain', 'Gain from examples'], ['re_blind', 'Blind'], ['re_assisted', 'Assisted'], ['model', 'Name']];
  return card('Blind vs assisted RE: how much do examples help?',
    `○ blind score (no examples) · ● assisted score (after studying 39 rated examples) · ${ph ? '▲' : '▼'} combined (66% blind + 33% assisted). A long bar means the model learns a lot from examples.`,
    `<div class="sortbar"><span class="seg-cap">Sort</span><div class="seg">${opts.map(([k, l]) => `<button type="button" data-hsort="${k}" class="${sort.key === k ? 'on' : ''}">${l}${sort.key === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`).join('')}</div></div>` +
    (rows.length ? `<svg class="hsvg" viewBox="0 0 ${W} ${H}">${s}</svg>` : '<p class="sub">No model with both scores is shown.</p>'),
    `Only the ${rows.length} entries with an assisted run so far. Every reasoning effort is its own row.`);
}

/* ---------- is more effort worth it: each model's effort levels as one line ---------- */
const EFFORT_ORDER = { Low: 0, Medium: 1, High: 2, XHigh: 3, Max: 4 };
function effortHTML(metric, hidden) {
  const val = (d) => (metric === 're' ? d.re : d.avg);
  const fam = {};
  DATA.filter((d) => !hidden.has(d.id) && val(d) != null && d.price > 0 && d.effort in EFFORT_ORDER).forEach((d) => { (fam[d.model] = fam[d.model] || []).push(d); });
  const F = Object.values(fam).filter((g) => g.length > 1).map((g) => g.sort((a, b) => EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]));
  const tog = `<div class="sortbar"><span class="seg-cap">Score</span><div class="seg">${[['avg', 'Overall'], ['re', 'Gamefeel RE (combined)']].map(([k, l]) => `<button type="button" data-emetric="${k}" class="${metric === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  if (!F.length) return card('Is more reasoning effort worth it?', '', tog + '<p class="sub">No model has two or more effort levels with a price and a score in this view.</p>');
  const ph = isPhone(), W = ph ? 620 : 1000, H = ph ? 460 : 520, L = 50, B = H - 56, T = 26, R = W - (ph ? 130 : 190);
  const pts = F.flat(), xs = pts.map((d) => d.price), ys = pts.map(val);
  const x0 = Math.min(...xs) / 1.6, x1 = Math.max(...xs) * 1.6;
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 3) / 5) * 5), y1 = Math.ceil((Math.max(...ys) + 3) / 5) * 5;
  const X = (v) => L + (Math.log(v / x0) / Math.log(x1 / x0)) * (R - L), Y = (v) => B - ((v - y0) / (y1 - y0)) * (B - T);
  let s = '';
  for (let v = y0; v <= y1; v += 5) s += `<line x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 10}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].filter((t) => t >= x0 && t <= x1).forEach((t) => { s += `<text x="${X(t)}" y="${B + 22}" class="ax" text-anchor="middle">$${t}</text>`; });
  s += `<text x="${(L + R) / 2}" y="${H - 6}" class="note" text-anchor="middle">price per task (log scale)</text>`;
  const dashes = ['', '10 6', '2 6', '14 4 2 4', '6 3'], ends = [];
  F.forEach((g, fi) => {
    const c = g[0].tint;
    s += `<g data-m="${esc(g[0].id)}"><path d="${g.map((d, i) => (i ? 'L' : 'M') + X(d.price).toFixed(1) + ' ' + Y(val(d)).toFixed(1)).join('')}" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="${dashes[fi % dashes.length]}"/>`;
    g.forEach((d, i) => {
      s += `<g data-tip="${esc(`${modelEffort(d)} · ${fmtScore(val(d))} · ${priceText(d)}`)}"><circle cx="${X(d.price)}" cy="${Y(val(d))}" r="${5 + i * 1.8}" fill="${c}"/>` +
        `<text x="${X(d.price)}" y="${Y(val(d)) - 11 - i * 1.8}" class="tiny" text-anchor="middle">${esc(d.effort)}</text></g>`;
    });
    s += '</g>';
    const e = g[g.length - 1]; ends.push({ y: Y(val(e)), t: e.model, c });
  });
  ends.sort((a, b) => a.y - b.y).forEach((e, i, arr) => { if (i && e.y - arr[i - 1].y < 18) e.y = arr[i - 1].y + 18; s += `<text x="${R + 14}" y="${e.y + 4}" class="lbl" style="fill:${e.c}">${esc(e.t)}</text>`; });
  return card('Is more reasoning effort worth it?',
    'Each line is one model at its effort levels; bigger dot = more effort. Up and to the right is the normal trade. A line that goes down to the right means paying for more effort bought a lower score.',
    tog + `<svg class="hsvg" viewBox="0 0 ${W} ${H}">${s}</svg>`,
    'Only models tested at two or more effort levels, each with a price and a score in this view.' + effortGap(metric, hidden, F));
}
/* Models tested at several efforts that this view cannot draw as a line, and why. */
function effortGap(metric, hidden, F) {
  const shown = new Set(F.map((g) => g[0].model)), fam = {};
  DATA.filter((d) => !hidden.has(d.id) && d.effort in EFFORT_ORDER).forEach((d) => { (fam[d.model] = fam[d.model] || []).push(d); });
  const miss = Object.entries(fam).filter(([m, g]) => g.length > 1 && !shown.has(m));
  if (!miss.length) return '';
  return ' Not drawn: ' + miss.map(([m, g]) => {
    const lacking = g.filter((d) => (metric === 're' ? d.re : d.avg) == null || !(d.price > 0)).map((d) => d.effort);
    return `${esc(m)} (${lacking.join(' and ')} ${lacking.length > 1 ? 'have' : 'has'} no ${metric === 're' ? 'RE score' : 'overall score'} or price yet${metric === 're' ? '' : '; switch to Gamefeel RE to see all its levels'})`;
  }).join('; ') + '.';
}

/* ---------- Gamefeel vs general capability (Artificial Analysis Intelligence Index) ---------- */
function linFit(pts) {
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const b = sxx ? sxy / sxx : 0, a = my - b * mx;
  const ssr = pts.reduce((s, p) => s + (p[1] - (a + b * p[0])) ** 2, 0), sst = pts.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  return { a, b, r2: sst ? 1 - ssr / sst : 0 };
}
function generalHTML(metric, sort, hidden) {
  const val = (d) => (metric === 're' ? d.re : d.avg);
  const base = DATA.filter((d) => !hidden.has(d.id) && d.aaIndex != null && val(d) != null);
  const tog = `<div class="sortbar"><span class="seg-cap">Gamefeel score</span><div class="seg">${[['avg', 'Overall'], ['re', 'RE (combined)']].map(([k, l]) => `<button type="button" data-gmetric="${k}" class="${metric === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  if (base.length < 3) return card('Gamefeel vs general capability', '', tog + '<p class="sub">Fewer than three shown models have both scores.</p>');
  const fit = linFit(base.map((d) => [d.aaIndex, val(d)]));
  base.forEach((d) => { d._exp = fit.a + fit.b * d.aaIndex; d._gap = val(d) - d._exp; d._val = val(d); });
  const rows = sortBy(base, sort.key, sort.dir, (d, k) => (k === 'model' ? d.model : k === 'gap' ? d._gap : k === 'aa' ? d.aaIndex : d._val));
  const lo = Math.min(0, ...rows.map((d) => Math.min(d._val, d._exp))), hi = Math.max(...rows.map((d) => Math.max(d._val, d._exp)));
  const ph = isPhone(), W = ph ? 660 : 1000, L = ph ? 330 : 300, R = W - (ph ? 80 : 150), rowH = 40, H = 50 + rows.length * rowH;
  const X = (v) => L + ((v - lo) / (hi - lo || 1)) * (R - L);
  const step = hi - lo > 40 ? 10 : 5;
  let s = '';
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) s += `<line x1="${X(t)}" x2="${X(t)}" y1="30" y2="${H}" class="grid"/><text x="${X(t)}" y="20" class="ax" text-anchor="middle">${t}</text>`;
  rows.forEach((d, i) => {
    const y = 50 + i * rowH, up = d._gap >= 0;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${modelEffort(d)} · Gamefeel ${fmtScore(d._val)} · expected from AA index ${d.aaIndex}: ${d._exp.toFixed(1)}`)}">`;
    s += `<rect x="0" y="${y - rowH / 2}" width="${W}" height="${rowH}" fill="transparent"/>`;
    s += `<text x="${L - 16}" y="${y + 5}" class="lbl" text-anchor="end">${esc(modelEffort(d))}</text>`;
    s += `<line x1="${X(d._exp)}" x2="${X(d._val)}" y1="${y}" y2="${y}" stroke="${up ? 'var(--good)' : 'var(--bad)'}" stroke-opacity=".45" stroke-width="7" stroke-linecap="round"/>`;
    s += `<circle cx="${X(d._exp)}" cy="${y}" r="7" fill="#fff" stroke="var(--ink-faint)" stroke-width="3"/><circle cx="${X(d._val)}" cy="${y}" r="7.5" fill="${d.tint}"/>`;
    s += `<text x="${X(Math.max(d._val, d._exp)) + 14}" y="${y + 5}" class="note" style="fill:${up ? 'var(--good-ink)' : 'var(--bad-ink)'}">${up ? '▲ +' : '▼ −'}${Math.abs(d._gap).toFixed(1)}</text></g>`;
  });
  const opts = [['gap', 'Outlier gap'], ['val', 'Gamefeel'], ['aa', 'AA index'], ['model', 'Name']];
  const what = metric === 're' ? 'RE combined' : 'overall';
  return card('Gamefeel vs general capability',
    `○ the Gamefeel ${what} score a model would get from its general capability alone (a straight-line fit on the Artificial Analysis Intelligence Index, r² = ${fit.r2.toFixed(2)}) · ● its actual score. ▲ green = better at game work than its general capability predicts, ▼ red = worse.`,
    tog + `<div class="sortbar"><span class="seg-cap">Sort</span><div class="seg">${opts.map(([k, l]) => `<button type="button" data-asort="${k}" class="${sort.key === k ? 'on' : ''}">${l}${sort.key === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`).join('')}</div></div>` +
    `<svg class="hsvg" viewBox="0 0 ${W} ${H}">${s}</svg>`,
    `AA index: Artificial Analysis Intelligence Index from artificialanalysis.ai, read 2026-11-13, matched to the same model and reasoning effort; ${base.length} entries have both. Models not on their leaderboard are left out.`);
}

/* ---------- progress over time: GCI (Gamefeel Capabilities Index) by the date a result first appeared ---------- */
function progressHTML(hidden) {
  const rows = DATA.filter((d) => !hidden.has(d.id) && d.gci != null && d.firstSeen).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen) || b.gci - a.gci);
  if (rows.length < 2) return card('Progress over time', '', '<p class="sub">Not enough models with a GCI are shown.</p>');
  const t = (s) => Date.parse(s + 'T00:00:00Z');
  const days = rows.map((d) => t(d.firstSeen)), d0 = Math.min(...days) - 2 * 864e5, d1 = Math.max(Date.now(), Math.max(...days)) + 2 * 864e5;
  const ph = isPhone(), W = ph ? 690 : 1000, H = ph ? 520 : 540, L = 56, R = W - (ph ? 24 : 200), T = 24, B = H - 52;
  const g = rows.map((d) => d.gci), y0 = Math.max(0, Math.floor((Math.min(...g) - 4) / 5) * 5), y1 = Math.ceil((Math.max(...g) + 4) / 5) * 5;
  const X = (ms) => L + ((ms - d0) / (d1 - d0)) * (R - L), Y = (v) => B - ((v - y0) / (y1 - y0)) * (B - T);
  let s = '';
  for (let v = y0; v <= y1; v += 5) s += `<line x1="${L}" x2="${R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 10}" y="${Y(v) + 4}" class="ax" text-anchor="end">${v}</text>`;
  for (let ms = Math.ceil(d0 / (7 * 864e5)) * 7 * 864e5; ms <= d1; ms += 7 * 864e5) {
    s += `<text x="${X(ms)}" y="${B + 22}" class="ax" text-anchor="middle">${new Date(ms).toISOString().slice(5, 10)}</text>`;
  }
  // best GCI so far, as a step line: one for every model shown, one for open weights only
  const steps = (list, color, dash, label) => {
    let best = -Infinity, path = '', recs = [];
    list.forEach((d) => { if (d.gci > best) { const x = X(t(d.firstSeen)); path += path ? `H${x.toFixed(1)}V${Y(d.gci).toFixed(1)}` : `M${x.toFixed(1)} ${Y(d.gci).toFixed(1)}`; best = d.gci; recs.push(d); } });
    if (!path) return { s: '', recs };
    path += `H${X(d1).toFixed(1)}`;
    return { s: `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${R + 8}" y="${Y(best) + 4}" class="lbl" style="fill:${color}">${ph ? '' : label + ' ' + best.toFixed(1)}</text>`, recs };
  };
  const all = steps(rows, C.azure, '', 'best');
  const open = state.openOnly ? { s: '', recs: [] } : steps(rows.filter((d) => d.openWeights), 'var(--good)', '9 6', 'best open');
  s += all.s + open.s;
  const boxes = [];   // record labels already placed: a new one moves down (then up) until it is clear of them
  const place = (x, y, text) => {
    const w = textW(text, 11, 700) + 6;
    for (let k = 0; k < 14; k++) {
      const yy = y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15;
      const b = { x0: x, x1: x + w, y0: yy - 11, y1: yy + 3 };
      if (!boxes.some((o) => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1) && b.x1 < W - 4) { boxes.push(b); return yy; }
    }
    return null;
  };
  rows.forEach((d) => {
    const rec = all.recs.includes(d) || open.recs.includes(d);
    const ly = rec && !ph ? place(X(t(d.firstSeen)) + 10, Y(d.gci) - 9, modelEffort(d)) : null;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${modelEffort(d)} · GCI ${d.gci.toFixed(1)} · first in the data ${d.firstSeen}${d.openWeights ? ' · open weights' : ''}`)}">` +
      `<circle cx="${X(t(d.firstSeen)).toFixed(1)}" cy="${Y(d.gci).toFixed(1)}" r="${rec ? 7 : 5}" fill="${d.tint}" ${d.openWeights ? '' : 'fill-opacity=".85"'} stroke="#fff" stroke-width="1.5"/>` +
      (ly != null ? `<text x="${X(t(d.firstSeen)) + 10}" y="${ly}" class="tiny">${esc(modelEffort(d))}</text>` : '') + '</g>';
  });
  const recList = [...all.recs.map((d) => ['best', d]), ...open.recs.map((d) => ['open', d])].sort((a, b) => a[1].firstSeen.localeCompare(b[1].firstSeen));
  const table = `<table class="plist"><tr><th>Date</th><th>New record</th><th></th><th>GCI</th></tr>${recList.map(([k, d]) => `<tr data-m="${esc(d.id)}"><td>${d.firstSeen}</td><td><span class="nm">${iconHTML(d)}<b>${esc(d.model)}</b><small>${esc(d.effort)}</small></span></td><td><span class="ptag ${k}">${k === 'open' ? 'best open' : 'best overall'}</span></td><td><b>${d.gci.toFixed(1)}</b></td></tr>`).join('')}</table>`;
  const gci = META.gci || {};
  return card('Progress over time · GCI',
    'GCI, the Gamefeel Capabilities Index: one number per model that stays comparable when the benchmark moves to a new version. Each dot is a model at the date its result first appeared; the lines step up each time a new best arrives.' + (state.openOnly ? '' : ' <span style="color:var(--azure);font-weight:800">Solid blue</span>: best of all models. <span style="color:var(--good-ink);font-weight:800">Dashed green</span>: best open-weight model.'),
    `<svg class="hsvg" viewBox="0 0 ${W} ${H}">${s}</svg><div class="tscroll">${table}</div>`,
    `GCI on ${esc(gci.base || 'v1.5')} = the overall score. On each later version the build fits the new overall scores to the previous version's GCI, using every model tested in both, so the scale carries over; each version's values are kept in data/gci-history.csv. Dates are when a result first entered the published data; the history starts 2026-10-17, so models benchmarked before that share that date. Only models with all seven scores have a GCI.`);
}

/* ---------- overview: a tile per view, each with a small live preview; a click opens the view ---------- */
const miniBars = (rows, val, fmt = fmtScore, n = 4) => {
  const top = rows.slice(0, n), max = top.length ? Math.max(...top.map(val)) || 1 : 1;
  return `<ol class="mini">${top.map((d) => `<li><span class="mn">${iconHTML(d)}<b>${esc(d.model)}</b>${isWarn(d) ? warnHTML : ''}</span><i style="width:${Math.max(3, (val(d) / max) * 100).toFixed(0)}%;background:${d.tint}"></i><em>${fmt(val(d))}</em></li>`).join('')}</ol>`;
};
function miniScatter(rows, xv, yv, logX = true) {
  if (rows.length < 2) return '';
  const W = 240, H = 92, xs = rows.map(xv), ys = rows.map(yv);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (v) => 6 + (logX ? Math.log(v / x0) / Math.log(x1 / x0 || 2) : (v - x0) / (x1 - x0 || 1)) * (W - 12);
  const Y = (v) => H - 6 - ((v - y0) / (y1 - y0 || 1)) * (H - 12);
  const front = [...rows].sort((a, b) => xv(a) - xv(b)).filter(((best) => (d) => (yv(d) > best ? ((best = yv(d)), true) : false))(-Infinity));
  return `<svg class="msc" viewBox="0 0 ${W} ${H}"><path d="${front.map((d, i) => (i ? 'L' : 'M') + X(xv(d)).toFixed(1) + ' ' + Y(yv(d)).toFixed(1)).join('')}" fill="none" stroke="${C.azure}" stroke-width="2.5"/>` +
    rows.map((d) => `<circle cx="${X(xv(d)).toFixed(1)}" cy="${Y(yv(d)).toFixed(1)}" r="3.6" fill="${d.tint}"/>`).join('') + '</svg>';
}
function tilesHTML(hidden) {
  const vis = DATA.filter((d) => !hidden.has(d.id));
  const ranked = (key) => bestPerModel(vis.filter((d) => d[key] != null).sort((a, b) => b[key] - a[key]));
  const tiles = [];
  const add = (go, title, sub, body, big = false) => tiles.push({ go, title, sub, body, big });
  add('explorer/overall/score', 'Overall ranking', 'Average of all seven scores', miniBars(ranked('avg'), (d) => d.avg, (v) => v.toFixed(1), 5), true);
  SCOPES.slice(1).forEach(([k, l]) => add(`explorer/${k}/score`, l, k === 're' ? 'Feedback on game proposals' : 'Score out of 100', miniBars(ranked(k), (d) => d[k], fmtScore, 3)));
  const priced = vis.filter((d) => d.complete && d.px != null);
  add('explorer/overall/p2p', 'Price to performance', 'Overall score against price per task, blue = best value line', miniScatter(priced, (d) => d.px, (d) => d.avg));
  const sized = vis.filter((d) => d.complete && d.openWeights && d.size != null);
  add('explorer/overall/size', 'Size to performance', 'Open-weight models: size against score', miniScatter(sized, (d) => d.size, (d) => d.avg));
  add('speed/tps', 'Speed', 'Output tokens per second', miniBars(ranked('tps'), (d) => d.tps, (v) => `${v}`, 3));
  const best = ranked('avg')[0];
  add('profiles', 'Profiles', 'Seven scores as one shape per model', best ? `<svg class="msc" viewBox="0 0 240 92">${[best].map((d) => { const pts = SCORE_KEYS.map((k, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7, r = (d[k] / 100) * 42; return `${(120 + Math.cos(a) * r).toFixed(1)},${(46 + Math.sin(a) * r).toFixed(1)}`; }); return `<polygon points="${SCORE_KEYS.map((k, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7; return `${(120 + Math.cos(a) * 42).toFixed(1)},${(46 + Math.sin(a) * 42).toFixed(1)}`; }).join(' ')}" fill="none" stroke="${C.track}" stroke-width="1.5"/><polygon points="${pts.join(' ')}" fill="${d.tint}" fill-opacity=".2" stroke="${d.tint}" stroke-width="2"/>`; }).join('')}</svg><p class="tnote">${esc(modelEffort(best))}</p>` : '');
  add('ledger', 'Ledger', 'Every column for every entry, sortable', `<p class="tbig">${vis.length}<small> entries</small></p><p class="tnote">price, speed, context, all scores</p>`);
  const hm = ranked('avg').slice(0, 5), range = Object.fromEntries(GLANCE_COLS.map(([k]) => { const v = DATA.map((d) => d[k]).filter((x) => x != null); return [k, [Math.min(...v), Math.max(...v)]]; }));
  add('glance', 'Every score at a glance', 'Sortable heatmap of all scores', `<div class="mhm">${hm.map((d) => GLANCE_COLS.map(([k]) => { const [a, b] = range[k], t = d[k] == null ? 0 : (d[k] - a) / (b - a || 1); return `<i style="background:${k === 'avg' ? C.ink : `hsl(220 78% ${(96 - t * 52).toFixed(0)}%)`}"></i>`; }).join('')).join('')}</div>`);
  const ra = vis.filter((d) => d.re_blind != null && d.re_assisted != null).sort((a, b) => (b.re_assisted - b.re_blind) - (a.re_assisted - a.re_blind)).slice(0, 3);
  add('rehelp', 'Blind vs assisted RE', 'How much rated examples help', `<ol class="mini">${ra.map((d) => `<li><span class="mn">${iconHTML(d)}<b>${esc(modelEffort(d))}</b></span><span class="db"><i style="left:${d.re_blind}%;width:${Math.max(1, d.re_assisted - d.re_blind)}%;background:${d.tint}"></i></span><em>+${(d.re_assisted - d.re_blind).toFixed(1)}</em></li>`).join('')}</ol>`);
  const fam = {}; vis.filter((d) => d.avg != null && d.price > 0 && d.effort in EFFORT_ORDER).forEach((d) => { (fam[d.model] = fam[d.model] || []).push(d); });
  const F = Object.values(fam).filter((g) => g.length > 1).map((g) => g.sort((a, b) => EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]));
  add('effort', 'Is more effort worth it?', 'Each model across its effort levels', `<ol class="mini">${F.slice(0, 3).map((g) => `<li><span class="mn">${iconHTML(g[0])}<b>${esc(g[0].model)}</b></span><em class="wide">${g.map((d) => `${d.effort[0]}${d.effort === 'XHigh' ? 'H' : ''} ${d.avg.toFixed(1)}`).join(' → ')}</em></li>`).join('')}</ol>`);
  const both = vis.filter((d) => d.aaIndex != null && d.avg != null);
  let gen = '';
  if (both.length >= 3) {
    const fit = linFit(both.map((d) => [d.aaIndex, d.avg]));
    const g = both.map((d) => ({ d, gap: d.avg - (fit.a + fit.b * d.aaIndex) })).sort((a, b) => b.gap - a.gap);
    gen = `<ol class="mini">${[g[0], g[1], g[g.length - 1]].map(({ d, gap }) => `<li><span class="mn">${iconHTML(d)}<b>${esc(d.model)}</b></span><em class="${gap >= 0 ? 'up' : 'dn'}">${gap >= 0 ? '▲ +' : '▼ −'}${Math.abs(gap).toFixed(1)}</em></li>`).join('')}</ol>`;
  }
  add('general', 'Gamefeel vs general capability', 'Who beats their Artificial Analysis index', gen);
  const pg = vis.filter((d) => d.gci != null && d.firstSeen).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  let bestSoFar = -Infinity; const recs = pg.filter((d) => (d.gci > bestSoFar ? ((bestSoFar = d.gci), true) : false));
  add('progress', 'Progress over time', 'GCI: the best Gamefeel score so far', recs.length ? `<ol class="mini">${recs.slice(-3).reverse().map((d) => `<li><span class="mn">${iconHTML(d)}<b>${esc(d.model)}</b></span><em class="wide">${d.firstSeen.slice(5)} · GCI ${d.gci.toFixed(1)}</em></li>`).join('')}</ol>` : '');
  return `<div class="tiles">${tiles.map((t) => `<button type="button" class="tile${t.big ? ' big' : ''}" data-open="${t.go}"><span class="th"><b>${esc(t.title)}</b><span class="arrow">↗</span></span><small>${esc(t.sub)}</small><div class="tb">${t.body}</div></button>`).join('')}</div>`;
}

/* ---------- app state ---------- */
const TABS_KEYS = TABS.map((t) => t[0]);
const TOP3 = () => DATA.filter((d) => d.complete).sort((a, b) => b.avg - a.avg).slice(0, 3).map((d) => d.id);
const state = {
  tab: 'overview', scope: 'overall', mode: 'score', metric: 'tps', reView: 'combined',
  sort: { key: 'avg', dir: -1 }, hidden: new Set(), prof: new Set(), spot: null,
  openOnly: false,
  gsort: { key: 'avg', dir: -1 }, hsort: { key: 're_combined', dir: -1 }, asort: { key: 'gap', dir: -1 }, emetric: 'avg', gmetric: 'avg',
};

/* The open-weights switch hides every closed (or unflagged) model in every view, on top of the ticks in the model list. */
const viewHidden = () => (state.openOnly ? new Set([...state.hidden, ...DATA.filter((d) => !d.openWeights).map((d) => d.id)]) : state.hidden);
function buildCurrent() {
  const phone = isPhone();
  const hidden = viewHidden();
  if (state.tab === 'overview') return { html: tilesHTML(hidden) };
  if (phone && state.tab === 'explorer' && state.mode === 'score') return { html: rankListHTML(state.scope, hidden) };
  switch (state.tab) {
    case 'glance': return { html: glanceHTML(state.gsort, hidden) };
    case 'rehelp': return { html: reHelpHTML(state.hsort, hidden) };
    case 'effort': return { html: effortHTML(state.emetric, hidden) };
    case 'general': return { html: generalHTML(state.gmetric, state.asort, hidden) };
    case 'progress': return { html: progressHTML(hidden) };
    case 'overview': return overviewFig(hidden);
    case 'explorer': return state.mode === 'score' ? scoresFig(state.scope, hidden)
      : state.mode === 'size' ? sizeFig(state.scope, hidden) : ppFig(state.scope, hidden);
    case 'profiles': return radarFig([...state.prof], hidden);
    case 'speed': return speedFig(state.metric, hidden);
    case 'ledger': return ledgerFig(state.sort, hidden);
    default: return overviewFig(hidden);
  }
}
function controlsHTML() {
  switch (state.tab) {
    case 'overview':
      return '<span class="crumb">Pick a view</span><span class="hint">Click a tile to open it full width · ☰ lists every view</span>';
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
    case 'glance': case 'rehelp': case 'effort': case 'general': case 'progress':
      return `<span class="crumb">☰ More views · ${esc(EXTRA.find((e) => e[0] === state.tab)[1])}</span><span class="hint">Tick a model on the left to hide it here too</span>`;
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
  $('#shown').textContent = `${DATA.length - viewHidden().size} of ${DATA.length} shown${state.openOnly ? ' · open only' : ''}`;
}
function render() {
  // the RE view toggle applies to the explorer's RE section only; every other tab and view uses combined
  RE_VIEW = state.tab === 'explorer' && state.scope === 're' ? state.reView : 'combined';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#controls').innerHTML = `<div class="seg seg-open" role="group" aria-label="Which models"><button type="button" data-open-only="0" class="${state.openOnly ? '' : 'on'}">All models</button><button type="button" data-open-only="1" class="${state.openOnly ? 'on' : ''}">Open weights</button></div>` + controlsHTML();
  const f = buildCurrent();
  const sentence = (t) => { const x = t.toLowerCase().replace(/\bre\b/g, 'RE').replace(/\bgci\b/g, 'GCI'); return x[0].toUpperCase() + x.slice(1); };
  const fi = FRAME_INFO, y0 = fi ? fi.y : 0;
  $('#stage').innerHTML = f.html ? `<div class="fig sections">${f.html}</div>`
    : `<div class="fig${f.wide ? ' wide' : ''}"><section class="card chart"><header class="chead"><h2>${esc(sentence(fi.title))}</h2><p>${esc(fi.lines[0] || '')}</p>` +
      (fi.lines.length > 1 ? `<details><summary>How to read this chart</summary>${fi.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join('')}</details>` : '') +
      `</header><svg viewBox="0 ${y0} ${f.W} ${f.H - y0}" xmlns="http://www.w3.org/2000/svg">${f.body}</svg></section></div>`;
  // the crop sits just below the title block; a chart label that reaches above it (the radar's top axis) moves the crop up
  const svg = !f.html && $('#stage .card.chart svg');
  if (svg) {
    let top = y0;
    const above = [];
    svg.querySelectorAll('text').forEach((t) => { const bb = t.getBBox(); if (bb.y + bb.height > y0 + 2) { if (bb.y < top) top = bb.y; } else above.push(t); });
    if (top < y0) { above.forEach((t) => t.remove()); svg.setAttribute('viewBox', `0 ${top - 8} ${f.W} ${f.H - top + 8}`); }
  }
  renderMenu();
  $('#stage').scrollTop = 0;
  applySpot();
  renderSidebar();
  writeHash();
}
function readHash() {
  const [tab, a, b, c] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (TABS_KEYS.includes(tab) || EXTRA_KEYS.includes(tab)) state.tab = tab;
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
  else if (ds.pscope) state.pscope = ds.pscope;
  else if (ds.openOnly) { state.openOnly = ds.openOnly === '1'; try { localStorage.setItem('gfOpenOnly', ds.openOnly); } catch (err) { /* private mode */ } }
  else if (ds.metric) state.metric = ds.metric;
  else if (ds.prof) toggle(state.prof, ds.prof);
  else if (ds.act === 'top3') state.prof = new Set(TOP3());
  else return;
  render();
});
$('#stage').addEventListener('click', (e) => {
  const tile = e.target.closest('[data-open]');
  if (tile) {
    const go = () => { history.replaceState(null, '', '#' + tile.dataset.open); readHash(); render(); const f = $('#stage .fig'); if (f) f.style.viewTransitionName = 'hero'; };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { go(); return; }
    tile.style.viewTransitionName = 'hero';
    document.startViewTransition(go).finished.finally(() => { const f = $('#stage .fig'); if (f) f.style.viewTransitionName = ''; });
    return;
  }
  const b = e.target.closest('[data-gsort],[data-hsort],[data-asort],[data-emetric],[data-gmetric]');
  if (b) {
    const flip = (cur, k, textFirst) => (cur.key === k ? { key: k, dir: -cur.dir } : { key: k, dir: textFirst ? 1 : -1 });
    const ds = b.dataset;
    if (ds.gsort) state.gsort = flip(state.gsort, ds.gsort, ds.gsort === 'model');
    else if (ds.hsort) state.hsort = flip(state.hsort, ds.hsort, ds.hsort === 'model');
    else if (ds.asort) state.asort = flip(state.asort, ds.asort, ds.asort === 'model');
    else if (ds.emetric) state.emetric = ds.emetric;
    else if (ds.gmetric) state.gmetric = ds.gmetric;
    render(); return;
  }
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
setSide(false);   // the model list starts collapsed; the Models button opens it
try { state.openOnly = localStorage.getItem('gfOpenOnly') === '1'; } catch (err) { /* private mode */ }
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
/* ☰ menu: every section, the five tabs first, then the extra views */
function renderMenu() {
  const item = ([k, l, sub], key) => `<button type="button" data-goto="${k}" class="${state.tab === k ? 'on' : ''}"><b>${esc(l)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}<kbd>${key}</kbd></button>`;
  $('#menu').innerHTML = `<div class="mhead">Views</div>${TABS.map((t, i) => item(t, i + 1)).join('')}<div class="mhead">More views</div>${EXTRA.map((t, i) => item(t, i + 6)).join('')}`;
}
const setMenu = (open) => { $('#menu').hidden = !open; $('#menuBtn').setAttribute('aria-expanded', String(open)); };
$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); setMenu($('#menu').hidden); });
$('#menu').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (!b) return; state.tab = b.dataset.goto; setMenu(false); render(); });
document.addEventListener('click', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu')) setMenu(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setMenu(false); return; }
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const i = '123456789'.indexOf(e.key);   // 1-5 tabs, 6-9 the first four extra views (the rest via ☰)
  if (i >= 0) { state.tab = i < 5 ? TABS_KEYS[i] : EXTRA_KEYS[i - 5]; render(); }
});
let wasPhone = isPhone();
addEventListener('resize', () => { if (isPhone() !== wasPhone) { wasPhone = isPhone(); render(); } });
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
  // the three RE sections also ship as separate images, alongside the stacked scores-re above
  { name: 'scores-re-blind', build: () => reSingleFig('blind') },
  { name: 'scores-re-assisted', build: () => reSingleFig('assisted') },
  { name: 'scores-re-combined', build: () => reSingleFig('combined') },
  { name: 'size-performance-overall', build: () => sizeFig('overall', NONE) },
  // the Qwen highlight: the overall and RE price charts and the overall size chart, with both Qwen-4 models left off the blue line and measured in purple
  { name: 'qwen-highlight-price-performance-overall', build: () => ppFig('overall', NONE, true) },
  { name: 'qwen-highlight-price-performance-re', build: () => ppFig('re', NONE, true) },
  { name: 'qwen-highlight-size-performance-overall', build: () => sizeFig('overall', NONE, true) },
  // the HTML views from the ☰ menu, all models, default sort
  { name: 'view-every-score-at-a-glance', build: () => ({ html: glanceHTML({ key: 'avg', dir: -1 }, NONE) }) },
  { name: 'view-re-blind-vs-assisted', build: () => ({ html: reHelpHTML({ key: 're_combined', dir: -1 }, NONE) }) },
  { name: 'view-effort-overall', build: () => ({ html: effortHTML('avg', NONE) }) },
  { name: 'view-effort-re', build: () => ({ html: effortHTML('re', NONE) }) },
  { name: 'view-general-capability-overall', build: () => ({ html: generalHTML('avg', { key: 'gap', dir: -1 }, NONE) }) },
  { name: 'view-general-capability-re', build: () => ({ html: generalHTML('re', { key: 'gap', dir: -1 }, NONE) }) },
  { name: 'view-progress-gci', build: () => ({ html: progressHTML(NONE) }) },
];
window.renderExport = (name) => {
  const e = EXPORTS.find((x) => x.name === name);
  if (!e) throw new Error('unknown export ' + name);
  RE_VIEW = 'combined';   // exports always use the combined RE score, whatever the explorer is showing
  const keepOpen = state.openOnly; state.openOnly = false;   // exports always show every model
  const f = e.build();
  state.openOnly = keepOpen;
  if (f.html) {   // an HTML view: laid out at 1536 CSS px and zoomed 2x, so it is captured 6144 px wide like the rest
    $('#exportStage').innerHTML = `<div class="fig hexport">${f.html}</div>`;
    document.body.classList.add('exporting');
    return { W: 3072, H: Math.round($('#exportStage .fig').getBoundingClientRect().height) };
  }
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
