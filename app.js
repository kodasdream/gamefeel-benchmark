/* ============================================================
   DATA: read at start-up from data/ and lab-icons/. build-benchmark.py writes these files from
   gamefeelbench.xlsx on Google Drive. Edit the spreadsheet, not the files.
   ============================================================ */
let DATA = [];
let ICONS = {};
let META = {};
let LABS_MAP = {};
let VERSIONS = null;
// the current standard's name (v1.5.3 on 2026-11-27), for footnotes that say a model is waiting for a re-run on it
const CUR_STD = () => (VERSIONS && VERSIONS.latest) || META.standard || 'v1.5.3';
let LATEST_BUNDLE = null;
const VERSION_CACHE = new Map();

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
function parseRows(csv, labs) {
  const num = (v) => (v === '' || v == null ? null : Number(v));
  return parseCSV(csv).map((r) => {
    const lab = labs[r.lab_key] || labs.unknown;
    const reComb = num(r.re_combined ?? r.re ?? '');
    return {
      id: [r.model, r.effort].filter(Boolean).join(' · '), model: r.model, effort: r.effort,
      lab: lab.lab, tint: lab.colour, icon: lab.icon,
      price: num(r.price_per_task_usd), basis: r.billing, context: r.context,
      timeMin: num(r.minutes_per_task), compress: num(r.context_compression_per_task),
      tps: num(r.tokens_per_second),
      openWeights: r.open_weights === 'yes', size: num(r.size_gb), sizeBasis: r.size_basis || '',
      reNote: r.re_test || '', aaIndex: num(r.aa_index || ''), gci: num(r.gci || ''), firstSeen: r.release_date || '',   // set only on a result from the semi-private subset of the RE test
      ...Object.fromEntries(SCORE_KEYS.map((k) => [k, k === 're' ? reComb : num(r[k])])),
      re_blind: num(r.re_blind), re_assisted: num(r.re_assisted), re_released: num(r.re_released), re_combined: reComb,
      re_blind_hard: num(r.re_blind_hard ?? ''), re_assisted_hard: num(r.re_assisted_hard ?? ''), reLegacy: r.re_legacy || '', reBlindOld: num(r.re_blind_legacy ?? ''), reAssistedOld: num(r.re_assisted_legacy ?? ''),
      reBlindHardOld: num(r.re_blind_hard_legacy ?? ''), reAssistedHardOld: num(r.re_assisted_hard_legacy ?? ''),
    };
  });
}
async function loadData() {
  const [csv, labsCsv, meta, versionsText] = await Promise.all([
    fetchText('data/gamefeelbench.csv'), fetchText('data/labs.csv'), fetchText('data/meta.json'),
    fetchText('data/versions.json').catch(() => null),
  ]);
  const labs = Object.fromEntries(parseCSV(labsCsv).map((l) => [l.lab_key, l]));
  const slugs = [...new Set([...Object.values(labs).map((l) => l.icon), 'unknown'])];
  const icons = Object.fromEntries(await Promise.all(
    slugs.map(async (s) => [s, parseIcon(await fetchText(`lab-icons/${s}.svg`))]),
  ));
  const rows = parseRows(csv, labs);
  return { rows, icons, labs, meta: JSON.parse(meta), versions: versionsText ? JSON.parse(versionsText) : null };
}

/* ---------- constants ---------- */
const RE_WEIGHT = 1.5;   // v1.5.1+: RE combined counts 1.5x in the overall
const SCORE_KEYS = ['create', 'bugfix', 'gamefeel', 'ideas', 'visuals', 'audio', 're'];
const SCOPES = [
  ['overall', 'Overall'], ['create', 'Coding · create'], ['bugfix', 'Coding · debugging'], ['gamefeel', 'Gamefeel'],
  ['ideas', 'Creativity · ideas'], ['visuals', 'Creativity · visuals'], ['audio', 'Creativity · audio'],
  ['re', 'Gamefeel · RE'],
];
const SCOPE_LABEL = Object.fromEntries(SCOPES);
// Overall averages RE combined only — the explorer's RE view toggle (blind/assisted) never changes that.
const SUBCATEGORY_LIST = SCOPES.slice(1).map(([k, l]) => (k === 're' ? `${l} (combined, 1.5x weight)` : l)).join(', ');   // the seven subcategories the overall averages
const TABS = [['overview', 'Overview'], ['explorer', 'Explorer'], ['profiles', 'Profiles'], ['speed', 'Speed'], ['ledger', 'Ledger'], ['method', 'Method']];
const BASIS_WORD = { sub: 'subscription', api: 'API', free: 'free' };
const PRICE_FLOOR = 0.02;          // free models are drawn at this price on the log axis
const NEW_MODELS = ['Sonnet-next'];   // only the latest additions: a small NEW! over their columns, in the bar's colour
const isNew = (d) => !META.is_historical && (NEW_MODELS.includes(d.model) || NEW_MODELS.includes(`${d.model} · ${d.effort}`));   // a bare name tags every effort level; 'Name · Effort' tags one
const isWarn = (d) => /qoduck|qohawk/i.test(d.model);   // kept permanently: an orange ! in a triangle over their results
const WARN_C = '#f08c00';
const warnSvg = (cx, base, h = 34) => { const w = h * 1.12, r = (v) => v.toFixed(1); return `<path d="M${r(cx)} ${r(base - h)}L${r(cx + w / 2)} ${r(base)}H${r(cx - w / 2)}Z" fill="#fff" stroke="${WARN_C}" stroke-width="3.5" stroke-linejoin="round"/><text x="${r(cx)}" y="${r(base - 6)}" font-size="${r(h * 0.62)}" font-weight="900" text-anchor="middle" fill="${WARN_C}">!</text>`; };
const warnHTML = '<span class="warnb" aria-label="warning">!</span>';
const W = 1600;                    // figure width (ledger uses WL)
const WC = 2600;                   // bar charts: 24 columns side by side, wide enough for chunky bars
const WL = 2480;
const WP = 3400;                 // price-to-performance canvas: 2:1 (18:9), wider than the rest for room
const TOP = 280;                   // first content line, below the title block
// RE board (opt-in look in the RE section): the five parts in the validated reference categorical slots 1-5, fixed order
const RE_PART_COLOR = { re_blind: '#2a78d6', re_blind_hard: '#eb6834', re_assisted: '#1baf7a', re_assisted_hard: '#eda100', re_released: '#e87ba4' };
const LEGACY_FILL = '#c3cad8';     // an older v1.5.1 RE score: its parts are unknown, so one neutral block
const C = { ink: '#1b2434', soft: '#5a6478', faint: '#98a1b5', track: '#e6ebf5', azure: '#2b6cee', gold: '#c89600', zebra: '#f5f7fb' };
const NONE = new Set();
/* Dark theme (header switch): page colours live in style.css; here only what the JS writes inline. */
const isDark = () => document.documentElement.dataset.theme === 'dark';
const lum = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1; const n = parseInt(m[1], 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
// dark theme: lab colours are mixed 18% toward white so bars and logos stay bright on the gray; a near-black one becomes light gray
const lighten = (hex, f) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex; const n = parseInt(m[1], 16); return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * f).toString(16).padStart(2, '0')).join(''); };
const themedTint = (t) => (!isDark() ? t : lum(t) < 0.05 ? '#d2d2d2' : lighten(t, 0.18));
const heatBg = (t) => (isDark() ? `hsl(220 50% ${(24 + t * 34).toFixed(0)}%)` : `hsl(220 78% ${(96 - t * 52).toFixed(0)}%)`);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const standardTag = () => (META.standard ? ` · ${esc(META.standard).toUpperCase()}` : '');

/* ---------- version-aware scoring metadata & derived fields ---------- */
const activeScoreKeys = () => (META.score_keys && META.score_keys.length ? META.score_keys : SCORE_KEYS);
const activeReWeight = () => (META.re_weight != null ? META.re_weight : RE_WEIGHT);
const activeReMode = () => META.re_mode || 'v152';
const activeReViews = () => ({
  none: [],
  single: ['combined'],
  split3: ['combined', 'blind', 'assisted'],
  split4: ['combined', 'blind', 'assisted', 'released'],
  v152: RE_VIEWS,
}[activeReMode()] || RE_VIEWS);
const subcategoryList = () => {
  const ks = activeScoreKeys(), rw = activeReWeight(), rm = activeReMode();
  return ks.map((k) => {
    const l = SCOPE_LABEL[k] || k;
    if (k !== 're') return l;
    if (rm === 'single') return l;
    return rw === 1.5 ? `${l} (combined, 1.5x weight)` : `${l} (combined)`;
  }).join(', ');
};
function deriveFields() {
  const ks = activeScoreKeys(), rw = activeReWeight();
  const wt = (k) => (k === 're' ? rw : 1);
  const wsum = ks.reduce((a, k) => a + wt(k), 0);
  DATA.forEach((d) => {
    if (d.tint0 == null) d.tint0 = d.tint;
    d.tint = themedTint(d.tint0);
    d.complete = ks.every((k) => d[k] != null);
    d.avg = d.complete ? Math.round((ks.reduce((a, k) => a + wt(k) * d[k], 0) / wsum) * 100) / 100 : null;
    d.free = d.price === 0;
    d.px = d.price == null ? null : Math.max(d.price, PRICE_FLOOR);   // no price: not drawn on a price chart
    d.value = d.avg != null && d.price > 0 ? Math.round((d.avg / d.price) * 100) / 100 : null;
  });
}
// Overall only ranks models with all seven scores (six scores plus Gamefeel RE combined). Subcategories rank any model with that score.
// The explorer's RE section can toggle between combined / blind / assisted / released / blind hard / assisted hard. RE_VIEW is set by render() for that
// view only; renderExport() resets it to 'combined', so exports and every other tab always use the combined score.
const RE_VIEWS = ['combined', 'blind', 'assisted', 'released', 'blind-hard', 'blind-hard-human', 'assisted-hard', 'combined-hard'];
const RE_FIELD = { combined: 're_combined', blind: 're_blind', assisted: 're_assisted', released: 're_released', 'blind-hard': 're_blind_hard', 'blind-hard-human': 're_blind_hard', 'assisted-hard': 're_assisted_hard', 'combined-hard': 're_combined_hard' };
const RE_LABEL = { combined: 'Combined', blind: 'Blind', assisted: 'Assisted', released: 'Released', 'blind-hard': 'Blind hard', 'blind-hard-human': 'Blind hard · vs Human', 'assisted-hard': 'Assisted hard', 'combined-hard': 'Combined hard' };
// Human reference baselines on Blind Hard (unreleased game, hand-rated cards, 1x):
// regular Blind Hard shows only the ~2% inexperienced gamer line so the AI scale stays unstretched;
// the dedicated Blind Hard · vs Human section scales to 60% to show both baselines together.
const HUMAN_AVG_BLIND_HARD = { v: 2, label: '~2% · Avg 120 IQ human gamer (no experience)', color: '#64748b' };
const HUMAN_EXPERT_BLIND_HARD = { v: 60, label: '~60% · Human expert (100+ hrs experience)', color: '#0f766e' };
// v1.5.2 RE combined (computed by the build): weighted mean of five parts; a missing part is estimated from the parts the model has
const RE_PARTS = [['re_blind', 'blind', 5], ['re_blind_hard', 'blind hard', 2], ['re_assisted', 'assisted', 3], ['re_assisted_hard', 'assisted hard', 1], ['re_released', 'released', 2]];
const RE_RULE = 'Combined = (5 × blind + 2 × blind hard + 3 × assisted + 1 × assisted hard + 2 × released) ÷ 13. A part a model has not run is estimated from the parts it has.';
const RE_HARD = 'Hard: the same run, scored only on the locked set of 400 hand-rated cards AI misjudges most, at 1x.';
// "3 of 5 parts (no assisted, assisted hard)" for a tooltip
// a combined column split into what each part adds (RE board); a part the model has not run is estimated as the build does
function reSegs(d) {
  if (d.reLegacy) return [{ v: d.re_combined, color: LEGACY_FILL, legacy: true }];
  const sc = META.re_combined && META.re_combined.scale;
  const have = RE_PARTS.filter(([k]) => d[k] != null);
  if (!sc || !have.length) return null;
  const level = have.reduce((a, [k, , w]) => a + (w * d[k]) / sc[k], 0) / have.reduce((a, [, , w]) => a + w, 0);
  return RE_PARTS.map(([k, l, w]) => ({ k, l, v: (w * (d[k] != null ? d[k] : sc[k] * level)) / 13, color: RE_PART_COLOR[k], est: d[k] == null }));
}
const segTip = (segs) => (segs && !segs[0].legacy ? ` · adds: ${segs.map((g) => `${g.l} ${g.v.toFixed(2)}${g.est ? ' (est.)' : ''}`).join(', ')}` : '');
let HATCH_N = 0;
const hatchDefs = (id, color) => `<pattern id="${id}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="14" height="14" fill="${color}" fill-opacity=".18"/><rect width="5" height="14" fill="${color}" fill-opacity=".9"/></pattern>`;
const reParts = (d) => {
  const rm = activeReMode();
  if (rm === 'none') return 'no RE in this version';
  if (rm === 'single') return `single RE score (${META.standard || 'historical'})`;
  if (rm === 'split3' || rm === 'split4') {
    const ks = rm === 'split4' ? [['re_blind', 'blind'], ['re_assisted', 'assisted'], ['re_released', 'released']] : [['re_blind', 'blind'], ['re_assisted', 'assisted']];
    const have = ks.filter(([k]) => d[k] != null).map(([, l]) => l);
    return have.length ? `from ${have.join(' + ')}` : '';
  }
  if (d.reLegacy) return `estimated on ${CUR_STD()} from older v1.5.1 RE run, until re-run`;
  const miss = RE_PARTS.filter(([k]) => d[k] == null).map(([, l]) => l);
  return miss.length ? `${5 - miss.length} of 5 RE parts, ${miss.join(' and ')} estimated` : 'all 5 RE parts';
};
// For Blind Hard, Assisted Hard and Combined Hard charts, models without a v1.5.2 run show their recalculated v1.5.1 1x human-only score, marked †.
const combinedHardOf = (d) => {
  const bh = d.re_blind_hard ?? d.reBlindHardOld, ah = d.re_assisted_hard ?? d.reAssistedHardOld;
  if (bh == null && ah == null) return null;
  if (ah == null) return bh;
  if (bh == null) return ah;
  return 0.66 * bh + 0.34 * ah;
};
// blind and assisted: a model not re-run on v1.5.2 shows its v1.5.1 run, marked † outdated (user: don't exclude old RE scores anywhere)
const valOfPart = (d, key) => (key === 're_blind' ? (d.re_blind ?? d.reBlindOld)
  : key === 're_assisted' ? (d.re_assisted ?? d.reAssistedOld)
  : key === 're_blind_hard' ? (d.re_blind_hard ?? d.reBlindHardOld)
  : key === 're_assisted_hard' ? (d.re_assisted_hard ?? d.reAssistedHardOld)
  : key === 're_combined_hard' ? combinedHardOf(d)
  : d[key]);
const isPartLegacy = (d, key) => (key === 're_combined' ? Boolean(d.reLegacy)
  : key === 're_blind' ? (d.re_blind == null && d.reBlindOld != null)
  : key === 're_assisted' ? (d.re_assisted == null && d.reAssistedOld != null)
  : key === 're_blind_hard' ? (d.re_blind_hard == null && d.reBlindHardOld != null)
  : key === 're_assisted_hard' ? (d.re_assisted_hard == null && d.reAssistedHardOld != null)
  : key === 're_combined_hard' ? ((d.re_blind_hard == null && d.reBlindHardOld != null) || (d.re_assisted_hard == null && d.reAssistedHardOld != null))
  : false);
let RE_VIEW = 'combined';
const scoreOf = (d, scope) => (scope === 'overall' ? (d.complete ? d.avg : null)
  : scope === 're' ? (valOfPart(d, RE_FIELD[RE_VIEW]) ?? null) : (d[scope] ?? null));
const scopeLegacyKey = (scope) => (scope === 'overall' ? 're_combined'
  : scope === 're' ? RE_FIELD[RE_VIEW]
  : null);
// One column per model: keep the best-scoring reasoning effort. Callers pass rows sorted best-first.
const TOP_N = 35;   // score charts show the top 35 models, each once at its best reasoning effort
const topNote = (shown, total) => (shown < total ? `Top ${shown} of ${total} models, each at its best reasoning effort.` : `All ${total} models, each at its best reasoning effort.`);
const bestPerModel = (rows) => { const seen = new Set(); return rows.filter((d) => (seen.has(d.model) ? false : (seen.add(d.model), true))); };
const priceText = (d) => (d.price == null ? 'no price given' : d.free ? 'free' : `$${d.price.toFixed(2)}/task${d.basis ? ` · ${BASIS_WORD[d.basis] || d.basis}` : ''}`);
const priceLabel = (d) => (d.price == null ? 'no price' : d.free ? 'free' : `$${d.price.toFixed(2)}`);   // under a column
// A result from the semi-private subset of the RE test has a note (workbook column V) and an asterisk.
// A model with no v1.5.2 RE run keeps its v1.5.1 RE combined (re_legacy) or recalculated v1.5.1 hard score, marked with a dagger.
let LEGACY_MARK = null;
const shortName = (d) => d.model + (d.reNote ? '*' : '') + (LEGACY_MARK && isPartLegacy(d, LEGACY_MARK) ? '†' : '');
const withLegacy = (on, fn) => { const k = LEGACY_MARK; LEGACY_MARK = on === true ? 're_combined' : (on || null); try { return fn(); } finally { LEGACY_MARK = k; } };
const legacyFootnote = (rows, key = LEGACY_MARK || 're_combined') => {
  if (!rows.some((d) => isPartLegacy(d, key))) return null;
  if (key === 're_blind_hard' || key === 're_assisted_hard' || key === 're_combined_hard') return `† Outdated: recalculated from the model's v1.5.1 run (human-rated cards only, 1x), until it is re-run on ${CUR_STD()}.`;
  if (key === 're_blind' || key === 're_assisted') return `† Outdated: the model's v1.5.1 run (same games, older handoff wording), until it is re-run on ${CUR_STD()}.`;
  return `† Outdated: estimated on ${CUR_STD()} from the model's older v1.5.1 RE run (calibrated per part, never extrapolated from released games alone), until re-run.`;
};
const modelEffort = (d) => [d.model, d.effort].filter(Boolean).join(' · ');
const namesOf = (rows) => [...new Set(rows.map((d) => d.model))].join(', ');
const RE_FULL = 'Every other result is the full RE test, over 8,000 tasks.';
// one asterisk line per distinct note (e.g. GPT-6.1 on 748 tasks, GPT-6.2 on 765), then the full-test sentence
const reFootnote = (rows) => {
  const byNote = new Map();
  rows.forEach((d) => { if (!byNote.has(d.reNote)) byNote.set(d.reNote, []); byNote.get(d.reNote).push(d); });
  return [...byNote].map(([note, rs]) => `* ${namesOf(rs)}: ${note}.`).join(' ') + ` ${RE_FULL}`;
};
const fmt2 = (v) => (v == null ? '—' : v.toFixed(2));
const fmtScore = (v) => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(2));
const fmtScope = (scope, v) => (scope === 'overall' || scope === 're' ? fmt2(v) : fmtScore(v));
const scopeTitle = (s) => (s === 'overall' ? 'OVERALL' : SCOPE_LABEL[s].toUpperCase());
const figTitle = (s) => (s === 're' ? (activeReMode() === 'single' || activeReMode() === 'none' ? 'GAMEFEEL · RE' : `GAMEFEEL · RE (${RE_LABEL[RE_VIEW].toUpperCase()})`) : scopeTitle(s));
const RE_TIP = {
  combined: 'Blind, assisted, released and the two hard scores combined — the score Overall uses (at 1.5x weight)',
  blind: 'No worked examples shown — the model rates the proposals cold',
  assisted: 'The model studies 39 rated worked examples before rating the rest',
  released: 'Blind, on proposals for released commercial games',
  'blind-hard': 'Blind, scored only on the locked set of 400 hand-rated cards AI misjudges most (includes ~2% average human gamer baseline)',
  'blind-hard-human': 'Blind hard scaled to 60% to compare AI models against ~2% average 120 IQ human gamer (no experience) and ~60% human expert (100+ hrs)',
  'assisted-hard': 'Assisted, scored only on the locked set of 400 hand-rated cards AI misjudges most',
  'combined-hard': '0.66 × blind hard + 0.34 × assisted hard (locked 400-card Hard set, 1x)',
};
const RE_LINES = {
  combined: [
    'Gamefeel RE combined: how well the model gives feedback on game proposals, especially on balance. Overall uses this score.',
    RE_RULE,
  ],
  blind: [
    'Gamefeel RE blind: how well the model gives feedback on game proposals, especially on balance.',
    'Blind: no worked examples, the model rates the proposals cold. Overall uses RE combined, not this view.',
  ],
  assisted: [
    'Gamefeel RE assisted: how well the model gives feedback on game proposals, especially on balance.',
    'Assisted: the model studies 39 rated examples first, then rates the rest. Overall uses RE combined, not this view.',
  ],
  released: [
    'Gamefeel RE released-blind: feedback on game proposals for released commercial games, such as Balatro, Slay the Spire and World of Warcraft.',
    'Blind: no worked examples. Overall uses RE combined, not this view.',
  ],
  'blind-hard': [
    'Gamefeel RE blind hard: the blind run, scored only on the locked set of 400 hand-rated cards AI misjudges most, at 1x.',
    'Dashed reference line: ~2% average 120 IQ human gamer (no gameplay experience in the unreleased game). See Blind hard · vs Human for the ~60% human expert baseline.',
  ],
  'blind-hard-human': [
    'Gamefeel RE blind hard vs human baselines: the locked set of 400 hand-rated cards AI misjudges most (1x), scaled to 60% so the gap to a human expert is visible.',
    'Average 120 IQ human gamer (no gameplay experience in the unreleased game): ~2%. Human expert (100+ hours of gameplay experience): ~60%.',
  ],
  'assisted-hard': [
    'Gamefeel RE assisted hard: the assisted run, scored only on the locked set of 400 hand-rated cards AI misjudges most, at 1x.',
    '39 rated worked examples studied first. Overall uses RE combined, not this view.',
  ],
  'combined-hard': [
    'Gamefeel RE combined hard: 0.66 × blind hard + 0.34 × assisted hard (or whichever is available), scored only on the locked set of 400 hand-rated cards AI misjudges most at 1x.',
    'Overall uses full RE combined, not this view.',
  ],
};
/* Where a figure's content starts: the title block has room for two subtitle lines; each extra line pushes the content down. */
const topFor = (lines) => TOP + 36 * Math.max(0, lines.length - 2);
const reContextLine = () => {
  const rm = activeReMode();
  if (rm === 'none') return 'Gamefeel · RE was introduced in v1.3.';
  if (rm === 'single') return 'Score = Gamefeel RE (single score, equal weight in Overall).';
  if (RE_VIEW === 'combined' && rm === 'split3') return 'Score = RE combined (0.66 × blind + 0.34 × assisted). Overall uses this score at 1x weight.';
  if (RE_VIEW === 'combined' && rm === 'split4') return 'Score = RE combined (blind, assisted and released-games RE). Overall uses this score at 1.5x weight.';
  return RE_VIEW === 'combined'
    ? `Score = RE combined. ${RE_RULE} Overall uses this score at 1.5x weight.`
    : RE_VIEW === 'blind-hard-human'
      ? `Score = RE blind hard vs human baselines (~2% avg 120 IQ gamer, ~60% expert with 100+ hrs). ${RE_HARD} Overall uses RE combined, not this view.`
    : RE_VIEW.endsWith('-hard')
      ? `Score = RE ${RE_LABEL[RE_VIEW].toLowerCase()}. ${RE_HARD} Overall uses RE combined, not this view.`
    : RE_VIEW === 'blind'
      ? 'Score = RE blind (no worked examples shown). Overall uses RE combined, not this view.'
      : RE_VIEW === 'released'
        ? 'Score = RE released-blind (released commercial games, no worked examples). Overall uses RE combined, not this view.'
        : 'Score = RE assisted (39 rated worked examples studied first). Overall uses RE combined, not this view.';
};

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
/* The scale of one chart: minVal (0 by default) up to its largest value, so the tallest column reaches the top. Round
   gridlines sit well below that top, and the top itself is labelled with the value. */
function fitAxis(maxVal, minVal = 0) {
  const lo = minVal > 0 && maxVal > minVal ? minVal : 0;
  const span = maxVal - lo;
  if (!(span > 0)) return { min: lo, max: lo + 1, ticks: [lo, lo + 1] };   // every column is at baseline: no loop
  const raw = span / (lo > 0 ? 7 : 6), mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const ticks = [lo];
  const first = lo > 0 ? Math.floor(lo / step + 1 + 1e-9) * step : step;
  for (let t = first; t <= lo + span * 0.93 + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  return { min: lo, max: maxVal, ticks: [...ticks, maxVal] };
}
/* One column per item, left to right in the order given. Items are { d, v, value, tip }.
   The value sits on each cap. Under the axis come the lab icon, effort and price, and the model
   name hangs diagonally below. Fewer models give wider columns. Returns the figure height and the
   body; the caller adds the frame. */
function columnChart(items, o) {
  if (!items.length) return { H: o.top + 700, body: emptyNote(WC, o.top + 200, o.empty) };
  const X0 = 64 + COL.axis, X1 = (o.width || WC) - 64, PW = X1 - X0;
  const yT = o.top + 70, yB = yT + COL.plot;
  const yMin = o.min || 0, ySpan = Math.max(1e-9, o.max - yMin);
  // room under the axis for the longest diagonal name, plus a footnote line below it
  const drop = Math.max(...items.map((it) => textW(shortName(it.d), 23, 800))) * Math.SQRT1_2;
  const H = Math.max(yB + COL.label + 150, yB + 150 + drop + 90);
  const Y = (v) => yB - ((v - yMin) / ySpan) * COL.plot;
  const pitch = Math.min(PW / items.length, 220), bw = Math.min(pitch * 0.74, 160);
  // dense charts (every model at its best effort) shrink the cap labels so neighbours never collide
  const maxValW = Math.max(1, ...items.map((it) => textW(String(it.value || ''), 30, 800)));
  const vFont = Math.min(30, Math.max(13, ((pitch * 0.9) / maxValW) * 30));
  const sFont = Math.min(20, Math.max(11, pitch * 0.26));
  const iSize = Math.min(40, pitch * 0.8);
  const x0 = X0 + (PW - pitch * items.length) / 2;
  let s = '';
  const hid = {};   // hatch patterns for estimated parts, one per colour, unique to this chart
  items.forEach((it) => (it.segs || []).forEach((g) => { if (g.est && !hid[g.color]) { hid[g.color] = `hatch${++HATCH_N}`; } }));
  if (Object.keys(hid).length) s += `<defs>${Object.entries(hid).map(([c, id]) => hatchDefs(id, c)).join('')}</defs>`;
  o.ticks.forEach((t) => {
    const y = Y(t).toFixed(1);
    s += `<line x1="${X0}" y1="${y}" x2="${X1}" y2="${y}" stroke="${t === yMin ? C.ink : C.track}" stroke-opacity="${t === yMin ? 0.25 : 1}" stroke-width="2"/>`;
    s += `<text x="${X0 - 18}" y="${(Y(t) + 8).toFixed(1)}" font-size="22" font-weight="700" text-anchor="end" fill="${C.soft}">${+t.toFixed(1)}</text>`;
  });
  s += `<text x="${X0 - 18}" y="${yT - 30}" font-size="20" font-weight="700" text-anchor="end" fill="${C.faint}">${esc(o.unit)}</text>`;
  const refLines = (o.refLines || []).filter((rl) => rl.v >= yMin && rl.v <= o.max);
  // Draw horizontal reference lines behind all bars and text
  refLines.forEach((rl) => {
    const ry = Y(rl.v);
    s += `<line x1="${X0}" y1="${ry.toFixed(1)}" x2="${X1}" y2="${ry.toFixed(1)}" stroke="${rl.color}" stroke-width="3" stroke-dasharray="12 9" stroke-opacity="0.72"/>`;
  });
  const colTops = [];
  const valHalo = refLines.length ? ' paint-order="stroke" stroke="#ffffff" stroke-width="6" stroke-linejoin="round"' : '';
  items.forEach((it, i) => {
    const d = it.d, cx = x0 + pitch * (i + 0.5);
    const h = Math.max(6, ((it.v - yMin) / ySpan) * COL.plot), top = yB - h;
    const labelTop = top - 14 - vFont - (isNew(d) ? 42 : 0) - (isWarn(d) ? 34 : 0);
    colTops.push({ x0: cx - pitch / 2, x1: cx + pitch / 2, top: labelTop });
    const nx = Math.max(cx + 12, 24 + textW(shortName(d), 23, 800) * Math.SQRT1_2);   // a long diagonal name stays inside the figure
    s += `<g class="col" data-m="${esc(d.id)}" data-tip="${esc([shortName(d), d.effort, d.lab, it.tip].filter(Boolean).join(' · '))}">`;
    s += `<rect x="${(cx - pitch / 2).toFixed(1)}" y="${yT - 60}" width="${pitch.toFixed(1)}" height="${COL.plot + COL.label + 60}" fill="transparent"/>`;
    if (it.segs) {   // stacked parts, bottom up, with a 2-unit surface gap between them; the top one carries the rounded cap
      const segs = it.segs.filter((g) => g.v > 0), tot = segs.reduce((a, g) => a + g.v, 0);
      let yy = yB;
      segs.forEach((g, j) => {
        const hh = (g.v / tot) * h, yTop = yy - hh, yBot = j ? yy - 2 : yy;
        if (yBot - yTop > 0.5) {
          const fill = g.est ? `url(#${hid[g.color]})` : g.color;
          s += j === segs.length - 1 ? `<path d="${capPath(cx - bw / 2, cx + bw / 2, yTop, yBot, Math.min(8, bw / 2, yBot - yTop))}" fill="${fill}"/>`
            : `<rect x="${(cx - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${(yBot - yTop).toFixed(1)}" fill="${fill}"/>`;
        }
        yy = yTop;
      });
    } else s += `<path d="${capPath(cx - bw / 2, cx + bw / 2, top, yB, Math.min(8, bw / 2, h))}" fill="${d.tint}"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(top - 14).toFixed(1)}" font-size="${vFont.toFixed(1)}" font-weight="800" text-anchor="middle" fill="${C.ink}"${valHalo}>${esc(it.value)}</text>`;
    if (isNew(d)) s += `<text x="${cx.toFixed(1)}" y="${(top - 52).toFixed(1)}" font-size="20" font-weight="800" letter-spacing="1" text-anchor="middle" fill="${d.tint}">NEW!</text>`;
    if (isWarn(d)) s += warnSvg(cx, top - (isNew(d) ? 82 : 54));
    s += iconSvg(d, (cx - iSize / 2).toFixed(1), yB + 20, iSize);
    s += `<text x="${cx.toFixed(1)}" y="${yB + 92}" font-size="${sFont.toFixed(1)}" font-weight="700" text-anchor="middle" fill="${C.soft}">${esc(d.effort)}</text>`;
    s += `<text x="${cx.toFixed(1)}" y="${yB + 120}" font-size="${sFont.toFixed(1)}" font-weight="600" text-anchor="middle" fill="${C.soft}">${priceLabel(d)}</text>`;
    s += `<text transform="translate(${nx.toFixed(1)} ${yB + 150}) rotate(-45)" font-size="23" font-weight="800" text-anchor="end" fill="${C.ink}">${esc(shortName(d))}</text>`;
    s += `</g>`;
  });
  // Collision-free pill labels for reference lines
  const placedPills = [];
  refLines.forEach((rl) => {
    const ry = Y(rl.v);
    const pw = textW(rl.label, 20, 800) + 28, ph = 36;
    const px = X0 + 8;
    const under = colTops.filter((c) => c.x1 >= px - 8 && c.x0 <= px + pw + 8);
    const obsTop = under.length ? Math.min(...under.map((c) => c.top)) : yB;
    let py = (ry - ph - 10 >= yT) ? (ry - ph - 10) : (ry + 12);
    if (ry - ph - 10 >= yT && py + ph + 8 > obsTop) py = Math.max(yT + 8, obsTop - ph - 18);
    for (const p of placedPills) {
      if (py < p.y1 + 8 && py + ph > p.y0 - 8) py = Math.min(obsTop - ph - 14, p.y1 + 10);
    }
    placedPills.push({ y0: py, y1: py + ph });
    if (py + ph + 12 < ry) {
      const lx = px + 8;
      s += `<line x1="${lx.toFixed(1)}" y1="${(py + ph).toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ry.toFixed(1)}" stroke="${rl.color}" stroke-width="2.5" stroke-dasharray="5 4" stroke-opacity="0.7"/>`;
      s += `<circle cx="${lx.toFixed(1)}" cy="${ry.toFixed(1)}" r="4.5" fill="${rl.color}"/>`;
    }
    s += `<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph}" rx="10" fill="#ffffff" fill-opacity="0.96" stroke="${rl.color}" stroke-width="2.5"/>`;
    s += `<text x="${(px + 14).toFixed(1)}" y="${(py + 25).toFixed(1)}" font-size="20" font-weight="800" fill="${rl.color}">${esc(rl.label)}</text>`;
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
function overviewFig(hidden) { return withLegacy(true, () => overviewFigInner(hidden)); }
function overviewFigInner(hidden) {
  const vis = DATA.filter((d) => !hidden.has(d.id));
  const rows = vis.filter((d) => d.complete).sort((a, b) => b.avg - a.avg);
  const partial = vis.filter((d) => !d.complete);
  const best = rows[0];
  const paid = rows.filter((d) => d.price > 0).sort((a, b) => a.price - b.price)[0];
  const fast = vis.filter((d) => d.tps != null).sort((a, b) => b.tps - a.tps)[0];
  const tiles = [
    ['BEST OVERALL', best ? best.avg.toFixed(2) : '—', best ? `${best.model} · ${best.effort}` : 'no model shown'],
    ['CHEAPEST PAID TASK', paid ? `$${paid.price.toFixed(2)}` : '—', paid ? `${paid.model} · ${paid.effort}` : 'no paid model shown'],
    ['FASTEST OUTPUT', fast ? `${fast.tps} tok/s` : '—', fast ? `${fast.model} · ${fast.effort}` : 'no model shown'],
  ];
  const TH = 150, tw = (WC - 128 - 48) / 3, y0 = TOP + TH + 40;
  // best on the right: the columns run from the lowest average on the left to the best on the right
  const ovMin = rows.length ? Math.min(15, Math.floor(rows[rows.length - 1].avg)) : 0;
  const chart = columnChart(rows.slice().reverse().map((d) => ({ d, v: d.avg, value: d.avg.toFixed(2), tip: `avg ${d.avg.toFixed(2)} · ${priceText(d)}` })),
    { top: y0, ...fitAxis(rows.length ? rows[0].avg : 1, ovMin), unit: 'score', empty: 'No model is shown. Tick one on the left.' });
  const foot = footNotes([...(partial.length ? ['Partial runs without scores in all sections are excluded from Overall (they appear in the subcategories they have scores in).'] : []), legacyFootnote(rows)].filter(Boolean), chart.H);
  const H = foot.H;
  let body = frame(WC, H, 'OVERALL · SCORES', [`${activeReWeight() === 1.5 ? 'Weighted average' : 'Average'} of: ${subcategoryList()}${ovMin > 0 ? ` · Y scale starts at ${ovMin}.` : ''}`]);
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
function scoresFig(scope, hidden) { return withLegacy(scopeLegacyKey(scope), () => scoresFigInner(scope, hidden)); }
function scoresFigInner(scope, hidden) {
  let rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null)
    .sort((a, b) => scoreOf(b, scope) - scoreOf(a, scope));
  rows = bestPerModel(rows);   // every model once, at its best reasoning effort
  const total = rows.length;
  rows = rows.slice(0, TOP_N);   // the top 35 only
  const partial = scope === 'overall' ? DATA.filter((d) => !d.complete && !hidden.has(d.id)) : [];
  const ovMin = scope === 'overall' && rows.length ? Math.min(15, Math.floor(scoreOf(rows[rows.length - 1], scope))) : 0;
  const rm = activeReMode();
  const reLinesForVer = () => {
    if (rm === 'none') return ['Gamefeel · RE was introduced in v1.3 and is not part of this historical version.'];
    if (rm === 'single') return ['Gamefeel RE: how well the model gives feedback on game proposals, especially on balance.'];
    if (RE_VIEW === 'combined' && rm === 'split3') return ['Gamefeel RE combined: 0.66 × blind + 0.34 × assisted (v1.5 formula). Overall uses this score.'];
    if (RE_VIEW === 'combined' && rm === 'split4') return ['Gamefeel RE combined: blind, assisted and released-games RE (v1.5.1 formula). Overall uses this score at 1.5x weight.'];
    return RE_LINES[RE_VIEW];
  };
  const lines = scope === 'overall'
    ? [`${activeReWeight() === 1.5 ? 'Weighted average' : 'Average'} of: ${subcategoryList()}`, `${topNote(rows.length, total)}${ovMin > 0 ? ` Y scale starts at ${ovMin}.` : ''}`]
    : scope === 're'
      ? [...reLinesForVer(), `${topNote(rows.length, total)} Scale 0 to the best score; price per task under each column.`]
      : [`${SCOPE_LABEL[scope]} score alone. The scale runs from 0 to the best score on this chart. Price per task is under each column.`, `Only models with a score in this subcategory. ${topNote(rows.length, total)}`];
  // best on the right: the columns run from the lowest score on the left to the best on the right
  const refLines = scope === 're' && RE_VIEW === 'blind-hard' ? [HUMAN_AVG_BLIND_HARD] : [];
  const chart = columnChart(rows.slice().reverse().map((d) => { const v = scoreOf(d, scope); return { d, v, value: fmtScope(scope, v), tip: `score ${fmtScope(scope, v)} · ${priceText(d)}${scope === 're' && RE_VIEW === 'combined' && reParts(d) ? ` · ${reParts(d)}` : ''}` }; }),
    { top: topFor(lines), ...fitAxis(rows.length ? scoreOf(rows[0], scope) : 1, ovMin), unit: 'score', refLines, empty: scope === 're' && rm === 'none' ? 'Gamefeel · RE was introduced in v1.3.' : 'No model is shown for this view.' });
  const subset = rows.filter((d) => d.reNote);
  const foot = footNotes([
    ...(partial.length ? ['Partial runs without scores in all sections are excluded from Overall (they appear in the subcategories they have scores in).'] : []),
    ...(subset.length ? [reFootnote(subset)] : []),
    ...(LEGACY_MARK && legacyFootnote(rows) ? [legacyFootnote(rows)] : []),
  ], chart.H);
  const H = foot.H;
  let body = frame(WC, H, `${figTitle(scope)} · SCORES`, lines) + chart.body + foot.body;
  return { W: WC, H, body, wide: true };
}

/* The rows one RE chart shows: every model once, at its best reasoning effort; lowest left, best right. */
const reRows = (key) => bestPerModel(DATA.filter((d) => valOfPart(d, key) != null).sort((a, b) => valOfPart(b, key) - valOfPart(a, key))).slice(0, TOP_N).reverse();

/* ---------- figure: the RE export — blind / assisted / combined as three bar charts stacked vertically ---------- */
function reStackedFig() {
  // 3 x 2: blind | assisted, blind hard | assisted hard, released | combined. Each cell is a full-width column chart (WC units),
  // and the export is captured twice as wide (exportScale 2), so every cell is as sharp as a single-section image.
  const sections = [
    ['re_blind', 'BLIND', 'No worked examples shown — the model rates the game proposals cold.'],
    ['re_assisted', 'ASSISTED', 'The model studies 39 rated worked examples as help for how to calibrate its feedback, then rates the rest.'],
    ['re_blind_hard', 'BLIND · HARD', 'The blind run, scored only on the locked set of 400 hand-rated cards AI misjudges most, at 1x (dashed line: ~2% avg 120 IQ human gamer).'],
    ['re_assisted_hard', 'ASSISTED · HARD', 'The assisted run, scored only on the locked set of 400 hand-rated cards AI misjudges most, at 1x.'],
    ['re_released', 'RELEASED · BLIND', 'Blind, on proposals for released commercial games such as Balatro, Slay the Spire and World of Warcraft.'],
    ['re_combined', 'COMBINED', '5 × blind + 2 × blind hard + 3 × assisted + 1 × assisted hard + 2 × released, ÷ 13. Missing parts estimated from the rest.'],
  ];
  const hasCombLeg = reRows('re_combined').some((d) => isPartLegacy(d, 're_combined'));
  const hasHardLeg = reRows('re_blind_hard').some((d) => isPartLegacy(d, 're_blind_hard')) || reRows('re_assisted_hard').some((d) => isPartLegacy(d, 're_assisted_hard'));
  const lines = [
    'Gamefeel Reverse-Evaluation (RE): the model\'s ability to give feedback on game proposals, especially balancing feedback.',
    'Assisted results get 39 rated examples as help for how they should calibrate their feedback. Hard: scored only on the locked set of 400 hand-rated cards AI misjudges most.',
    'Overall uses RE combined only, at 1.5x weight.',
    'Every model is shown once per chart, at its best reasoning effort.',
    ...(hasCombLeg || hasHardLeg ? [`† Estimated from the model's older v1.5.1 run (calibrated per part for Combined; recalculated 1x human-only for Hard) until re-run on ${CUR_STD()}.`] : []),
  ];
  const GAP = 90, W = 2 * WC;
  const cells = sections.map(([key, label, desc]) => {
    const rows = reRows(key);
    const note = `  ${topNote(rows.length, bestPerModel(DATA.filter((d) => valOfPart(d, key) != null)).length)}`;
    let body = `<text x="64" y="26" font-size="36" font-weight="800" fill="${C.ink}">${label}</text>`;
    body += `<text x="64" y="60" font-size="21" font-weight="500" fill="${C.soft}">${esc(desc + note)}</text>`;
    const items = rows.map((d) => { const v = valOfPart(d, key); return { d, v, value: fmt2(v), tip: `${label} ${fmt2(v)} · ${priceText(d)}${key === 're_combined' ? ` · ${reParts(d)}` : ''}` }; });
    const legKey = key;   // every RE part can carry an outdated v1.5.1 score
    const refLines = key === 're_blind_hard' ? [HUMAN_AVG_BLIND_HARD] : [];
    const chart = withLegacy(legKey, () => columnChart(items, { top: 80, ...fitAxis(rows.length ? valOfPart(rows[rows.length - 1], key) : 1), unit: 'score', refLines, empty: `No model has a ${label.toLowerCase()} score yet.` }));
    return { body: body + chart.body, H: chart.H };
  });
  let body = '', top = topFor(lines);
  for (let r = 0; r < 3; r++) {
    const pair = cells.slice(r * 2, r * 2 + 2);
    pair.forEach((c, k) => { body += `<g transform="translate(${k * WC} ${top})">${c.body}</g>`; });
    body += `<line x1="${WC}" x2="${WC}" y1="${top}" y2="${top + Math.max(...pair.map((c) => c.H))}" stroke="${C.track}" stroke-width="3"/>`;
    top += Math.max(...pair.map((c) => c.H)) + GAP;
  }
  const H = top - GAP + 60;
  return { W, H, body: frame(W, H, 'GAMEFEEL · RE', lines) + body, wide: true, exportScale: 2 };
}

/* ---------- figure: the RE board, an opt-in look of the RE section (Look: Board) and the export scores-re-board ----------
   The five parts' weights as a ribbon, RE combined with each column split into what each part adds, then each part ranked on
   its own. On the site it is one chart wide with the parts three across; the export is twice as wide, five across, exportScale 2. */
const PART_DESC = {
  re_blind: 'Rates the game proposals cold', re_blind_hard: 'Blind run, locked 400-card Hard set',
  re_assisted: 'Studies 39 rated examples first', re_assisted_hard: 'Assisted run, locked 400-card Hard set',
  re_released: 'Blind, on released commercial games',
};
function reRibbonSvg(w, y) {   // the five parts at 5 / 2 / 3 / 1 / 2 of 13, in their colours
  const x0 = 64, x1 = w - 64, gap = 10, span = x1 - x0 - gap * (RE_PARTS.length - 1);
  let s = '', x = x0;
  RE_PARTS.forEach(([k, l, wt]) => {
    const sw = (span * wt) / 13, name = l[0].toUpperCase() + l.slice(1);
    s += `<text x="${(x + 2).toFixed(1)}" y="${y}" font-size="22" font-weight="800" fill="${C.ink}">${esc(name)}</text>`;
    s += `<rect x="${x.toFixed(1)}" y="${y + 15}" width="${sw.toFixed(1)}" height="12" rx="6" fill="${RE_PART_COLOR[k]}"/>`;
    s += `<text x="${(x + 2).toFixed(1)}" y="${y + 56}" font-size="19" font-weight="700" fill="${C.soft}" style="font-variant-numeric:tabular-nums">${wt} of 13 · ${Math.round((wt / 13) * 100)}%</text>`;
    x += sw + gap;
  });
  return s;
}
function partPanel(k, label, w, x, y, pw, hidden) {
  const color = RE_PART_COLOR[k];
  const all = bestPerModel(DATA.filter((d) => !hidden.has(d.id) && valOfPart(d, k) != null).sort((a, b) => valOfPart(b, k) - valOfPart(a, k)));
  const rows = all.slice(0, 8), max = rows.length ? Math.max(valOfPart(rows[0], k), 0.01) : 1;
  const nameX = x + 88, track = pw - 88, rowH = 76, y0 = y + 142;
  let s = `<rect x="${x.toFixed(1)}" y="${y}" width="${pw.toFixed(1)}" height="10" rx="5" fill="${color}"/>`;
  s += `<text x="${x.toFixed(1)}" y="${y + 62}" font-size="34" font-weight="800" fill="${C.ink}">${esc(label.toUpperCase())}</text>`;
  s += `<text x="${(x + pw).toFixed(1)}" y="${y + 62}" font-size="23" font-weight="800" text-anchor="end" fill="${C.soft}">${w} of 13</text>`;
  s += `<text x="${x.toFixed(1)}" y="${y + 98}" font-size="21" font-weight="600" fill="${C.faint}">${esc(PART_DESC[k])}</text>`;
  const legKey = k;
  withLegacy(legKey, () => {
    rows.forEach((d, i) => {
      const ry = y0 + i * rowH, v = valOfPart(d, k);
      s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${modelEffort(d)} · ${label} ${fmt2(v)}${legKey && isPartLegacy(d, legKey) ? ' (recalculated v1.5.1 run)' : ''}`)}">`;
      s += `<rect x="${x.toFixed(1)}" y="${ry - 34}" width="${pw.toFixed(1)}" height="${rowH}" fill="transparent"/>`;
      s += `<text x="${(x + 18).toFixed(1)}" y="${ry + 8}" font-size="22" font-weight="800" text-anchor="middle" fill="${i === 0 ? C.ink : C.faint}" style="font-variant-numeric:tabular-nums">${i + 1}</text>`;
      s += iconSvg(d, (x + 40).toFixed(1), ry - 20, 34);
      s += `<text x="${nameX.toFixed(1)}" y="${ry + 6}" font-size="24" font-weight="800" fill="${C.ink}">${esc(shortName(d))}<tspan dx="10" font-size="20" font-weight="600" fill="${C.soft}">${esc(d.effort)}</tspan></text>`;
      s += `<text x="${(x + pw).toFixed(1)}" y="${ry + 6}" font-size="26" font-weight="800" text-anchor="end" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${fmt2(v)}</text>`;
      s += `<rect x="${nameX.toFixed(1)}" y="${ry + 20}" width="${track.toFixed(1)}" height="10" rx="5" fill="${C.track}"/>`;
      s += `<rect x="${nameX.toFixed(1)}" y="${ry + 20}" width="${Math.max(10, (track * v) / max).toFixed(1)}" height="10" rx="5" fill="${color}"/>`;
      s += `</g>`;
    });
  });
  const more = all.length > rows.length ? `Top ${rows.length} of ${all.length} models` : `All ${all.length} models`;
  s += `<text x="${x.toFixed(1)}" y="${(y0 + rows.length * rowH - 4).toFixed(1)}" font-size="20" font-weight="600" fill="${C.faint}">${more}</text>`;
  return { body: s, H: 142 + rows.length * rowH + 10, hasLegacy: Boolean(legKey && rows.some((d) => isPartLegacy(d, legKey))) };
}
function reBoardFig(hidden = NONE, wide = false) {
  const W = wide ? 2 * WC : WC, cols = wide ? 5 : 3, RIB = 112;
  const lines = [
    'Gamefeel RE board: RE combined split into what each part adds, then every part ranked on its own. Overall uses RE combined at 1.5x weight.',
    'Assisted runs study 39 rated examples first. Hard: the same run, scored only on the locked set of 400 hand-rated cards AI misjudges most.',
  ];
  let top = topFor(lines), body = reRibbonSvg(W, top + 6);   // below the site's header crop, so the part names show
  top += RIB + 10;
  const all = bestPerModel(DATA.filter((d) => !hidden.has(d.id) && d.re_combined != null).sort((a, b) => b.re_combined - a.re_combined));
  const rows = all.slice(0, TOP_N).reverse();
  const items = rows.map((d) => { const segs = reSegs(d); return { d, v: d.re_combined, value: fmt2(d.re_combined), segs, tip: `combined ${fmt2(d.re_combined)} · ${reParts(d)}${segTip(segs)}` }; });
  let head = `<text x="64" y="30" font-size="40" font-weight="800" fill="${C.ink}">COMBINED</text>`;
  head += `<text x="64" y="70" font-size="23" font-weight="500" fill="${C.soft}">${esc(`What Overall uses, each column split into what each part adds. ${topNote(rows.length, all.length)}`)}</text>`;
  const legend = [['hatch', 'Hatched: part not run, estimated from the others'], ['legacy', '† Grey: estimated from v1.5.1 RE']];
  head += `<defs>${hatchDefs('hatchLegend', C.soft)}</defs>`;
  let lx = W - 64;
  for (let i = legend.length - 1; i >= 0; i--) {
    const [kind, t] = legend[i];
    lx -= textW(t, 21, 600);
    head += `<text x="${lx.toFixed(1)}" y="${wide ? 32 : 112}" font-size="21" font-weight="600" fill="${C.soft}">${esc(t)}</text>`;
    lx -= 40;
    head += `<rect x="${lx.toFixed(1)}" y="${wide ? 8 : 88}" width="30" height="30" rx="6" fill="${kind === 'hatch' ? 'url(#hatchLegend)' : LEGACY_FILL}"/>`;
    lx -= 44;
  }
  const htop = wide ? 96 : 140;
  const chart = withLegacy(true, () => columnChart(items, { top: htop, width: W, ...fitAxis(rows.length ? rows[rows.length - 1].re_combined : 1), unit: 'score', empty: 'No model has a combined RE score yet.' }));
  body += `<g transform="translate(0 ${top})">${head}${chart.body}</g>`;
  top += chart.H - 120;
  body += `<line x1="64" x2="${W - 64}" y1="${top}" y2="${top}" stroke="${C.track}" stroke-width="3"/>`;
  top += 64;
  const gap = 64, pw = (W - 128 - gap * (cols - 1)) / cols;
  let hardPanelLeg = false;
  for (let r = 0; r * cols < RE_PARTS.length; r++) {
    let ph = 0;
    RE_PARTS.slice(r * cols, r * cols + cols).forEach(([k, l, w], i) => {
      const p = partPanel(k, l[0].toUpperCase() + l.slice(1), w, 64 + i * (pw + gap), top, pw, hidden);
      body += p.body; ph = Math.max(ph, p.H); if (p.hasLegacy) hardPanelLeg = true;
    });
    top += ph + 40;
  }
  const subset = DATA.filter((d) => !hidden.has(d.id) && d.reNote && RE_PARTS.some(([k]) => valOfPart(d, k) != null));
  const notes = [
    subset.length ? reFootnote(subset) : null,
    hardPanelLeg ? `† In the Blind hard and Assisted hard panels, marks a recalculated v1.5.1 run (human-rated cards only, 1x) until the model is re-run on ${CUR_STD()}.` : null,
  ].filter(Boolean).flatMap((t) => wrapText(t, 20, 600, W - 128));
  notes.forEach((t, i) => { body += `<text x="64" y="${top + 30 * i}" font-size="20" font-weight="600" fill="${C.soft}">${esc(t)}</text>`; });
  const H = top + 30 * notes.length + 50;
  return { W, H, body: frame(W, H, 'GAMEFEEL · RE BOARD', lines) + body, wide: true, ...(wide ? { exportScale: 2 } : {}) };
}

/* ---------- figure: one RE section on its own — exported separately as scores-re-blind / -assisted / -combined ---------- */
function reSingleFig(view) { return withLegacy(RE_FIELD[view], () => reSingleFigInner(view)); }
function reSingleFigInner(view) {
  const key = RE_FIELD[view];
  const rows = reRows(key);
  const items = rows.map((d) => { const v = valOfPart(d, key); return { d, v, value: fmt2(v), tip: `${RE_LABEL[view].toLowerCase()} ${fmt2(v)} · ${priceText(d)}${view === 'combined' ? ` · ${reParts(d)}` : ''}` }; });
  const lines0 = [...RE_LINES[view]];
  const refLines = view === 'blind-hard' ? [HUMAN_AVG_BLIND_HARD] : [];
  const chart = columnChart(items, { top: topFor([...lines0, '']), ...fitAxis(rows.length ? valOfPart(rows[rows.length - 1], key) : 1), unit: 'score', refLines, empty: `No model has a ${RE_LABEL[view].toLowerCase()} score yet.` });
  const lines = [...lines0,
    `Best reasoning effort per model, all ${rows.length} models. Scale 0 to the best score; price per task under each column.`];
  const subset = rows.filter((d) => d.reNote);
  const foot = footNotes([subset.length ? reFootnote(subset) : null, LEGACY_MARK ? legacyFootnote(rows) : null].filter(Boolean), chart.H);
  return { W: WC, H: foot.H, body: frame(WC, foot.H, `GAMEFEEL · RE (${RE_LABEL[view].toUpperCase()}) · SCORES`, lines) + chart.body + foot.body, wide: true };
}

/* ---------- figure: Blind Hard vs Human baselines (scaled to 60% so ~2% avg gamer and ~60% expert both show cleanly) ---------- */
function reBlindHardHumanFig(hidden = NONE) {
  return withLegacy('re_blind_hard', () => {
    let rows = DATA.filter((d) => !hidden.has(d.id) && valOfPart(d, 're_blind_hard') != null)
      .sort((a, b) => valOfPart(b, 're_blind_hard') - valOfPart(a, 're_blind_hard'));
    rows = bestPerModel(rows);
    const total = rows.length;
    rows = rows.slice(0, TOP_N);
    const best = rows[0] ? valOfPart(rows[0], 're_blind_hard') : 0;
    const maxVal = Math.max(HUMAN_EXPERT_BLIND_HARD.v, best);
    const lines = [
      ...RE_LINES['blind-hard-human'],
      `${topNote(rows.length, total)} Scale 0 to ${maxVal} (includes ~60% expert baseline); price per task under each column.`,
    ];
    const items = rows.slice().reverse().map((d) => {
      const v = valOfPart(d, 're_blind_hard');
      return { d, v, value: fmt2(v), tip: `blind hard ${fmt2(v)} · ${priceText(d)}` };
    });
    const chart = columnChart(items, {
      top: topFor(lines),
      ...fitAxis(maxVal),
      unit: 'score',
      refLines: [HUMAN_AVG_BLIND_HARD, HUMAN_EXPERT_BLIND_HARD],
      empty: 'No model is shown for this view.',
    });
    const subset = rows.filter((d) => d.reNote);
    const foot = footNotes([
      ...(subset.length ? [reFootnote(subset)] : []),
      ...(LEGACY_MARK && legacyFootnote(rows) ? [legacyFootnote(rows)] : []),
    ], chart.H);
    return {
      W: WC,
      H: foot.H,
      body: frame(WC, foot.H, 'GAMEFEEL · RE (BLIND HARD · VS HUMAN) · SCORES', lines) + chart.body + foot.body,
      wide: true,
    };
  });
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
/* Real glyph widths (in figure units) from the browser, so label boxes match the drawn text. */
const _measure = document.createElement('canvas').getContext('2d');
const textW = (t, size, weight) => {
  _measure.font = `${weight} ${size}px "Ubuntu Sans", "Segoe UI", system-ui, sans-serif`;
  return _measure.measureText(t).width;
};
/* Places each point label where it displaces least: nearest slot above or below the dot, on either side.
   A label must stay inside the plot and clear of every other label, dot and icon. */
const LABEL_STATS = { fallback: 0 };   // labels that found no clear slot (checked by the test run)
function placeLabels(pts, T, B, WP, obstacles = pts) {   // obstacles: every dot a label must keep clear of (default: the labelled ones)
  const R = WP - 80, placed = [];
  const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const dots = obstacles.map((p) => (p.x0 != null ? p : { x0: p.x - 38, x1: p.x + 38, y0: p.y - 38, y1: p.y + 38 }));   // a ready box (e.g. a line) is used as is
  const boxFor = (p, right, ly) => {   // the lab logo sits in the point, so the label is text only
    const textX = right ? p.x + 46 : p.x - 46;
    const x0 = right ? textX : textX - p.w, x1 = right ? textX + p.w : textX;
    return { iconX: right ? textX - 26 : textX + 6, textX, anchor: right ? 'start' : 'end', x0, x1, y: ly, y0: ly - 25, y1: ly + 10 };
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
function ppFig(scope, hidden) {
  const L = 170, R = WP - 80, T = TOP + 30;
  const title = `${figTitle(scope)} · PRICE TO PERFORMANCE`;
  const lines = [
    'Price per task against score, log scale. Up and to the left is cheaper and higher.',
    'Blue ring and line: pareto frontier, named; no model beats it on both price and score. Dotted = effort levels.',
  ];
  if (scope === 're') lines.push(reContextLine());
  const rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null && d.price != null);
  const unpriced = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null && d.price == null);
  if (!rows.length) return { W: WP, H: 600, body: frame(WP, 600, title, lines) + emptyNote(WP, 360, 'No model is shown for this view.') };

  const front = paretoFront(rows, scope);
  const notes = [];
  if (unpriced.length) notes.push(`Not shown, no price given: ${namesOf(unpriced)}.`);
  const noted = scope === 're' ? rows.filter((d) => d.reNote) : [];
  if (noted.length) notes.push(reFootnote(noted));
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

  // pareto frontier: straight segments between the non-dominated points, then flat at the best score to the
  // right edge, since paying more past the best model buys no higher score
  const fpath = front.map((d) => [X(d.px), Y(scoreOf(d, scope))]);
  if (fpath.length && fpath[fpath.length - 1][0] < R - 1) fpath.push([R, fpath[fpath.length - 1][1]]);
  if (fpath.length > 1) {
    s += valueBand(fpath, B);
    s += `<path d="${fpath.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join('')}" fill="none" stroke="${C.azure}" stroke-width="6" stroke-linejoin="round" opacity=".85"/>`;
  }
  // same model at several effort levels: a dotted line joins them
  const fam = {};
  rows.forEach((d) => { (fam[d.model] = fam[d.model] || []).push(d); });
  Object.values(fam).forEach((g) => {
    if (g.length < 2) return;
    const seq = [...g].sort((a, b) => a.px - b.px);
    s += `<path d="${seq.map((d, i) => (i ? 'L' : 'M') + X(d.px).toFixed(1) + ' ' + Y(scoreOf(d, scope)).toFixed(1)).join('')}" fill="none" stroke="${g[0].tint}" stroke-opacity=".6" stroke-width="4" stroke-dasharray="2 10" stroke-linecap="round"/>`;
  });

  // every model is a dot with its lab logo; only the pareto frontier is named (the rest name themselves on hover)
  const all = rows.map((d) => {
    const sc = scoreOf(d, scope), text = `${d.model} (${d.effort})  ${fmtScope(scope, sc)}`;
    return { d, x: X(d.px), y: Y(sc), sc, text, w: textW(text, 28, 800) + 6 };
  });
  // the flat end of the frontier is kept clear of labels too, so no name sits on the line
  const flat = fpath.length > 1 && fpath[fpath.length - 1][0] === R ? [{ x0: fpath[fpath.length - 2][0] + 38, x1: R, y0: fpath[fpath.length - 1][1] - 8, y1: fpath[fpath.length - 1][1] + 8 }] : [];
  const pts = placeLabels(all.filter((p) => front.includes(p.d)), T, B, WP, [...all, ...flat]);
  all.forEach((p) => {
    const d = p.d;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${d.model} · ${d.effort} · ${priceText(d)} · score ${fmtScope(scope, p.sc)}`)}">`;
    if (p.ly != null && Math.abs(p.ly - p.y) > 18) s += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.iconX + 20}" y2="${p.ly}" stroke="${C.faint}" stroke-width="2"/>`;
    s += logoPoint(d, p.x, p.y, front.includes(d));
    if (isWarn(d)) s += warnSvg(p.x, p.y - 40, 30);
    s += `</g>`;
  });
  pts.forEach((p) => {   // labels after every point, so no disc covers a label
    const d = p.d;
    s += `<g data-m="${esc(d.id)}"><text x="${p.textX}" y="${p.ly + 10}" font-size="28" font-weight="800" text-anchor="${p.anchor}" fill="${C.ink}" stroke="#ffffff" stroke-width="7" paint-order="stroke">${esc(d.model)} <tspan font-weight="600" fill="${C.soft}">(${esc(d.effort)})</tspan> <tspan font-weight="700" fill="${C.soft}">${fmtScore(p.sc)}</tspan></text></g>`;
  });
  noteLines.forEach((t, i) => { s += `<text x="64" y="${B + 130 + 36 * i}" font-size="22" font-weight="600" fill="${C.soft}">${esc(t)}</text>`; });
  return { W: WP, H, body: frame(WP, H, title, lines) + s, wide: true };
}

// a point on the price and size charts: the lab logo in a white disc ringed in the lab colour; on the frontier an azure ring around it
function logoPoint(d, x, y, onFront) {
  let s = '';
  if (onFront) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="35" fill="none" stroke="${C.azure}" stroke-width="5"/>`;
  s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="27" fill="#ffffff" stroke="${d.tint}" stroke-width="4"/>`;
  s += iconSvg(d, (x - 16).toFixed(1), (y - 16).toFixed(1), 32);
  return s;
}
// the value band: the area under the frontier, shaded from the line and fading out toward the axis
function valueBand(path, B) {
  if (path.length < 2) return '';
  const id = `vband${++HATCH_N}`;
  const d = `M${path[0][0].toFixed(1)} ${B}` + path.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join('') + `L${path[path.length - 1][0].toFixed(1)} ${B}Z`;
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.azure}" stop-opacity=".16"/><stop offset=".7" stop-color="${C.azure}" stop-opacity="0"/></linearGradient></defs><path d="${d}" fill="url(#${id})"/>`;
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
function sizeFig(scope, hidden) {
  const title = `${figTitle(scope)} · SIZE TO PERFORMANCE`;
  const lines = [
    'Model size against score, log scale. Up and to the left is smaller and higher.',
    'Open-weight models with a recorded size only. Blue ring and line: pareto frontier, no model on it is both smaller and higher.',
  ];
  if (scope === 're') lines.push(reContextLine());
  const shown = DATA.filter((d) => !hidden.has(d.id) && d.openWeights && d.size != null && scoreOf(d, scope) != null);
  if (!shown.length) return { W: WP, H: 600, body: frame(WP, 600, title, lines) + emptyNote(WP, 360, 'No open-weight model with a size is shown for this view.') };
  const rows = shown.map((d) => ({ ...d, px: d.size }));     // paretoFront reads px as the cost; here the cost is the size
  const front = paretoFront(rows, scope);

  // footnotes: the sizes with their quantization and what is still missing
  const notes = [`Sizes: ${rows.map((d) => `${d.model} ${d.size} GB${d.sizeBasis ? ` (${d.sizeBasis})` : ''}`).join('; ')}.`];
  const unsized = [...new Set(DATA.filter((d) => !hidden.has(d.id) && d.openWeights && d.size == null).map((d) => d.model))];
  if (unsized.length) notes.push(`Not shown, open weights but no size yet: ${unsized.join(', ')}.`);
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
    s += valueBand(front.map((d) => [X(d.px), Y(scoreOf(d, scope))]), B);
    s += `<path d="${front.map((d, i) => (i ? 'L' : 'M') + X(d.px).toFixed(1) + ' ' + Y(scoreOf(d, scope)).toFixed(1)).join('')}" fill="none" stroke="${C.azure}" stroke-width="6" stroke-linejoin="round" opacity=".85"/>`;
  }
  const pts = placeLabels(rows.map((d) => {
    const sc = scoreOf(d, scope), text = `${d.model} (${d.effort})  ${fmtScope(scope, sc)}  ${d.size} GB`;
    return { d, x: X(d.px), y: Y(sc), sc, text, w: textW(text, 28, 800) + 6 };
  }), T, B, WP);
  pts.forEach((p) => {
    const d = p.d;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${d.model} · ${d.effort} · ${d.size} GB · score ${fmtScope(scope, p.sc)}`)}">`;
    if (Math.abs(p.ly - p.y) > 18) s += `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${p.iconX + 20}" y2="${p.ly}" stroke="${C.faint}" stroke-width="2"/>`;
    s += logoPoint(d, p.x, p.y, front.includes(d));
    if (isWarn(d)) s += warnSvg(p.x, p.y - 40, 30);
    s += `</g>`;
  });
  pts.forEach((p) => {   // labels after every point, so no disc covers a label
    const d = p.d;
    s += `<g data-m="${esc(d.id)}">`;
    s += `<text x="${p.textX}" y="${p.ly + 10}" font-size="28" font-weight="800" text-anchor="${p.anchor}" fill="${C.ink}" stroke="#ffffff" stroke-width="7" paint-order="stroke">${esc(d.model)} <tspan font-weight="600" fill="${C.soft}">(${esc(d.effort)})</tspan> <tspan font-weight="700" fill="${C.soft}">${fmtScore(p.sc)}</tspan> <tspan font-weight="600" fill="${C.soft}">${d.size} GB</tspan></text>`;
    s += `</g>`;
  });
  noteLines.forEach((t, i) => { s += `<text x="64" y="${B + 130 + 36 * i}" font-size="22" font-weight="600" fill="${C.soft}">${esc(t)}</text>`; });
  return { W: WP, H, body: frame(WP, H, title, lines) + s, wide: true };
}

/* ---------- figure: profiles (radar) ---------- */
function radarFig(ids, hidden) {
  const H = 1000, cx = 520, cy = 590, R = 280;
  const ALL_AX = [['create', 'coding · create'], ['bugfix', 'coding · debugging'], ['gamefeel', 'gamefeel'],
    ['ideas', 'creativity · ideas'], ['visuals', 'creativity · visuals'], ['audio', 'creativity · audio'],
    ['re', 'gamefeel · RE']];
  const ks = new Set(activeScoreKeys());
  const AX = ALL_AX.filter(([k]) => ks.has(k));
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / AX.length;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
  const sel = DATA.filter((d) => ids.includes(d.id) && !hidden.has(d.id));
  const lines = [
    `${AX.length === 6 ? 'Six' : 'Seven'} scores as one shape per model. Rings are 20 points apart, out to 100.`,
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
    s += `<text x="1536" y="${y + 18}" font-size="40" font-weight="800" text-anchor="end" fill="${C.ink}">${d.complete ? d.avg.toFixed(2) : 'partial'}</text>`;
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
  ...SCORE_KEYS.map((k) => (k === 'bugfix' ? [k, 'DEBUGGING', 140, 'end'] : [k, k.toUpperCase(), 120, 'end'])),
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
    case 're': return d.re == null ? '—' : d.re.toFixed(2);
    case 'avg': return d.avg == null ? '—' : d.avg.toFixed(2);
    case 'value': return d.value == null ? '—' : d.value.toFixed(2);
    default: return d[k] == null ? '—' : String(d[k]);
  }
}
function ledgerFig(sort, hidden) { return withLegacy(true, () => ledgerFigInner(sort, hidden)); }
function ledgerFigInner(sort, hidden) {
  const rows = sortRows(DATA.filter((d) => !hidden.has(d.id)), sort);
  const total = LEDGER.reduce((a, c) => a + c[2], 0), left = (WL - total) / 2;
  const subset = rows.filter((d) => d.reNote);
  const lines = ['Click a column heading to sort. PTS/$ = average score per dollar of task price. A dash means no value for that column.',
    'RE = Gamefeel Reverse-Evaluation. A partial record (not all seven scores) has no average and is not in overall.'];
  if (subset.length) lines.push(reFootnote(subset));
  if (legacyFootnote(rows)) lines.push(legacyFootnote(rows));
  const top = topFor(lines) + 40, rowH = 74;
  const H = top + Math.max(rows.length, 1) * rowH + 150;
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
  ['released', 'Released vs unreleased games', 'How much weaker each model is on the unreleased games'],
  ['effort', 'Is more effort worth it?', 'Each model across its reasoning-effort levels'],
  ['general', 'Gamefeel vs general capability', 'Outliers against the Artificial Analysis index'],
  ['progress', 'Progress over time', 'GCI, the best score so far, by date'],
];
const EXTRA_KEYS = EXTRA.map((e) => e[0]);
const isPhone = () => matchMedia('(max-width: 700px)').matches;
const GLANCE_COLS = [['create', 'Create'], ['bugfix', 'Debugging'], ['gamefeel', 'Gamefeel'], ['ideas', 'Ideas'],
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
function rankListHTML(scope, hidden) { return withLegacy(scopeLegacyKey(scope), () => rankListInner(scope, hidden)); }
function rankListInner(scope, hidden) {
  let rows = DATA.filter((d) => !hidden.has(d.id) && scoreOf(d, scope) != null).sort((a, b) => scoreOf(b, scope) - scoreOf(a, scope));
  rows = bestPerModel(rows);
  const total = rows.length;
  rows = rows.slice(0, TOP_N);
  const isBH = scope === 're' && RE_VIEW === 'blind-hard';
  const isBHH = scope === 're' && RE_VIEW === 'blind-hard-human';
  const refs = isBHH ? [
    { v: HUMAN_EXPERT_BLIND_HARD.v, name: 'Human expert', note: '100+ hrs experience', color: HUMAN_EXPERT_BLIND_HARD.color },
    { v: HUMAN_AVG_BLIND_HARD.v, name: 'Avg 120 IQ human gamer', note: 'no experience', color: HUMAN_AVG_BLIND_HARD.color },
  ] : isBH ? [
    { v: HUMAN_AVG_BLIND_HARD.v, name: 'Avg 120 IQ human gamer', note: 'no experience', color: HUMAN_AVG_BLIND_HARD.color },
  ] : [];
  const maxAI = rows.length ? scoreOf(rows[0], scope) : 1;
  const max = isBHH ? Math.max(HUMAN_EXPERT_BLIND_HARD.v, maxAI) : maxAI;
  const title = scope === 'overall' ? 'Overall' : scope === 're' ? `Gamefeel RE · ${RE_LABEL[RE_VIEW].toLowerCase()}` : SCOPE_LABEL[scope];
  const merged = [
    ...rows.map((d, i) => ({ kind: 'ai', d, i, v: scoreOf(d, scope) })),
    ...refs.map((r) => ({ kind: 'ref', r, v: r.v })),
  ].sort((a, b) => b.v - a.v || (a.kind === 'ref' ? -1 : 1));
  const list = merged.map((it) => {
    if (it.kind === 'ref') {
      const r = it.r;
      return `<li class="href-row" style="--ref-c:${r.color}"><span class="rk">Ref</span><div class="rl"><div class="rn"><span class="nm"><b>${esc(r.name)}</b><small>${esc(r.note)}</small></span></div>` +
        `<div class="rb"><i style="width:${Math.max(1.5, (r.v / max) * 72).toFixed(1)}%;background:${r.color}"></i><b style="color:${r.color}">~${r.v}%</b><em>human baseline</em></div></div></li>`;
    }
    const d = it.d, v = it.v;
    return `<li data-m="${esc(d.id)}"><span class="rk">${it.i + 1}</span><div class="rl"><div class="rn">${nameCell(d)}</div>` +
      `<div class="rb"><i style="width:${Math.max(1, (v / max) * 72).toFixed(1)}%;background:${d.tint}"></i><b>${fmtScope(scope, v)}</b><em>${priceLabel(d)}</em></div></div></li>`;
  }).join('');
  const sub = scope === 'overall' ? 'Weighted average of the seven scores (RE combined counts 1.5x). Models with a partial record are not ranked.'
    : isBHH ? 'Blind hard (hand-rated cards, 1x) scaled to 60% against human baselines (~2% avg 120 IQ gamer with no experience, ~60% human expert with 100+ hrs).'
    : isBH ? 'Blind hard (hand-rated cards, 1x). Includes ~2% average 120 IQ human gamer baseline; see Blind hard · vs Human for the ~60% expert scale.'
    : scope === 're' ? 'Feedback on game proposals, especially balancing.' : 'Score out of 100.';
  const subFull = `${sub} ${topNote(rows.length, total)}`;
  const subset = rows.filter((d) => d.reNote);
  const foot = [subset.length ? reFootnote(subset) : null, LEGACY_MARK ? legacyFootnote(rows) : null].filter(Boolean).join(' ');
  return card(title, subFull, rows.length ? `<ol class="rank">${list}</ol>` : '<p class="sub">No model is shown.</p>', esc(foot));
}

/* ---------- every score at a glance: sortable heatmap ---------- */
function glanceHTML(sort, hidden) { return withLegacy(true, () => glanceInner(sort, hidden)); }
function glanceInner(sort, hidden) {
  const all = DATA.filter((d) => !hidden.has(d.id) && SCORE_KEYS.filter((k) => d[k] != null).length >= 2);
  const rows = sortBy(all, sort.key, sort.dir, (d, k) => (k === 'model' ? d.model : d[k]));
  const range = Object.fromEntries(GLANCE_COLS.map(([k]) => { const v = DATA.map((d) => d[k]).filter((x) => x != null); return [k, [Math.min(...v), Math.max(...v)]]; }));
  const shade = (k, v) => {
    if (v == null) return 'class="na"';
    const [a, b] = range[k], t = (v - a) / (b - a || 1);
    return `style="background:${heatBg(t)};color:${t > 0.55 || isDark() ? '#fff' : 'var(--ink)'}"`;
  };
  const head = `<tr>${sortHead('gsort', 'model', 'Model', sort, 'm')}${GLANCE_COLS.map(([k, l]) => sortHead('gsort', k, l, sort)).join('')}</tr>`;
  const body = rows.map((d) => `<tr data-m="${esc(d.id)}"><td class="m">${nameCell(d)}</td>${GLANCE_COLS.map(([k]) =>
    `<td ${k === 'avg' && d.avg != null ? 'class="ov"' : shade(k, d[k])}>${d[k] == null ? '—' : (k === 'avg' || k === 're') ? d[k].toFixed(2) : fmtScore(d[k])}</td>`).join('')}</tr>`).join('');
  return card('Every score at a glance',
    'Darker = better within that column, so a strong ideas score and a strong RE score read the same way. Click a heading to sort; click again to reverse.',
    `<div class="tscroll"><table class="hm">${head}${body}</table></div>`,
    esc(`RE is the combined score. Overall needs all seven scores; a dash means no score yet. ${rows.length} entries with at least two scores.${legacyFootnote(rows) ? ' ' + legacyFootnote(rows) : ''}`));
}

/* ---------- paired columns: one score against a reference, per entry (blind vs assisted, released vs unreleased, expected vs actual) ----------
   Solid column = the score the view is about; dashed outline = the reference it is measured against. When the solid column is taller,
   a white dashed line inside it marks the reference. A chip on top gives the difference, green when it is in the model's favour,
   red when not. Under the axis: the lab logo, the name (wrapped) and the reasoning effort. */
function pairBars(rows, o) {
  const n = rows.length, ph = isPhone();
  const W = Math.max(ph ? 860 : 1000, 60 + n * (n > 12 ? 54 : 76)), R = W - 12, T = 50, B = T + 300;
  let L = 46;   // long lists get narrower columns, so the text keeps its size
  const top = Math.max(10, Math.ceil(Math.max(0, ...rows.flatMap((d) => [o.main(d), o.ref(d)])) / 5) * 5);   // the scale ends just above the tallest column
  const Y = (v) => B - (Math.max(0, v) / top) * (B - T);
  let pitch = (R - L) / Math.max(n, 1), bw = Math.min(pitch * 0.66, 80);
  const wrap = (t, maxW) => {   // the model name in lines no wider than maxW, broken at spaces and hyphens
    const parts = t.replace(/-/g, '- ').split(' ').filter(Boolean), out = [];
    let cur = '';
    for (const w of parts) {
      const next = cur ? (cur.endsWith('-') ? cur + w : `${cur} ${w}`) : w;
      if (cur && textW(next, 12.5, 800) > maxW) { out.push(cur); cur = w; } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  // names: wrapped under wide columns; past 12 columns, one line at an angle (as on the main charts), so no name breaks into fragments
  const label = (d) => shortName(d) + (o.suffix ? o.suffix(d) : '');
  const tilt = n > 12, ANG = 40, ca = Math.cos((ANG * Math.PI) / 180), sa = Math.sin((ANG * Math.PI) / 180);
  const fullW = (d) => textW(`${label(d)}  ${d.effort || ''}`, 12.5, 800);
  const names = rows.map((d) => (tilt ? [label(d)] : wrap(label(d), pitch - 6)));
  const nameLines = Math.max(1, ...names.map((l) => l.length));
  const H = tilt ? B + 40 + Math.max(...rows.map(fullW)) * sa + 24 : B + 36 + nameLines * 15 + 20;
  if (tilt) {   // room on the left for the first tilted names, so none is pushed onto its neighbour
    for (let k = 0; k < 3; k++) L = Math.max(46, ...rows.map((d, i) => fullW(d) * ca + 8 - ((R - L) / n) * (i + 0.5)));
    pitch = (R - L) / n; bw = Math.min(pitch * 0.66, 80);
  }
  const col = (x, y, w, h, r) => (h <= 0 ? '' : `M${x.toFixed(1)} ${(y + h).toFixed(1)}V${(y + Math.min(r, h)).toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + Math.min(r, h)).toFixed(1)}V${(y + h).toFixed(1)}Z`);
  let s = '';
  for (let t = 0; t <= top; t += top > 50 ? 20 : top > 25 ? 10 : 5) s += `<line x1="${L}" x2="${R}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${L - 8}" y="${Y(t) + 4}" class="ax" text-anchor="end">${t}</text>`;
  rows.forEach((d, i) => {
    const cx = L + pitch * (i + 0.5), x = cx - bw / 2, vm = o.main(d), vr = o.ref(d), ym = Y(vm), yr = Y(vr), y0 = Y(0);
    const chip = o.chip(d), tone = chip.tone === 'good' ? ['var(--good-bg)', 'var(--good-ink)'] : chip.tone === 'bad' ? ['var(--bad-bg)', 'var(--bad-ink)'] : ['var(--track)', 'var(--ink-soft)'];
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(o.tip(d))}">`;
    s += `<rect x="${(cx - pitch / 2).toFixed(1)}" y="${T - 60}" width="${pitch.toFixed(1)}" height="${H - T + 60}" fill="transparent"/>`;
    if (vr > vm) {   // the outline only where it rises above the column: a light fill and a dashed cap, open at the bottom
      const r = Math.min(5, ym - yr), xr = x + bw;
      s += `<path d="${col(x, yr, bw, ym - yr, 5)}" fill="${d.tint}" fill-opacity=".09"/>`;
      s += `<path d="M${x.toFixed(1)} ${ym.toFixed(1)}V${(yr + r).toFixed(1)}Q${x.toFixed(1)} ${yr.toFixed(1)} ${(x + r).toFixed(1)} ${yr.toFixed(1)}H${(xr - r).toFixed(1)}Q${xr.toFixed(1)} ${yr.toFixed(1)} ${xr.toFixed(1)} ${(yr + r).toFixed(1)}V${ym.toFixed(1)}" fill="none" stroke="${d.tint}" stroke-width="1.8" stroke-dasharray="5 4"/>`;
    }
    s += `<path d="${col(x, ym, bw, y0 - ym, 5)}" fill="${d.tint}"/>`;
    if (vm > vr && y0 - yr > 2) s += `<line x1="${(x + 3).toFixed(1)}" x2="${(x + bw - 3).toFixed(1)}" y1="${yr.toFixed(1)}" y2="${yr.toFixed(1)}" stroke="#fff" stroke-width="2.2" stroke-dasharray="5 4"/>`;
    const mk = o.marker ? o.marker(d) : null;   // optional third value: a short ink bar across the column
    if (mk != null) s += `<line x1="${(x - 5).toFixed(1)}" x2="${(x + bw + 5).toFixed(1)}" y1="${Y(mk).toFixed(1)}" y2="${Y(mk).toFixed(1)}" stroke="var(--ink)" stroke-opacity=".8" stroke-width="2.2" stroke-linecap="round"/>`;
    // the value: inside the top of the column when it is tall enough, else above it, and above the dashed cap when that cap is close
    const hm = y0 - ym, inside = hm >= 26 && (mk == null || Y(mk) - ym > 22) && !(vm > vr && yr - ym < 24);   // not where the white reference line crosses it
    let yv;
    if (inside) {
      yv = ym + 17;
      s += `<text x="${cx.toFixed(1)}" y="${yv.toFixed(1)}" text-anchor="middle" style="font-size:13px;font-weight:800;fill:#fff;font-variant-numeric:tabular-nums">${esc(o.value(d))}</text>`;
    } else {
      yv = (vr > vm && ym - yr < 22 ? yr : Math.min(ym, mk != null ? Y(mk) : ym)) - 7;
      s += `<text x="${cx.toFixed(1)}" y="${yv.toFixed(1)}" text-anchor="middle" style="font-size:13.5px;font-weight:800;fill:var(--ink);stroke:var(--card);stroke-width:4px;paint-order:stroke;stroke-linejoin:round;font-variant-numeric:tabular-nums">${esc(o.value(d))}</text>`;
    }
    const cw = Math.max(34, textW(chip.text, 11.5, 800) + 14), cyTop = Math.min(inside ? ym : yv - 14, yr) - 26;
    s += `<rect x="${(cx - cw / 2).toFixed(1)}" y="${cyTop.toFixed(1)}" width="${cw.toFixed(1)}" height="19" rx="9.5" fill="${tone[0]}"/>`;
    s += `<text x="${cx.toFixed(1)}" y="${(cyTop + 13.5).toFixed(1)}" text-anchor="middle" style="font-size:11.5px;font-weight:800;fill:${tone[1]};font-variant-numeric:tabular-nums">${esc(chip.text)}</text>`;
    if (isNew(d)) s += `<text x="${cx.toFixed(1)}" y="${(cyTop - 6).toFixed(1)}" text-anchor="middle" style="font-size:10.5px;font-weight:800;letter-spacing:.5px;fill:${d.tint}">NEW!</text>`;
    if (isWarn(d)) s += `<g transform="translate(${(cx + cw / 2 + 2).toFixed(1)} ${(cyTop + 18).toFixed(1)}) scale(.5)">${warnSvg(12, 0, 34)}</g>`;
    s += iconSvg(d, (cx - 9).toFixed(1), B + 9, 18);
    if (tilt) {
      const nx = Math.max(cx + 4, 8 + fullW(d) * ca);   // a long name stays inside the chart
      s += `<text transform="translate(${nx.toFixed(1)} ${B + 40}) rotate(-${ANG})" text-anchor="end" style="font-size:12.5px;font-weight:800;fill:var(--ink)">${esc(label(d))}<tspan dx="6" style="font-weight:600;fill:var(--ink-faint)">${esc(d.effort || '')}</tspan></text></g>`;
    } else {
      names[i].forEach((ln, k) => { s += `<text x="${cx.toFixed(1)}" y="${B + 44 + k * 15}" text-anchor="middle" style="font-size:12.5px;font-weight:800;fill:var(--ink)">${esc(ln)}</text>`; });
      s += `<text x="${cx.toFixed(1)}" y="${B + 44 + names[i].length * 15 + 2}" text-anchor="middle" class="ax">${esc(d.effort || '')}</text></g>`;
    }
  });
  s += `<line x1="${L}" x2="${R}" y1="${B}" y2="${B}" stroke="var(--ink)" stroke-opacity=".25" stroke-width="1.5"/>`;
  const svg = `<svg class="hsvg pairs" viewBox="0 0 ${W} ${H}"${ph ? ` style="min-width:${W * 0.86}px"` : ''}>${s}</svg>`;
  return ph ? `<div class="hscroll">${svg}</div>` : svg;
}
// the key above a paired-column chart: what the solid column, the dashed outline and (optionally) the ink bar are
const pairKey = (main, ref, marker) => `<div class="pairkey"><span><i class="k-solid"></i>${esc(main)}</span><span><i class="k-dash"></i>${esc(ref)}</span>${marker ? `<span><i class="k-mark"></i>${esc(marker)}</span>` : ''}<span><i class="k-chip"></i>difference</span></div>`;
const signed = (v, digits = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

/* ---------- blind vs assisted RE ---------- */
function reHelpHTML(sort, hidden) {
  // like the released view: solid = blind (no examples), dashed outline = assisted (after 39 rated examples), which usually rises above it;
  // the chip is what the examples add. A model not re-run on v1.5.2 shows its v1.5.1 run for either part, marked † outdated.
  const B = (d) => valOfPart(d, 're_blind'), A = (d) => valOfPart(d, 're_assisted');
  const out = (d) => isPartLegacy(d, 're_blind') || isPartLegacy(d, 're_assisted');
  const base = DATA.filter((d) => !hidden.has(d.id) && B(d) != null && A(d) != null);
  const rows = sortBy(base, sort.key, sort.dir, (d, k) => (k === 'gain' ? A(d) - B(d) : k === 'model' ? d.model : k === 're_blind' ? B(d) : k === 're_assisted' ? A(d) : d[k]));
  const opts = [['gain', 'Gain from examples'], ['re_assisted', 'Assisted'], ['re_blind', 'Blind'], ['re_combined', 'Combined'], ['model', 'Name']];
  const chart = rows.length ? pairBars(rows, {
    main: B, ref: A, value: (d) => fmt2(B(d)), suffix: (d) => (out(d) ? '†' : ''),
    chip: (d) => { const g = A(d) - B(d); return { text: signed(g), tone: g > 0 ? 'good' : g < 0 ? 'bad' : '' }; },
    tip: (d) => `${modelEffort(d)} · blind ${fmt2(B(d))}${isPartLegacy(d, 're_blind') ? ' (outdated v1.5.1)' : ''} · assisted ${fmt2(A(d))}${isPartLegacy(d, 're_assisted') ? ' (outdated v1.5.1)' : ''} · RE combined ${fmt2(d.re_combined)}`,
  }) : `<p class="sub">${activeReMode() === 'none' || activeReMode() === 'single' ? 'Blind vs assisted RE was introduced in v1.5.' : 'No model with both scores is shown.'}</p>`;
  return card('Blind vs assisted RE: how much do examples help?',
    'The same RE test, run twice: blind, and again after the model studies 39 rated examples. The chip is what the examples add, in points.',
    `<div class="sortbar"><span class="seg-cap">Sort</span><div class="seg">${opts.map(([k, l]) => `<button type="button" data-hsort="${k}" class="${sort.key === k ? 'on' : ''}">${l}${sort.key === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`).join('')}</div></div>` +
    pairKey('Blind (no examples)', 'Assisted (after 39 rated examples)') + chart,
    `Only the ${rows.length} entries with both runs; every reasoning effort is its own column.${rows.some(out) ? ` † Outdated: a score from the model's v1.5.1 run (same games, older handoff wording), until it is re-run on ${CUR_STD()}.` : ''}`);
}

/* ---------- released vs unreleased: RE blind on the unreleased test games against RE blind on released games ---------- */
function releasedHTML(sort, hidden, mode = 'pts') {
  // solid = RE blind on the benchmark's unreleased games, dashed outline = RE blind on released games;
  // the chip says how much weaker the unreleased score is: points (unreleased − released) or percent of the released score
  // unreleased = the v1.5.2 blind score, or for a model not re-run yet its v1.5.1 blind run (same games, older handoff wording), marked †
  const ub = (d) => valOfPart(d, 're_blind'), old = (d) => isPartLegacy(d, 're_blind');
  const base = DATA.filter((d) => !hidden.has(d.id) && ub(d) != null && d.re_released != null);
  const pct = mode === 'pct';
  const dropPts = (d) => ub(d) - d.re_released;                                       // negative = weaker on unreleased
  const dropPct = (d) => (d.re_released > 0 ? (dropPts(d) / d.re_released) * 100 : null);
  const fmtPct = (v) => (v == null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v))}%`);
  const sizeOf = (d) => -(pct ? dropPct(d) ?? 0 : dropPts(d));                             // size of the drop: larger = weaker on unreleased
  const rows = sortBy(base, sort.key, sort.dir, (d, k) => (k === 'gap' ? sizeOf(d) : k === 'model' ? d.model : k === 're_blind' ? ub(d) : d[k]));
  const opts = [['gap', 'Biggest drop'], ['re_released', 'Released'], ['re_blind', 'Unreleased'], ['model', 'Name']];
  const avgDrop = base.length ? base.reduce((a, d) => a + dropPts(d), 0) / base.length : 0;
  const sumB = base.reduce((a, d) => a + ub(d), 0), sumR = base.reduce((a, d) => a + d.re_released, 0);
  const pooled = sumR > 0 ? ((sumB - sumR) / sumR) * 100 : null;
  const modeSeg = `<div class="seg" role="group" aria-label="Show the difference as">${[['pts', 'Points'], ['pct', 'Percent']].map(([k, l]) => `<button type="button" data-rmode="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const chart = rows.length ? pairBars(rows, {
    main: ub, ref: (d) => d.re_released, value: (d) => fmt2(ub(d)), suffix: (d) => (old(d) ? '†' : ''),
    chip: (d) => { const v = pct ? dropPct(d) : dropPts(d); return { text: pct ? fmtPct(v) : signed(v), tone: v == null ? '' : v < 0 ? 'bad' : v > 0 ? 'good' : '' }; },
    tip: (d) => `${modelEffort(d)} · unreleased ${fmt2(ub(d))}${old(d) ? ' (v1.5.1 run)' : ''} · released ${fmt2(d.re_released)} · ${signed(dropPts(d))} points (${fmtPct(dropPct(d))})`,
  }) : `<p class="sub">${['none', 'single', 'split3'].includes(activeReMode()) ? 'Released-games RE was introduced in v1.5.1.' : 'No model with both scores is shown.'}</p>`;
  return card('Released vs unreleased games: how much weaker on unseen games?',
    `Both runs are blind. The chip is how much weaker the score on the benchmark's own unreleased games is than on released commercial games (Balatro, Slay the Spire, World of Warcraft and others)${pct ? ', as a percent of the released score' : ', in points'}.`,
    `<div class="sortbar"><span class="sortgrp"><span class="seg-cap">Show</span>${modeSeg}</span><span class="sortgrp"><span class="seg-cap">Sort</span><div class="seg">${opts.map(([k, l]) => `<button type="button" data-rsort="${k}" class="${sort.key === k ? 'on' : ''}">${l}${sort.key === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`).join('')}</div></span></div>` +
    pairKey('Unreleased games', 'Released games') + chart,
    `A big drop can mean the model leans on what it already knows about famous games rather than reading the game in front of it. Only the ${base.length} entries with a released-games run so far; every reasoning effort is its own column.${base.some(old) ? ' † Outdated: unreleased score from the model\'s v1.5.1 blind run (same games, older handoff wording), until it is re-run.' : ''} On average the unreleased score is ${signed(avgDrop)} points${pooled != null ? `; all entries together score ${fmtPct(pooled)} on unreleased games` : ''}.`);
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
  const chart = pairBars(rows, {
    main: (d) => d._val, ref: (d) => d._exp, value: (d) => fmt2(d._val), suffix: (d) => (d.reLegacy ? '†' : ''),
    chip: (d) => ({ text: signed(d._gap), tone: d._gap > 0 ? 'good' : d._gap < 0 ? 'bad' : '' }),
    tip: (d) => `${modelEffort(d)} · Gamefeel ${fmt2(d._val)} · expected from AA index ${d.aaIndex}: ${d._exp.toFixed(2)}`,
  });
  const opts = [['gap', 'Outlier gap'], ['val', 'Gamefeel'], ['aa', 'AA index'], ['model', 'Name']];
  const what = metric === 're' ? 'RE combined' : 'overall';
  return card('Gamefeel vs general capability',
    `The dashed outline is the Gamefeel ${what} score a model would get from its general capability alone: a straight-line fit on the Artificial Analysis Intelligence Index (r² = ${fit.r2.toFixed(2)}). The chip is how far its real score is from that: green = better at game work than its general capability predicts, red = worse.`,
    tog + `<div class="sortbar"><span class="seg-cap">Sort</span><div class="seg">${opts.map(([k, l]) => `<button type="button" data-asort="${k}" class="${sort.key === k ? 'on' : ''}">${l}${sort.key === k ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}</button>`).join('')}</div></div>` +
    pairKey(`Gamefeel ${what} score`, 'Expected from the AA index') + chart,
    `AA index: Artificial Analysis Intelligence Index from artificialanalysis.ai, read 2026-11-13, matched to the same model and reasoning effort; ${base.length} entries have both. Models not on their leaderboard are left out.${base.some((d) => d.reLegacy) ? ` † Outdated: RE combined estimated from the model's v1.5.1 run until it is re-run on ${CUR_STD()}.` : ''}`);
}

/* ---------- progress over time: GCI (Gamefeel Capabilities Index) by each model's public release date ---------- */
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
  // date ticks: weekly over a short span, monthly (1st of the month) once the span passes ten weeks
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (d1 - d0 > 70 * 864e5) {
    const m0 = new Date(d0);
    for (let k = 1; ; k++) {
      const ms = Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + k, 1); if (ms > d1) break;
      s += `<line x1="${X(ms)}" x2="${X(ms)}" y1="${B}" y2="${B + 6}" stroke="${C.faint}"/><text x="${X(ms)}" y="${B + 22}" class="ax" text-anchor="middle">1 ${MON[new Date(ms).getUTCMonth()]}</text>`;
    }
  } else {
    for (let ms = Math.ceil(d0 / (7 * 864e5)) * 7 * 864e5; ms <= d1; ms += 7 * 864e5) {
      s += `<text x="${X(ms)}" y="${B + 22}" class="ax" text-anchor="middle">${new Date(ms).toISOString().slice(5, 10)}</text>`;
    }
  }
  // best GCI so far, as a step line: one for every model shown, one for open weights only
  const steps = (list, color, dash, label) => {
    let best = -Infinity, path = '', recs = [];
    list.forEach((d) => { if (d.gci > best) { const x = X(t(d.firstSeen)); path += path ? `H${x.toFixed(1)}V${Y(d.gci).toFixed(1)}` : `M${x.toFixed(1)} ${Y(d.gci).toFixed(1)}`; best = d.gci; recs.push(d); } });
    if (!path) return { s: '', recs };
    path += `H${X(d1).toFixed(1)}`;
    const end = ph ? '' : `${label} ${best.toFixed(2)}`;
    return { s: `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${R + 8}" y="${Y(best) + 4}" class="lbl" style="fill:${color}">${end}</text>`, recs, endBox: end ? { x0: R + 6, x1: R + 12 + textW(end, 13, 800), y0: Y(best) - 10, y1: Y(best) + 6 } : null };
  };
  const all = steps(rows, C.azure, '', 'best');
  const open = state.openOnly ? { s: '', recs: [] } : steps(rows.filter((d) => d.openWeights), 'var(--good)', '9 6', 'best open');
  s += all.s + open.s;
  // labels already placed (the two end labels first): a new one moves down (then up), right of its dot, then left of it, until it is clear
  const boxes = [all.endBox, open.endBox].filter(Boolean);
  let labels = '';
  const place = (cx, y, text) => {
    const w = textW(text, 11, 700) + 6;
    for (const side of [1, -1]) {
      for (let k = 0; k < 14; k++) {
        const yy = y + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 15;
        const x = side > 0 ? cx + 10 : cx - 10 - w;
        const b = { x0: x, x1: x + w, y0: yy - 11, y1: yy + 3 };
        if (!boxes.some((o) => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1) && b.x1 < W - 4 && b.x0 > L) { boxes.push(b); return { x: side > 0 ? x : cx - 10, y: yy, anchor: side > 0 ? 'start' : 'end' }; }
      }
    }
    return null;
  };
  rows.forEach((d) => {
    const rec = all.recs.includes(d) || open.recs.includes(d);
    const lp = rec && !ph ? place(X(t(d.firstSeen)), Y(d.gci) - 9, modelEffort(d)) : null;
    s += `<g data-m="${esc(d.id)}" data-tip="${esc(`${modelEffort(d)} · GCI ${d.gci.toFixed(2)} · released ${d.firstSeen}${d.openWeights ? ' · open weights' : ''}`)}">` +
      `<circle cx="${X(t(d.firstSeen)).toFixed(1)}" cy="${Y(d.gci).toFixed(1)}" r="${rec ? 7 : 5}" fill="${d.tint}" ${d.openWeights ? '' : 'fill-opacity=".85"'} stroke="#fff" stroke-width="1.5"/>` +
      '</g>';
    if (lp) labels += `<text x="${lp.x.toFixed(1)}" y="${lp.y}" class="tiny" text-anchor="${lp.anchor}" data-m="${esc(d.id)}">${esc(modelEffort(d))}</text>`;
  });
  s += labels;   // drawn after every dot, so no dot covers a label
  const recList = [...all.recs.map((d) => ['best', d]), ...open.recs.map((d) => ['open', d])].sort((a, b) => a[1].firstSeen.localeCompare(b[1].firstSeen));
  const table = `<table class="plist"><tr><th>Date</th><th>New record</th><th></th><th>GCI</th></tr>${recList.map(([k, d]) => `<tr data-m="${esc(d.id)}"><td>${d.firstSeen}</td><td><span class="nm">${iconHTML(d)}<b>${esc(d.model)}</b><small>${esc(d.effort)}</small></span></td><td><span class="ptag ${k}">${k === 'open' ? 'best open' : 'best overall'}</span></td><td><b>${d.gci.toFixed(2)}</b></td></tr>`).join('')}</table>`;
  const gci = META.gci || {};
  const chain = Array.isArray(gci.chain) ? gci.chain : [];
  const scaleTable = chain.length ? (
    '<h3 class="gci-scale-title">Version history &amp; GCI scaling</h3>' +
    `<p class="gci-scale-sub">Each version change is calibrated from overlapping models tested in both versions (ordinary least squares, chained from base ${esc(gci.base || 'v1.5')}). Click any version to inspect its historical scores.</p>` +
    '<div class="tscroll"><table class="plist"><tr><th>Version</th><th>Date</th><th>Entries</th><th>Shift vs prev</th><th>GCI scale</th><th>What changed</th><th></th></tr>' +
    chain.slice().reverse().map((v) => {
      const tr = v.transition;
      const fit = v.gci_fit || {};
      const shiftCell = tr
        ? `${signed(tr.delta_mean)} pts <small>(R² ${tr.r2.toFixed(3)}, ${tr.anchors} models)</small>`
        : '<small>initial</small>';
      const eqCell = fit.ref === 'base'
        ? '1.00 × avg <small>(base)</small>'
        : `${Number(fit.a).toFixed(3)} × avg ${fit.b >= 0 ? '+' : '−'} ${Math.abs(fit.b).toFixed(2)}`;
      const isCur = v.id === META.standard;
      const btn = isCur
        ? '<span class="vbtn cur">Viewing</span>'
        : `<button type="button" class="vbtn" data-switch-ver="${esc(v.id)}">View ${esc(v.id)}</button>`;
      return `<tr><td><b>${esc(v.id)}</b>${v.id === (VERSIONS && VERSIONS.latest) ? ' <span class="ptag best">latest</span>' : ''}</td><td>${esc(v.date)}</td><td class="num">${v.entries}</td><td class="num">${shiftCell}</td><td class="num">${eqCell}</td><td class="wrap">${esc(v.step_note || '')}</td><td>${btn}</td></tr>`;
    }).join('') + '</table></div>'
  ) : '';
  return card('Progress over time · GCI',
    'GCI, the Gamefeel Capabilities Index: one number per model that stays comparable when the benchmark moves to a new version. Each dot is a model at its public release date; the lines step up each time a new best arrives.' + (state.openOnly ? '' : ' <span style="color:var(--azure);font-weight:800">Solid blue</span>: best of all models. <span style="color:var(--good-ink);font-weight:800">Dashed green</span>: best open-weight model.'),
    `<svg class="hsvg" viewBox="0 0 ${W} ${H}">${s}</svg><div class="tscroll">${table}</div>${scaleTable}`,
    `GCI on ${esc(gci.base || 'v1.5')} = the overall score. Across every version change (v1.2 through ${esc((VERSIONS && VERSIONS.latest) || META.standard || 'v1.5.3')}), the build fits a straight line over all overlapping models tested in both versions, chaining backward and forward so scores stay on one comparable scale; all versions are kept in data/gci-history.csv. Dates are each model's public release date. Only released models with all category scores have a GCI; unreleased and stealth models are left out until they ship.`);
}

/* ---------- overview: a tile per view, each with a small live preview; a click opens the view ---------- */
const TILE_EXTRA = 14;   // rows past n wait hidden; fillTiles() shows as many as fit the card
const exAttr = (i, n) => (i >= n ? ' class="ex" data-ex="1"' : '');
const miniBars = (rows, val, fmt = fmtScore, n = 4) => {
  const top = rows.slice(0, n + TILE_EXTRA), max = top.length ? Math.max(...top.map(val)) || 1 : 1;
  return `<ol class="mini">${top.map((d, i) => `<li${exAttr(i, n)}><span class="mn">${iconHTML(d)}<b>${esc(d.model)}</b>${isWarn(d) ? warnHTML : ''}</span><i style="width:${Math.max(3, (val(d) / max) * 100).toFixed(0)}%;background:${d.tint}"></i><em>${fmt(val(d))}</em></li>`).join('')}</ol>`;
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
  const rw = activeReWeight(), pks = activeScoreKeys();
  const ovSub = rw === 1.5 ? 'Weighted average, RE at 1.5x' : rw === 1 ? 'Equal average of 7 scores' : 'Equal average of 6 scores';
  add('explorer/overall/score', 'Overall ranking', ovSub, miniBars(ranked('avg'), (d) => d.avg, fmt2, 5), true);
  SCOPES.slice(1).forEach(([k, l]) => add(`explorer/${k}/score`, l, k === 're' ? 'Feedback on game proposals' : 'Score out of 100', miniBars(ranked(k), (d) => d[k], k === 're' ? fmt2 : fmtScore, 3)));
  const priced = vis.filter((d) => d.complete && d.px != null);
  add('explorer/overall/p2p', 'Price to performance', 'Overall score against price per task, blue = best value line', miniScatter(priced, (d) => d.px, (d) => d.avg));
  const sized = vis.filter((d) => d.complete && d.openWeights && d.size != null);
  add('explorer/overall/size', 'Size to performance', 'Open-weight models: size against score', miniScatter(sized, (d) => d.size, (d) => d.avg));
  add('speed/tps', 'Speed', 'Output tokens per second', miniBars(ranked('tps'), (d) => d.tps, (v) => `${v}`, 3));
  const best = ranked('avg')[0];
  add('profiles', 'Profiles', `${pks.length === 6 ? 'Six' : 'Seven'} scores as one shape per model`, best ? `<svg class="msc" viewBox="0 0 240 92">${[best].map((d) => { const pts = pks.map((k, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / pks.length, r = ((d[k] ?? 0) / 100) * 42; return `${(120 + Math.cos(a) * r).toFixed(1)},${(46 + Math.sin(a) * r).toFixed(1)}`; }); return `<polygon points="${pks.map((k, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / pks.length; return `${(120 + Math.cos(a) * 42).toFixed(1)},${(46 + Math.sin(a) * 42).toFixed(1)}`; }).join(' ')}" fill="none" stroke="${C.track}" stroke-width="1.5"/><polygon points="${pts.join(' ')}" fill="${d.tint}" fill-opacity=".2" stroke="${d.tint}" stroke-width="2"/>`; }).join('')}</svg><p class="tnote">${esc(modelEffort(best))}</p>` : '');
  add('ledger', 'Ledger', 'Every column for every entry, sortable', `<p class="tbig">${vis.length}<small> entries</small></p><p class="tnote">price, speed, context, all scores</p>`);
  const hm = ranked('avg').slice(0, 5), range = Object.fromEntries(GLANCE_COLS.map(([k]) => { const v = DATA.map((d) => d[k]).filter((x) => x != null); return [k, v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]]; }));
  add('glance', 'Every score at a glance', 'Sortable heatmap of all scores', `<div class="mhm">${hm.map((d) => GLANCE_COLS.map(([k]) => { const [a, b] = range[k], t = d[k] == null ? 0 : (d[k] - a) / (b - a || 1); return `<i style="background:${k === 'avg' ? 'var(--ink)' : heatBg(t)}"></i>`; }).join('')).join('')}</div>`);
  const tb = (d) => valOfPart(d, 're_blind'), ta = (d) => valOfPart(d, 're_assisted');   // as in the view: outdated v1.5.1 runs count too
  const ra = vis.filter((d) => tb(d) != null && ta(d) != null).sort((a, b) => (ta(b) - tb(b)) - (ta(a) - tb(a))).slice(0, 3 + TILE_EXTRA);
  add('rehelp', 'Blind vs assisted RE', 'How much rated examples help', `<ol class="mini">${ra.map((d, i) => `<li${exAttr(i, 3)}><span class="mn">${iconHTML(d)}<b>${esc(modelEffort(d))}</b></span><span class="db"><i style="left:${tb(d)}%;width:${Math.max(1, ta(d) - tb(d))}%;background:${d.tint}"></i></span><em>+${(ta(d) - tb(d)).toFixed(2)}</em></li>`).join('')}</ol>`);
  const ubv = (d) => d.re_blind ?? d.reBlindOld;   // as in the released view: the older blind run stands in until a model is re-run
  const rv = vis.filter((d) => ubv(d) != null && d.re_released > 0).sort((a, b) => (ubv(a) - a.re_released) / a.re_released - (ubv(b) - b.re_released) / b.re_released).slice(0, 3 + TILE_EXTRA);
  add('released', 'Released vs unreleased games', 'How much weaker on unseen games', `<ol class="mini">${rv.map((d, i) => { const g = ((ubv(d) - d.re_released) / d.re_released) * 100; return `<li${exAttr(i, 3)}><span class="mn">${iconHTML(d)}<b>${esc(modelEffort(d))}</b></span><em class="${g >= 0 ? 'up' : 'dn'}">${g >= 0 ? '+' : '−'}${Math.round(Math.abs(g))}%</em></li>`; }).join('')}</ol>`);
  if (activeReMode() === 'v152') {
    const bhTop = bestPerModel(vis.filter((d) => valOfPart(d, 're_blind_hard') != null).sort((a, b) => valOfPart(b, 're_blind_hard') - valOfPart(a, 're_blind_hard')))[0];
    const bhTopV = bhTop ? valOfPart(bhTop, 're_blind_hard') : null;
    const bhMax = Math.max(HUMAN_EXPERT_BLIND_HARD.v, bhTopV || 0);
    const bhRows = [
      `<li><span class="mn"><b style="color:${HUMAN_EXPERT_BLIND_HARD.color}">Human expert (100+ hrs)</b></span><i style="width:${((HUMAN_EXPERT_BLIND_HARD.v / bhMax) * 100).toFixed(1)}%;background:${HUMAN_EXPERT_BLIND_HARD.color}"></i><em>~60%</em></li>`,
      ...(bhTop ? [`<li><span class="mn">${iconHTML(bhTop)}<b>${esc(modelEffort(bhTop))}</b></span><i style="width:${Math.max(4, (bhTopV / bhMax) * 100).toFixed(1)}%;background:${bhTop.tint}"></i><em>${fmt2(bhTopV)}</em></li>`] : []),
      `<li><span class="mn"><b style="color:${HUMAN_AVG_BLIND_HARD.color}">120 IQ avg gamer</b></span><i style="width:${Math.max(3, (HUMAN_AVG_BLIND_HARD.v / bhMax) * 100).toFixed(1)}%;background:${HUMAN_AVG_BLIND_HARD.color}"></i><em>~2%</em></li>`,
    ].join('');
    add('explorer/re/score/blind-hard-human', 'Blind hard vs human', 'AI vs ~2% avg gamer and ~60% expert', `<ol class="mini">${bhRows}</ol>`);
  }
  const fam = {}; vis.filter((d) => d.avg != null && d.price > 0 && d.effort in EFFORT_ORDER).forEach((d) => { (fam[d.model] = fam[d.model] || []).push(d); });
  const F = Object.values(fam).filter((g) => g.length > 1).map((g) => g.sort((a, b) => EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort]));
  add('effort', 'Is more effort worth it?', 'Each model across its effort levels', `<ol class="mini">${F.slice(0, 3 + TILE_EXTRA).map((g, i) => `<li${exAttr(i, 3)}><span class="mn">${iconHTML(g[0])}<b>${esc(g[0].model)}</b></span><em class="wide">${g.map((d) => `${d.effort[0]}${d.effort === 'XHigh' ? 'H' : ''} ${d.avg.toFixed(2)}`).join(' → ')}</em></li>`).join('')}</ol>`);
  const both = vis.filter((d) => d.aaIndex != null && d.avg != null);
  let gen = '';
  if (both.length >= 3) {
    const fit = linFit(both.map((d) => [d.aaIndex, d.avg]));
    const g = both.map((d) => ({ d, gap: d.avg - (fit.a + fit.b * d.aaIndex) })).sort((a, b) => b.gap - a.gap);
    gen = `<ol class="mini">${[...g.slice(0, 2 + TILE_EXTRA).filter((x) => x !== g[g.length - 1]), g[g.length - 1]].map(({ d, gap }, i, arr) => `<li${i >= 2 && i < arr.length - 1 ? ' class="ex" data-ex="1"' : ''}><span class="mn">${iconHTML(d)}<b>${esc(d.model)}</b></span><em class="${gap >= 0 ? 'up' : 'dn'}">${gap >= 0 ? '▲ +' : '▼ −'}${Math.abs(gap).toFixed(2)}</em></li>`).join('')}</ol>`;
  }
  add('general', 'Gamefeel vs general capability', 'Who beats their Artificial Analysis index', gen);
  const pg = vis.filter((d) => d.gci != null && d.firstSeen).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  let bestSoFar = -Infinity; const recs = pg.filter((d) => (d.gci > bestSoFar ? ((bestSoFar = d.gci), true) : false));
  add('progress', 'Progress over time', 'GCI: the best Gamefeel score so far', recs.length ? `<ol class="mini">${recs.slice(-(3 + TILE_EXTRA)).reverse().map((d, i) => `<li${exAttr(i, 3)}><span class="mn">${iconHTML(d)}<b>${esc(d.model)}</b></span><em class="wide">${d.firstSeen.slice(5)} · GCI ${d.gci.toFixed(2)}</em></li>`).join('')}</ol>` : '');
  return `<div class="tiles">${tiles.map((t) => `<button type="button" class="tile${t.big ? ' big' : ''}" data-open="${t.go}"><span class="th"><b>${esc(t.title)}</b><span class="arrow">↗</span></span><small>${esc(t.sub)}</small><div class="tb">${t.body}</div></button>`).join('')}</div>`;
}

/* ---------- overview: headline, top-3 cards, the top-12 leaderboard, category leaders and best value; the view tiles below ---------- */
const OV_EFFORT = { Low: 1, Medium: 2, High: 3, XHigh: 4, Max: 5 };
const OV_ABBR = { create: 'CR', bugfix: 'DB', gamefeel: 'GF', ideas: 'ID', visuals: 'VI', audio: 'AU', re: 'RE' };
const OV_CAT = { create: 'Create', bugfix: 'Debugging', gamefeel: 'Gamefeel', ideas: 'Ideas', visuals: 'Visuals', audio: 'Audio', re: 'Reverse-eval' };
const ovMeter = (d) => `<span class="ov-mtr" title="${esc(d.effort || 'No')} reasoning effort">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= (OV_EFFORT[d.effort] || 0) ? 'f' : ''}"></i>`).join('')}</span>`;
const ovCost = (d) => (d.price == null ? '<span class="ov-cost">no price</span>' : d.free ? '<span class="ov-cost">Free</span>' : `<span class="ov-cost">$${d.price.toFixed(2)}<small> per task</small></span>`);
const ovFloor = (lb) => (lb.length ? Math.max(0, Math.floor((Math.min(...lb.map((d) => d.avg)) - 5) / 5) * 5) : 0);   // the leaderboard axis starts one step below the 12th score
function overviewHTML(hidden) {
  return withLegacy(true, () => {
    const vis = DATA.filter((d) => !hidden.has(d.id));
    const ks = activeScoreKeys();
    const top = vis.filter((d) => d.complete).sort((a, b) => b.avg - a.avg);
    // the small bars on each top-3 card run from the worst to the best score in that category
    const range = Object.fromEntries(ks.map((k) => { const v = DATA.map((d) => d[k]).filter((x) => x != null); return [k, v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]]; }));
    const nm = (d) => `${esc(shortName(d))}${isWarn(d) ? warnHTML : ''}`;
    const pod = top.slice(0, 3).map((d, i) => `<button type="button" class="ov-pod" data-open="explorer/overall/score" style="--c:${d.tint}"><span class="ov-rank">#${i + 1}</span>` +
      `<span class="ov-lg">${iconHTML(d)}</span><span class="ov-nm">${nm(d)}</span>` +
      `<span class="ov-meta"><span class="ov-eff">${ovMeter(d)}${esc(d.effort || '—')}</span>${ovCost(d)}</span>` +
      `<span class="ov-score">${fmt2(d.avg)}<small>/ 100</small></span>` +
      `<span class="ov-mini">${ks.map((k) => { const [a, b] = range[k], v = d[k]; const h = v == null ? 0 : 6 + 94 * (v - a) / (b - a || 1);
        return `<span><i><b style="height:${h.toFixed(1)}%"></b></i><em>${v == null ? '—' : Math.round(v)}</em>${OV_ABBR[k] || k}</span>`; }).join('')}</span></button>`).join('');
    const lb = top.slice(0, 12);
    let chart = '', list = '';
    const mn = ovFloor(lb);
    if (lb.length) {
      const mx = Math.ceil(Math.max(...lb.map((d) => d.avg)) / 5) * 5, rg = mx - mn || 5;
      const ticks = []; for (let t = mn; t <= mx; t += 5) ticks.push(t);
      chart = `<div class="ov-vc"><div class="ov-ax">${ticks.map((t) => `<span style="bottom:${((t - mn) / rg) * 100}%">${t}</span>`).join('')}</div><div class="ov-plot"><div class="ov-grid">${ticks.map((t) => `<i style="bottom:${((t - mn) / rg) * 100}%"></i>`).join('')}</div>` +
        [...lb].reverse().map((d) => `<div class="ov-col" style="--c:${d.tint}" data-tip="${esc(modelEffort(d))} · ${fmt2(d.avg)} · ${esc(priceText(d))}"><div class="ov-top"><b>${fmt2(d.avg)}</b><i style="height:${(((d.avg - mn) / rg) * 100).toFixed(1)}%"></i></div>` +
          `<div class="ov-foot">${iconHTML(d)}<em>${esc(d.effort === 'Medium' ? 'Med' : (d.effort || ''))}</em><u>${esc(priceLabel(d))}</u></div><div class="ov-rot"><span>${esc(shortName(d))}</span></div></div>`).join('') + '</div></div>';
      list = `<ol class="ov-list">${lb.map((d, i) => `<li><span class="rk">${i + 1}</span>${iconHTML(d)}<span class="n"><b>${nm(d)}</b><em>${esc(d.effort || '')}</em></span><span class="v">${fmt2(d.avg)}</span></li>`).join('')}</ol>`;
    }
    const foot = [mn ? `Scale starts at ${mn} to separate the top ${lb.length}.` : '', legacyFootnote(lb) || ''].filter(Boolean).join(' ');
    const cats = ks.map((k) => { const w = bestPerModel(vis.filter((d) => d[k] != null).sort((a, b) => b[k] - a[k]))[0]; if (!w) return '';
      return `<button type="button" class="ov-cat" data-open="explorer/${k}/score"><span class="k">${OV_CAT[k] || k}</span><span class="w">${iconHTML(w)}<span class="t"><b>${nm(w)}</b> <em>${esc(w.effort || '')}</em></span></span><span class="s">${k === 're' ? fmt2(w[k]) : Math.round(w[k])}</span></button>`; }).join('');
    const val = vis.filter((d) => d.avg != null && d.avg >= 40 && d.price > 0).sort((a, b) => b.avg / b.price - a.avg / a.price).slice(0, 4)
      .map((d) => `<div class="ov-cat"><span class="w">${iconHTML(d)}<span class="t"><b>${nm(d)}</b> <em>${esc(d.effort || '')}</em></span></span><span class="s">${d.avg.toFixed(1)}</span><span class="p">${esc(priceLabel(d))}</span></div>`).join('');
    const eyebrow = `${esc(META.standard || '')}${META.updated ? ` · updated ${esc(shortDate(META.updated))}` : ''}`;
    return '<div class="ov">' +
      `<section class="ov-hero"><div class="ov-hl"><span class="ov-eyebrow">${eyebrow}</span><h1>AI models, ranked on real game development</h1>` +
      `<p>Each model adds content and balance changes to 12 unpublished games, then is scored on coding, gamefeel, creativity and how well it judges other people's designs, across more than 70,000 tasks.</p></div>` +
      `<div class="ov-podium">${pod || '<p class="ov-empty">No model with every score is shown.</p>'}</div></section>` +
      `<div class="ov-cols"><section class="ov-card"><header><h2>Overall leaderboard</h2><a data-open="explorer/overall/score">See every score →</a></header>` +
      `<div class="ov-desk">${chart}</div><div class="ov-mob">${list}</div>${foot ? `<p class="ov-fn">${esc(foot)}</p>` : ''}</section>` +
      `<div class="ov-stack"><section class="ov-card"><header><h2>Category leaders</h2></header>${cats}</section>` +
      (val ? `<section class="ov-card"><header><h2>Best value</h2><span class="ov-sub">score ≥ 40, most points per $</span></header>${val}</section>` : '') + '</div></div>' +
      `<h2 class="ov-more">More views</h2>${tilesHTML(hidden)}</div>`;
  });
}

/* ---------- method / how it works page ---------- */
function methodHTML() {
  return `<div class="method-wrap">
    <section class="method-sec" id="method-re">
      <img class="method-img" src="assets/how-re-works.png" alt="How Reverse-Evaluation (RE) Works" />
    </section>
    <section class="method-sec" id="method-visuals">
      <img class="method-img" src="assets/visuals-example-typecast.png" alt="Visuals Subsection Example: Typecast across 6 AI models" />
    </section>
  </div>`;
}

/* ---------- app state ---------- */
const TABS_KEYS = TABS.map((t) => t[0]);
const TOP3 = () => DATA.filter((d) => d.complete).sort((a, b) => b.avg - a.avg).slice(0, 3).map((d) => d.id);
const state = {
  tab: 'overview', scope: 'overall', mode: 'score', metric: 'tps', reView: 'combined', reLook: 'classic', methodSec: '',
  sort: { key: 'avg', dir: -1 }, hidden: new Set(), prof: new Set(), spot: null, labFilter: 'all',
  openOnly: false, q: '',
  gsort: { key: 'avg', dir: -1 }, hsort: { key: 'gain', dir: -1 }, rsort: { key: 'gap', dir: -1 }, rmode: 'pts', asort: { key: 'gap', dir: -1 }, emetric: 'avg', gmetric: 'avg',
};

/* The open-weights switch hides every closed (or unflagged) model in every view, on top of the ticks in the model list. */
/* The header search does the same for every model whose name, effort or lab does not match. */
const viewHidden = () => {
  const out = state.openOnly ? new Set([...state.hidden, ...DATA.filter((d) => !d.openWeights).map((d) => d.id)]) : new Set(state.hidden);
  const q = state.q.trim().toLowerCase();
  if (q) DATA.forEach((d) => { if (!`${d.model} ${d.effort} ${d.lab}`.toLowerCase().includes(q)) out.add(d.id); });
  return out;
};
function buildCurrent() {
  const phone = isPhone();
  const hidden = viewHidden();
  if (state.tab === 'overview') return { html: overviewHTML(hidden) };
  if (phone && state.tab === 'explorer' && state.mode === 'score') return { html: rankListHTML(state.scope, hidden) };
  switch (state.tab) {
    case 'glance': return { html: glanceHTML(state.gsort, hidden) };
    case 'rehelp': return { html: reHelpHTML(state.hsort, hidden) };
    case 'released': return { html: releasedHTML(state.rsort, hidden, state.rmode) };
    case 'effort': return { html: effortHTML(state.emetric, hidden) };
    case 'general': return { html: generalHTML(state.gmetric, state.asort, hidden) };
    case 'progress': return { html: progressHTML(hidden) };
    case 'overview': return overviewFig(hidden);
    case 'explorer': return state.mode === 'score' ? (state.scope === 're' && state.reLook === 'board' ? reBoardFig(hidden)
      : state.scope === 're' && state.reView === 'blind-hard-human' ? reBlindHardHumanFig(hidden)
      : scoresFig(state.scope, hidden))
      : state.mode === 'size' ? sizeFig(state.scope, hidden) : ppFig(state.scope, hidden);
    case 'profiles': return radarFig([...state.prof], hidden);
    case 'speed': return speedFig(state.metric, hidden);
    case 'ledger': return ledgerFig(state.sort, hidden);
    case 'method': return { html: methodHTML() };
    default: return overviewFig(hidden);
  }
}
// controls toolbar: the explorer's score picker in groups, chart type with icons, the open-weights switch on the right
const SCOPE_GROUPS = [[null, ['overall']], ['Coding', ['create', 'bugfix']], [null, ['gamefeel']], ['Creativity', ['ideas', 'visuals', 'audio']], [null, ['re']]];
const SCOPE_BTN = { overall: 'Overall', create: 'Create', bugfix: 'Debugging', gamefeel: 'Gamefeel', ideas: 'Ideas', visuals: 'Visuals', audio: 'Audio', re: 'Gamefeel · RE' };
const MODES = [['score', 'Scores', 'Scores, as columns'], ['p2p', 'Price', 'Price to performance'], ['size', 'Size', 'Size to performance (open-weight models)']];
const MODE_ICON = {
  score: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="8.5" width="3" height="6" rx="1"/><rect x="6.5" y="5" width="3" height="9.5" rx="1"/><rect x="11.5" y="1.5" width="3" height="13" rx="1"/></svg>',
  p2p: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13 7 7.5 14 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="2.5" cy="12.5" r="1.9"/><circle cx="7" cy="7.5" r="1.9"/><circle cx="13.5" cy="3.5" r="1.9"/><circle cx="11" cy="11.5" r="1.5" opacity=".45"/></svg>',
  size: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="10" r="4"/><circle cx="12" cy="5" r="2.6" opacity=".55"/></svg>',
};
function subControlsHTML() {   // a second row inside the toolbar, only in the explorer's RE section
  if (state.tab !== 'explorer' || state.scope !== 're') return '';
  const rm = activeReMode();
  const views = activeReViews();
  if (views.length <= 1 && rm !== 'v152') return '';
  const hasBoard = rm === 'v152';
  const board = hasBoard && state.mode === 'score' && state.reLook === 'board';
  return `<div class="tb-sub">${board ? '' : `<span class="sub-g"><span class="seg-cap">RE score</span><span class="subtabs" role="group" aria-label="RE score view">${views.map((v) =>
    `<button type="button" data-review="${v}" class="${state.reView === v ? 'on' : ''}" aria-pressed="${state.reView === v}" title="${esc(RE_TIP[v])}">${RE_LABEL[v]}</button>`).join('')}</span></span>`}` +
    (hasBoard && state.mode === 'score' ? `<span class="sub-g look"><span class="seg-cap">Look</span><span class="subtabs" role="group" aria-label="RE look">${[['classic', 'Classic', 'One RE score at a time, as columns'], ['board', 'Board', 'RE combined split into its five parts, with every part ranked']].map(([k, l, t]) =>
      `<button type="button" data-relook="${k}" class="${state.reLook === k ? 'on' : ''}" aria-pressed="${state.reLook === k}" title="${t}">${l}</button>`).join('')}</span></span>` : '') + '</div>';
}
function controlsHTML() {
  switch (state.tab) {
    case 'overview':
      return '<span class="slim-cap">Overview</span>';
    case 'explorer':
      // the score to show, grouped the way the benchmark is built (Coding and Creativity have two and three parts), then the chart type
      return `<div class="scopes" role="group" aria-label="Score">${SCOPE_GROUPS.map(([cap, ks]) => `<div class="sg${cap ? ' cap' : ''}">${cap ? `<span class="sgc">${cap}</span>` : ''}<div class="sgb">${ks.map((k) =>
        `<button type="button" data-scope="${k}" class="${state.scope === k ? 'on' : ''}" aria-pressed="${state.scope === k}" title="${esc(SCOPE_LABEL[k])}">${SCOPE_BTN[k]}</button>`).join('')}</div></div>`).join('')}</div>` +
        `<div class="modes" role="group" aria-label="Chart type">${MODES.map(([k, l, t]) => `<button type="button" data-mode="${k}" class="${state.mode === k ? 'on' : ''}" aria-pressed="${state.mode === k}" title="${t}">${MODE_ICON[k]}<span>${l}</span></button>`).join('')}</div>`;
    case 'profiles':
      return DATA.filter((d) => d.complete).map((d) => `<button type="button" class="chip ${state.prof.has(d.id) ? 'on' : ''}" data-prof="${esc(d.id)}">${iconHTML(d)}${esc(d.model)} <span style="opacity:.6">${esc(d.effort)}</span></button>`).join('') +
        '<button type="button" class="chip plain" data-act="top3">reset to top 3</button>';
    case 'speed':
      return `<div class="modes" role="group" aria-label="Speed measure"><button type="button" data-metric="tps" class="${state.metric === 'tps' ? 'on' : ''}" aria-pressed="${state.metric === 'tps'}">Tokens per second</button><button type="button" data-metric="min" class="${state.metric === 'min' ? 'on' : ''}" aria-pressed="${state.metric === 'min'}">Minutes per task</button></div>`;
    case 'ledger':
      return '<span class="slim-cap"><span class="desk-only">Full ledger · click any column heading to sort</span><span class="mob-only">Full ledger</span></span>';
    case 'method':
      return '<span class="crumb">Methodology</span><span class="crumb-sub">How Reverse-Evaluation and Visuals are scored</span>';
    case 'glance': case 'rehelp': case 'released': case 'effort': case 'general': case 'progress':
      return `<button type="button" class="crumb-btn" data-open-menu="1" title="Switch view"><span class="crumb-k">☰ More views</span><span class="crumb-sep">·</span><span>${esc(EXTRA.find((e) => e[0] === state.tab)[1])}</span></button>`;
    default: return '';
  }
}

const LAB_BUCKETS = [
  ['all', 'All', () => true],
  ['google', 'Google', (d) => /google|deepmind/i.test(d.lab)],
  ['anthropic', 'Anthropic', (d) => /anthropic/i.test(d.lab)],
  ['openai', 'OpenAI', (d) => /openai/i.test(d.lab)],
  ['alibaba', 'Alibaba', (d) => /alibaba|qwen/i.test(d.lab)],
  ['deepseek', 'DeepSeek', (d) => /deepseek/i.test(d.lab)],
  ['other', 'Other', (d) => !/google|deepmind|anthropic|openai|alibaba|qwen|deepseek/i.test(d.lab)],
];
function sidebarFilteredList() {
  const q = $('#q').value.trim().toLowerCase();
  const bucket = LAB_BUCKETS.find(([k]) => k === state.labFilter) || LAB_BUCKETS[0];
  return DATA.filter((d) => bucket[2](d) && (!q || `${d.model} ${d.effort} ${d.lab}`.toLowerCase().includes(q)));
}
function applySpot() {
  document.querySelectorAll('#stage [data-m]').forEach((el) => {
    el.style.opacity = !state.spot || el.dataset.m === state.spot ? '' : '0.16';
  });
}
function renderSidebar() {
  const pillsEl = $('#labPills');
  if (pillsEl) {
    pillsEl.innerHTML = LAB_BUCKETS.map(([k, l, fn]) => {
      const cnt = k === 'all' ? DATA.length : DATA.filter(fn).length;
      if (k !== 'all' && cnt === 0) return '';
      const on = state.labFilter === k;
      return `<button type="button" data-lab="${k}" class="${on ? 'on' : ''}" aria-pressed="${on}">${k === 'all' ? `All (${cnt})` : esc(l)}</button>`;
    }).join('');
  }
  const list = sidebarFilteredList();
  // one card per model, best overall first; its reasoning-effort levels are toggles inside it
  const groups = new Map();
  list.forEach((d) => { if (!groups.has(d.model)) groups.set(d.model, []); groups.get(d.model).push(d); });
  const best = (g) => Math.max(...g.map((d) => (d.complete ? d.avg : -1)));
  const ordered = [...groups.values()].map((g) => g.sort((a, b) => (EFFORT_ORDER[b.effort] ?? -1) - (EFFORT_ORDER[a.effort] ?? -1))).sort((a, b) => best(b) - best(a));
  $('#modelList').innerHTML = ordered.map((g) => {
    const nOn = g.filter((d) => !state.hidden.has(d.id)).length;
    const st = nOn === g.length ? 'all' : nOn ? 'some' : 'none';
    const top = g.reduce((a, b) => ((b.complete ? b.avg : -1) > (a.complete ? a.avg : -1) ? b : a));
    return `<div class="mgrp ${st}" data-row="${esc(top.id)}" style="--c:${top.tint}">` +
      `<button type="button" class="mg-main" data-hide-group="${esc(g[0].model)}" aria-pressed="${st !== 'none'}" title="${st === 'all' ? 'Hide' : 'Show'} every effort level">` +
      `<span class="mg-box" aria-hidden="true"></span>${iconHTML(top)}<span class="mtxt"><b>${esc(g[0].model)}</b><small>${esc(top.lab)}</small></span>` +
      `<span class="mavg${top.complete ? '' : ' is-part'}">${top.complete ? top.avg.toFixed(2) : 'partial'}</span></button>` +
      `<div class="mg-eff">${g.map((d) => { const on = !state.hidden.has(d.id);
        return `<button type="button" class="ef${on ? ' on' : ''}" data-hide="${esc(d.id)}" data-row="${esc(d.id)}" aria-pressed="${on}" title="${esc(modelEffort(d))}${d.complete ? ` · ${d.avg.toFixed(2)}` : ' · partial run'}">${esc(d.effort || 'Default')}${d.complete ? `<i>${d.avg.toFixed(1)}</i>` : ''}</button>`; }).join('')}</div></div>`;
  }).join('') || '<div class="side-foot">No model matches that filter.</div>';
  $('#shown').textContent = `${DATA.length - viewHidden().size} / ${DATA.length} shown${state.openOnly ? ' · open' : ''}`;
}
function render() {
  // the RE view toggle applies to the explorer's RE section only; every other tab and view uses combined
  RE_VIEW = state.tab === 'explorer' && state.scope === 're' ? state.reView : 'combined';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const isProf = state.tab === 'profiles';
  const isSlim = state.tab === 'overview' || state.tab === 'ledger';
  const sideCtrl = state.tab === 'method'
    ? `<div class="modes" role="group" aria-label="Jump to section"><button type="button" data-msec="re" class="${state.methodSec !== 'visuals' ? 'on' : ''}">Reverse-Evaluation</button><button type="button" data-msec="visuals" class="${state.methodSec === 'visuals' ? 'on' : ''}">Visuals</button></div>`
    : `<button type="button" class="oswitch" role="switch" aria-checked="${state.openOnly}" data-open-only="${state.openOnly ? '0' : '1'}" title="Show only models whose weights are published"><span>Open weights only</span><span class="knob" aria-hidden="true"></span></button>`;
  $('#controls').className = `controls tb${isProf ? ' is-profiles' : ''}${isSlim ? ' is-slim' : ''}`;
  $('#controls').innerHTML = `<div class="tb-main${isProf ? ' is-profiles' : ''}">${controlsHTML()}</div><div class="tb-side">${sideCtrl}</div>` + subControlsHTML();
  const sc = $('#controls .scopes'), on = sc && sc.querySelector('button.on');   // on a phone the score row scrolls: keep the chosen one in view
  if (on && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = on.offsetLeft - (sc.clientWidth - on.offsetWidth) / 2;
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
  if (state.tab === 'method' && state.methodSec) {
    const target = $(`#method-${state.methodSec}`);
    if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    else $('#stage').scrollTop = 0;
  } else {
    $('#stage').scrollTop = 0;
  }
  applySpot();
  renderSidebar();
  writeHash();
  fillTiles();
}
/* Overview cards share a row height; reveal extra list rows one by one until the next one would make the card taller. */
function fillTiles() {
  document.querySelectorAll('#stage .tile').forEach((t) => {
    const ex = [...t.querySelectorAll('li[data-ex]')];
    ex.forEach((li) => li.classList.add('ex'));
    for (const li of ex) {
      const h = t.offsetHeight;
      li.classList.remove('ex');
      if (t.offsetHeight > h + 0.5 || t.scrollHeight > t.clientHeight + 1) { li.classList.add('ex'); break; }
    }
  });
}
let fillT = 0;
addEventListener('resize', () => { clearTimeout(fillT); fillT = setTimeout(fillTiles, 120); });
function readHash() {
  const [tab, a, b, c] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (TABS_KEYS.includes(tab) || EXTRA_KEYS.includes(tab)) state.tab = tab;
  if (tab === 'explorer') {
    if (SCOPES.some(([k]) => k === a)) state.scope = a;
    if (['score', 'p2p', 'size'].includes(b)) state.mode = b;
    if (a === 're') { state.reLook = c === 'board' ? 'board' : 'classic'; state.reView = RE_VIEWS.includes(c) ? c : 'combined'; }
  }
  if (tab === 'speed' && (a === 'min' || a === 'tps')) state.metric = a;
  if (tab === 'method') state.methodSec = (a === 're' || a === 'visuals') ? a : '';
}
function urlWithHash(h) {
  const qs = META.is_historical && META.standard ? `?v=${encodeURIComponent(META.standard)}` : '';
  return `${location.pathname}${qs}#${h}`;
}
function writeHash() {
  let h = state.tab;
  if (state.tab === 'explorer') {
    h += `/${state.scope}/${state.mode}`;
    if (state.scope === 're' && state.mode === 'score' && state.reLook === 'board' && activeReMode() === 'v152') h += '/board';
    else if (state.scope === 're' && state.reView !== 'combined' && activeReViews().includes(state.reView)) h += `/${state.reView}`;
  }
  if (state.tab === 'speed') h += `/${state.metric}`;
  if (state.tab === 'method' && state.methodSec) h += `/${state.methodSec}`;
  history.replaceState(null, '', urlWithHash(h));
}
function shortDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(s || '');
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${MON[Number(m[2]) - 1] || m[2]} ${Number(m[3])}`;
}
function updateMetaAndBanner() {
  const csvHref = (META.version_info && META.version_info.csv) || 'data/gamefeelbench.csv';
  $('#meta').innerHTML =
    `<a class="csv-btn" href="${esc(csvHref)}" download title="Download ${esc(META.standard || 'benchmark')} data as CSV"><svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v7.2M4 6.6 7 9.6l3-3M2.5 11.8h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>CSV</a>`;
  const vVal = $('#verVal');
  if (vVal && META.standard) {
    const isLat = !META.is_historical;
    vVal.innerHTML = isLat
      ? `${esc(META.standard)}<span class="ver-lat"> (latest)</span>`
      : esc(META.standard);
  }
  document.querySelectorAll('#verMenu .ver-opt').forEach((b) => {
    const on = b.dataset.ver === META.standard;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.body.classList.toggle('is-history', Boolean(META.is_historical));
  const ban = $('#verBanner');
  if (!ban) return;
  if (!META.is_historical || !META.version_info) {
    ban.hidden = true;
    ban.innerHTML = '';
    return;
  }
  const v = META.version_info;
  const fit = v.gci_fit || {};
  const scaleTxt = fit.ref === 'base'
    ? 'GCI base (1.00 × avg)'
    : `GCI scale: ${Number(fit.a).toFixed(3)} × avg ${fit.b >= 0 ? '+' : '−'} ${Math.abs(fit.b).toFixed(2)} (${fit.anchors} anchors, R² ${Number(fit.r2).toFixed(3)})`;
  const latest = (VERSIONS && VERSIONS.latest) || 'v1.5.3';
  ban.hidden = false;
  ban.innerHTML = `<span><b>Historical snapshot · ${esc(v.id)}</b> <span class="vb-meta">(${esc(v.date)} · ${v.entries} entries) — ${esc(v.summary)} ${esc(scaleTxt)}.</span></span>` +
    `<button type="button" data-switch-ver="${esc(latest)}">Back to ${esc(latest)} (latest)</button>`;
}
async function switchVersion(verId) {
  if (!VERSIONS || !VERSIONS.versions) return;
  const v = VERSIONS.versions.find((x) => x.id === verId);
  if (!v) return;
  let bundle = VERSION_CACHE.get(verId);
  if (!bundle) {
    const csvText = await fetchText(v.csv);
    const rows = parseRows(csvText, LABS_MAP);
    const baseGci = (LATEST_BUNDLE && LATEST_BUNDLE.meta && LATEST_BUNDLE.meta.gci) || {};
    const meta = {
      updated: v.date,
      entries: rows.length,
      standard: v.id,
      score_keys: v.score_keys,
      re_weight: v.re_weight,
      re_mode: v.re_mode,
      is_historical: !v.is_latest,
      version_info: v,
      gci: { ...baseGci, standard: v.id, a: v.gci_fit.a, b: v.gci_fit.b, r2: v.gci_fit.r2, anchors: v.gci_fit.anchors },
      re_combined: v.is_latest && LATEST_BUNDLE ? LATEST_BUNDLE.meta.re_combined : null,
    };
    bundle = { rows, meta };
    VERSION_CACHE.set(verId, bundle);
  }
  DATA = bundle.rows;
  META = bundle.meta;
  deriveFields();
  const validIds = new Set(DATA.map((d) => d.id));
  state.hidden = new Set([...state.hidden].filter((id) => validIds.has(id)));
  const keptProf = [...state.prof].filter((id) => validIds.has(id));
  state.prof = new Set(keptProf.length ? keptProf : TOP3());
  if (!activeReViews().includes(state.reView)) state.reView = 'combined';
  if (activeReMode() !== 'v152') state.reLook = 'classic';
  updateMetaAndBanner();
  render();
}
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

/* ---------- events ---------- */
const TAB_ICON = {
  overview: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="3" width="5.8" height="5.8" rx="1.4"/><rect x="11.2" y="3" width="5.8" height="5.8" rx="1.4"/><rect x="3" y="11.2" width="5.8" height="5.8" rx="1.4"/><rect x="11.2" y="11.2" width="5.8" height="5.8" rx="1.4"/></svg>',
  explorer: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 16v-4.5M10 16V5M15 16V9.5"/></svg>',
  profiles: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><polygon points="10,2.8 17,7.8 14.3,16.2 5.7,16.2 3,7.8"/></svg>',
  speed: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5 4.8 11h4.8l-.6 6.5L15.2 9h-4.8z"/></svg>',
  ledger: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13"/></svg>',
  method: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5h5a2 2 0 0 1 2 2v9.5a1.5 1.5 0 0 0-1.5-1.5h-5.5zM16.5 4.5h-5a2 2 0 0 0-2 2v9.5a1.5 1.5 0 0 1 1.5-1.5h5.5z"/></svg>',
};
const HEADER_TABS = ['overview', 'explorer', 'profiles', 'ledger'];   // Speed and Method are in the ☰ menu (keys 4 and 6 still work)
$('#tabs').innerHTML = TABS.map(([k, l], i) => (!HEADER_TABS.includes(k) ? '' : `<button type="button" data-tab="${k}"><span class="tab-ico" aria-hidden="true">${TAB_ICON[k] || ''}</span><span class="tab-lbl">${l}</span><kbd>${i + 1}</kbd></button>`)).join('');
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; render();
});
$('#controls').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const ds = b.dataset;
  if (ds.openMenu) { e.stopPropagation(); setMenu($('#menu').hidden); return; }
  if (ds.msec) { state.methodSec = ds.msec; render(); return; }
  if (ds.scope) state.scope = ds.scope;
  else if (ds.mode) state.mode = ds.mode;
  else if (ds.review) state.reView = ds.review;
  else if (ds.relook) state.reLook = ds.relook;
  else if (ds.pscope) state.pscope = ds.pscope;
  else if (ds.openOnly) { state.openOnly = ds.openOnly === '1'; try { localStorage.setItem('gfOpenOnly', ds.openOnly); } catch (err) { /* private mode */ } }
  else if (ds.metric) state.metric = ds.metric;
  else if (ds.prof) toggle(state.prof, ds.prof);
  else if (ds.act === 'top3') state.prof = new Set(TOP3());
  else return;
  render();
});
$('#stage').addEventListener('click', (e) => {
  const sv = e.target.closest('[data-switch-ver]');
  if (sv) { switchVersion(sv.dataset.switchVer); return; }
  const tile = e.target.closest('[data-open]');
  if (tile) {
    const go = () => { history.replaceState(null, '', urlWithHash(tile.dataset.open)); readHash(); render(); const f = $('#stage .fig'); if (f) f.style.viewTransitionName = 'hero'; };
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { go(); return; }
    tile.style.viewTransitionName = 'hero';
    document.startViewTransition(go).finished.finally(() => { const f = $('#stage .fig'); if (f) f.style.viewTransitionName = ''; });
    return;
  }
  const b = e.target.closest('[data-gsort],[data-hsort],[data-rsort],[data-rmode],[data-asort],[data-emetric],[data-gmetric]');
  if (b) {
    const flip = (cur, k, textFirst) => (cur.key === k ? { key: k, dir: -cur.dir } : { key: k, dir: textFirst ? 1 : -1 });
    const ds = b.dataset;
    if (ds.gsort) state.gsort = flip(state.gsort, ds.gsort, ds.gsort === 'model');
    else if (ds.hsort) state.hsort = flip(state.hsort, ds.hsort, ds.hsort === 'model');
    else if (ds.rsort) state.rsort = flip(state.rsort, ds.rsort, ds.rsort === 'model');
    else if (ds.rmode) state.rmode = ds.rmode;
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
$('#modelList').addEventListener('click', (e) => {
  const one = e.target.closest('[data-hide]');
  if (one) { toggle(state.hidden, one.dataset.hide); render(); return; }
  const grp = e.target.closest('[data-hide-group]'); if (!grp) return;
  const ids = DATA.filter((d) => d.model === grp.dataset.hideGroup).map((d) => d.id);
  if (ids.every((id) => !state.hidden.has(id))) ids.forEach((id) => state.hidden.add(id)); else ids.forEach((id) => state.hidden.delete(id));
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
$('#themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('gfTheme', next); } catch (err) { /* private mode */ }
  DATA.forEach((d) => { d.tint = themedTint(d.tint0 ?? d.tint); });
  render();
});
$('#gq').addEventListener('input', (e) => { state.q = e.target.value; e.target.closest('.gsearch').classList.toggle('has-q', !!state.q); render(); });
$('#labPills').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lab]'); if (!b) return;
  state.labFilter = b.dataset.lab;
  renderSidebar();
});
$('#showAll').addEventListener('click', () => {
  const list = sidebarFilteredList();
  if (list.length === DATA.length) state.hidden.clear();
  else list.forEach((d) => state.hidden.delete(d.id));
  render();
});
$('#hideAll').addEventListener('click', () => {
  const list = sidebarFilteredList();
  list.forEach((d) => state.hidden.add(d.id));
  render();
});
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
/* ☰ menu: the six main views on the left, the extra views on the right (one column on phones) */
const MENU_SUB = { overview: 'Top models, leaderboard, every view', explorer: 'Scores, price and size by category', profiles: 'Seven scores as one shape per model', speed: 'Tokens per second, minutes per task', ledger: 'Every column for every entry', method: 'How RE and Visuals are scored' };
const sv = (d) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const EXTRA_ICON = {
  glance: sv('<rect x="3" y="3" width="14" height="14" rx="2.5"/><path d="M3 8h14M3 12.5h14M8 3v14M12.5 3v14"/>'),
  rehelp: sv('<path d="M4 16V10M10 16V6M16 16V3"/><path d="M8 8l2-2 2 2"/>'),
  released: sv('<rect x="3" y="4" width="14" height="11" rx="2.5"/><path d="M3 8h14M7 15v2M13 15v2"/>'),
  effort: sv('<path d="M3.5 14a6.5 6.5 0 1 1 13 0"/><path d="M10 14l3.5-4"/>'),
  general: sv('<path d="M3 17h14M3 17V3"/><circle cx="7" cy="12" r="1.3"/><circle cx="11" cy="9" r="1.3"/><circle cx="15" cy="5.5" r="1.3"/>'),
  progress: sv('<path d="M3 15l4.5-4.5 3 3L17 6"/><path d="M13 6h4v4"/>'),
};
function renderMenu() {
  const item = (k, l, sub, ico, key) => `<button type="button" data-goto="${k}" class="${state.tab === k ? 'on' : ''}"><span class="mi">${ico || ''}</span><span class="mt"><b>${esc(l)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${key <= 9 ? `<kbd>${key}</kbd>` : ''}</button>`;
  $('#menu').innerHTML = `<div class="mcol"><div class="mhead">Views</div>${TABS.map(([k, l], i) => item(k, l, MENU_SUB[k], TAB_ICON[k], i + 1)).join('')}</div>` +
    `<div class="mcol"><div class="mhead">More views</div>${EXTRA.map(([k, l, sub], i) => item(k, l, sub, EXTRA_ICON[k], i + 7)).join('')}</div>`;
}
const setMenu = (open) => { $('#menu').hidden = !open; $('#menuBtn').setAttribute('aria-expanded', String(open)); if (open) setVerMenu(false); };
const setVerMenu = (open) => { const m = $('#verMenu'), b = $('#verBtn'); if (!m || !b) return; m.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (open) { $('#menu').hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); } };
$('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); setMenu($('#menu').hidden); });
$('#menu').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (!b) return; state.tab = b.dataset.goto; setMenu(false); render(); });
document.addEventListener('click', (e) => {
  if (!$('#menu').hidden && !e.target.closest('#menu')) setMenu(false);
  const vm = $('#verMenu');
  if (vm && !vm.hidden && !e.target.closest('#verDrop')) setVerMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setMenu(false); setVerMenu(false); return; }
  if (e.key === '/' && e.target.tagName !== 'INPUT' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); $('#gq').focus(); return; }
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
  const i = '123456789'.indexOf(e.key);   // 1-6 tabs, 7-9 the first three extra views (the rest via ☰)
  if (i >= 0) { state.tab = i < TABS_KEYS.length ? TABS_KEYS[i] : EXTRA_KEYS[i - TABS_KEYS.length]; render(); }
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
  { name: 'scores-re-released', build: () => reSingleFig('released') },
  { name: 'scores-re-combined', build: () => reSingleFig('combined') },
  { name: 'scores-re-blind-hard', build: () => reSingleFig('blind-hard') },
  { name: 'scores-re-blind-hard-human', build: () => reBlindHardHumanFig(NONE) },
  { name: 'scores-re-assisted-hard', build: () => reSingleFig('assisted-hard') },
  { name: 'scores-re-combined-hard', build: () => reSingleFig('combined-hard') },
  { name: 'scores-re-board', build: () => reBoardFig(NONE, true) },   // the opt-in board look, as an extra RE image
  { name: 'size-performance-overall', build: () => sizeFig('overall', NONE) },
  // the HTML views from the ☰ menu, all models, default sort
  { name: 'view-every-score-at-a-glance', build: () => ({ html: glanceHTML({ key: 'avg', dir: -1 }, NONE) }) },
  { name: 'view-re-blind-vs-assisted', build: () => ({ html: reHelpHTML({ key: 'gain', dir: -1 }, NONE) }) },
  { name: 'view-re-released-vs-unreleased', build: () => ({ html: releasedHTML({ key: 'gap', dir: -1 }, NONE) }) },
  { name: 'view-re-released-vs-unreleased-percent', build: () => ({ html: releasedHTML({ key: 'gap', dir: -1 }, NONE, 'pct') }) },
  { name: 'view-effort-overall', build: () => ({ html: effortHTML('avg', NONE) }) },
  { name: 'view-effort-re', build: () => ({ html: effortHTML('re', NONE) }) },
  { name: 'view-general-capability-overall', build: () => ({ html: generalHTML('avg', { key: 'gap', dir: -1 }, NONE) }) },
  { name: 'view-general-capability-re', build: () => ({ html: generalHTML('re', { key: 'gap', dir: -1 }, NONE) }) },
  { name: 'view-progress-gci', build: () => ({ html: progressHTML(NONE) }) },
];
window.renderExport = (name) => {
  const e = EXPORTS.find((x) => x.name === name);
  if (!e) throw new Error('unknown export ' + name);
  const keepData = DATA, keepMeta = META;
  if (LATEST_BUNDLE && META.is_historical) { DATA = LATEST_BUNDLE.rows; META = LATEST_BUNDLE.meta; deriveFields(); }
  RE_VIEW = 'combined';   // exports always use the combined RE score, whatever the explorer is showing
  const keepOpen = state.openOnly; state.openOnly = false;   // exports always show every model
  const f = e.build();
  state.openOnly = keepOpen;
  if (keepMeta.is_historical) { DATA = keepData; META = keepMeta; }
  if (f.html) {   // an HTML view: laid out at 1536 CSS px and zoomed 2x, so it is captured 6144 px wide like the rest
    $('#exportStage').style.width = '';
    $('#exportStage').innerHTML = `<div class="fig hexport">${f.html}</div>`;
    document.body.classList.add('exporting');
    return { W: 3072, H: Math.round($('#exportStage .fig').getBoundingClientRect().height) };
  }
  // a figure with exportScale k is laid out k times wider (the 2x2 RE export), so its parts keep full resolution
  const k = f.exportScale || 1;
  $('#exportStage').style.width = `${3072 * k}px`;
  $('#exportStage').innerHTML = `<div class="fig" style="width:${3072 * k}px"><svg viewBox="0 0 ${f.W} ${f.H}" xmlns="http://www.w3.org/2000/svg">${f.body}</svg></div>`;
  document.body.classList.add('exporting');
  return { W: f.W, H: f.H };
};

/* Start-up: load the data, then draw. window.EXPORTS is set only once the data is in, so the
   export script can wait for it. */
async function init() {
  try {
    ({ rows: DATA, icons: ICONS, labs: LABS_MAP, meta: META, versions: VERSIONS } = await loadData());
  } catch (err) {
    console.error(err);
    $('#stage').innerHTML = `<div class="fig"><p class="notice">The data could not be loaded (${esc(err.message)}). ` +
      'Open the page from its web address, not as a local file. The README explains how to preview it.</p></div>';
    return;
  }
  deriveFields();
  if (VERSIONS && VERSIONS.versions) {
    const latestInfo = VERSIONS.versions.find((x) => x.is_latest);
    META.is_historical = false;
    if (latestInfo) META.version_info = latestInfo;
    LATEST_BUNDLE = { rows: DATA, meta: META };
    VERSION_CACHE.set(META.standard, LATEST_BUNDLE);
    const vBtn = $('#verBtn'), vMenu = $('#verMenu');
    if (vBtn && vMenu) {
      const chk = '<svg class="vo-chk" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      vMenu.innerHTML = VERSIONS.versions.map((v) =>
        `<button type="button" class="ver-opt" role="option" data-ver="${esc(v.id)}" aria-selected="false">` +
        `<span class="vo-top"><span class="vo-id">${esc(v.id)}</span>${v.is_latest ? '<span class="vo-tag">Latest</span>' : ''}</span>` +
        `<span class="vo-sub">${esc(v.date)} · ${v.entries} entries</span>${chk}</button>`).join('');
      vBtn.addEventListener('click', (e) => { e.stopPropagation(); setVerMenu(vMenu.hidden); });
      vMenu.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-ver]'); if (!opt) return;
        setVerMenu(false);
        if (opt.dataset.ver !== META.standard) switchVersion(opt.dataset.ver);
      });
    }
    const ban = $('#verBanner');
    if (ban) ban.addEventListener('click', (e) => { const b = e.target.closest('[data-switch-ver]'); if (b) switchVersion(b.dataset.switchVer); });
  } else {
    const vd = $('#verDrop'); if (vd) vd.style.display = 'none';
  }
  state.prof = new Set(TOP3());
  updateMetaAndBanner();
  window.EXPORTS = EXPORTS.map((e) => e.name);
  window.LABEL_STATS = LABEL_STATS;
  readHash();
  const reqVer = new URLSearchParams(location.search).get('v');
  if (reqVer && VERSIONS && VERSIONS.versions && VERSIONS.versions.some((x) => x.id === reqVer) && reqVer !== META.standard) {
    await switchVersion(reqVer);
    return;
  }
  render();
}
init();
