// ── QL Formula Checker — app.js ─────────────────────────────────────────────

// ── Theme toggle ──────────────────────────────────────────────────────────────
(function () {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  const btn = document.querySelector('[data-theme-toggle]');
  if (btn) btn.addEventListener('click', () => {
    root.setAttribute('data-theme',
      root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
})();

// ── Help panel ────────────────────────────────────────────────────────────────
function toggleHelp(e) {
  if (e) e.preventDefault();
  const panel = document.getElementById('help-panel');
  if (panel) panel.hidden = !panel.hidden;
}

// ── Symbol buttons ────────────────────────────────────────────────────────────
const input = document.getElementById('formula-input');

document.getElementById('symbol-bar').addEventListener('click', e => {
  const btn = e.target.closest('[data-insert]');
  if (!btn || !input) return;
  const sym = btn.dataset.insert;
  const start = input.selectionStart;
  const end   = input.selectionEnd;
  const val   = input.value;
  input.value = val.slice(0, start) + sym + val.slice(end);
  const pos = start + sym.length;
  input.setSelectionRange(pos, pos);
  input.focus();
  onFormulaChange();
});

// ── ASCII shortcuts ───────────────────────────────────────────────────────────
// Applied on every keystroke, replacing ASCII sequences with Unicode symbols.
// QL-specific: A followed by a variable or digit → ∀; E followed by same → ∃
const ASCII_MAP = [
  // Order matters: longer sequences first
  [/->|=>/g,  '→'],
  [/\/\\/g,   '∧'],
  [/\\\//g,   '∨'],
  [/[~\-](?=[^>]|$)/g, '¬'],  // ~ or - not followed by >
  [/&/g,      '∧'],
  [/\|/g,     '∨'],
];

// A/E quantifier shortcuts handled specially — only replace when followed by
// a variable letter (x y z) to avoid clobbering predicate letters etc.
function applyAscii(val) {
  let s = val;
  for (const [pat, rep] of ASCII_MAP) s = s.replace(pat, rep);
  // A followed by a variable or digit → ∀
  s = s.replace(/A(?=[xyz\d])/g, '∀');
  // E followed by a variable or digit → ∃
  s = s.replace(/E(?=[xyz\d])/g, '∃');
  return s;
}

input.addEventListener('keyup', () => {
  const orig  = input.value;
  const start = input.selectionStart;
  const converted = applyAscii(orig);
  if (converted !== orig) {
    const delta = converted.length - orig.length;
    input.value = converted;
    input.setSelectionRange(start + delta, start + delta);
  }
  onFormulaChange();
});

input.addEventListener('input', onFormulaChange);

// ── Examples ──────────────────────────────────────────────────────────────────
document.getElementById('examples-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-formula]');
  if (!chip) return;
  input.value = chip.dataset.formula;
  input.focus();
  onFormulaChange();
  pushHash();
});

// ── URL hash encode/decode ────────────────────────────────────────────────────
// Format: #v1:<base64(JSON)>   where JSON = { f: "<formula>" }
function pushHash() {
  const f = input.value;
  if (!f.trim()) { history.replaceState(null, '', location.pathname); return; }
  try {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ f }))));
    history.replaceState(null, '', '#v1:' + payload);
  } catch (_) {}
}

function loadHash() {
  const hash = location.hash;
  if (!hash.startsWith('#v1:')) return;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(hash.slice(4)))));
    if (payload.f) {
      input.value = payload.f;
      onFormulaChange();
    }
  } catch (_) {}
}

// ── Status display ────────────────────────────────────────────────────────────
const statusEl = document.getElementById('parse-status');

function setStatus(result) {
  statusEl.className = 'parse-status';
  if (!result || result.status === 'empty') {
    statusEl.textContent = '';
    return;
  }
  if (result.status === 'official') {
    statusEl.classList.add('ok');
    statusEl.textContent = '✓ ' + result.pretty;
  } else if (result.status === 'unofficial') {
    statusEl.classList.add('unofficial');
    statusEl.textContent = '✓ Unofficial formula — abbreviates ' + result.officialForm;
  } else {
    statusEl.classList.add('err');
    statusEl.textContent = '✗ Not a formula';
  }
}

// ── Free variable panel ───────────────────────────────────────────────────────
const varsCard    = document.getElementById('vars-card');
const varsSubtitle = document.getElementById('vars-subtitle');
const varsBody    = document.getElementById('vars-body');

function updateVarsPanel(result) {
  if (!result || result.status === 'empty' || result.status === 'error') {
    varsCard.hidden = true;
    return;
  }

  const free   = result.freeVars || [];
  const preds  = result.predicates || {};

  // Build content
  const parts = [];

  if (free.length > 0) {
    parts.push(
      '<div class="vars-row"><span class="vars-label">Free variables:</span> ' +
      free.map(v => `<span class="var-chip">${v}</span>`).join(' ') +
      '</div>'
    );
  }

  const predEntries = Object.entries(preds);
  if (predEntries.length > 0) {
    const predStrs = predEntries.map(([name, arity]) =>
      `<span class="var-chip">${name}</span> <span class="arity-label">(${arity}-place)</span>`
    );
    parts.push(
      '<div class="vars-row"><span class="vars-label">Predicates:</span> ' +
      predStrs.join(' &ensp; ') +
      '</div>'
    );
  }

  if (parts.length === 0) {
    // All variables bound, no free vars
    parts.push('<div class="vars-row"><span class="vars-label">Free variables:</span> <em>none</em></div>');
  }

  varsBody.innerHTML = parts.join('');
  varsCard.hidden = false;

  // Subtitle: free / bound summary
  if (free.length === 0) {
    varsSubtitle.textContent = 'No free variables';
  } else {
    varsSubtitle.textContent = `Free: ${free.join(', ')}`;
  }
}

// ── Tree tab switching ────────────────────────────────────────────────────────
var _activeTabQL = 'build';
var _currentAstQL = null;

function switchTreeTabQL(tab) {
  _activeTabQL = tab;
  const panelView  = document.getElementById('ql-panel-view');
  const panelBuild = document.getElementById('ql-panel-build');
  const tabView    = document.getElementById('ql-tab-view');
  const tabBuild   = document.getElementById('ql-tab-build');
  if (tab === 'view') {
    if (panelView)  panelView.hidden  = false;
    if (panelBuild) panelBuild.hidden = true;
    if (tabView)  { tabView.className  = 'tree-tab tree-tab-active'; tabView.setAttribute('aria-selected','true'); }
    if (tabBuild) { tabBuild.className = 'tree-tab'; tabBuild.setAttribute('aria-selected','false'); }
  } else {
    if (panelView)  panelView.hidden  = true;
    if (panelBuild) panelBuild.hidden = false;
    if (tabView)  { tabView.className  = 'tree-tab'; tabView.setAttribute('aria-selected','false'); }
    if (tabBuild) { tabBuild.className = 'tree-tab tree-tab-active'; tabBuild.setAttribute('aria-selected','true'); }
    if (_currentAstQL) startPracticeQL(_currentAstQL);
  }
}

// ── Main update ───────────────────────────────────────────────────────────────
var _lastVal = null;
function onFormulaChange() {
  const raw = input.value;
  if (raw === _lastVal) return;
  _lastVal = raw;

  pushHash();

  // Show/hide the New Problem button
  const npBtn = document.getElementById('new-problem-btn');
  if (npBtn) npBtn.hidden = !raw.trim();

  if (!raw.trim()) {
    _currentAstQL = null;
    setStatus(null);
    renderTree(null);
    updateVarsPanel(null);
    return;
  }

  const result = evaluate(raw);
  setStatus(result);
  const ast = (result && result.status !== 'error') ? result.ast : null;
  _currentAstQL = ast;
  renderTree(ast);
  updateVarsPanel(result);
  if (_activeTabQL === 'build' && ast) startPracticeQL(ast);
}

// ── Copy link ─────────────────────────────────────────────────────────────────
const copyLinkBtn = document.getElementById('copy-link-btn');

function flashCopy(msg) {
  if (!copyLinkBtn) return;
  const textEl = copyLinkBtn.querySelector('.copy-link-text');
  const original = textEl ? textEl.textContent : 'Copy link';
  if (textEl) textEl.textContent = msg;
  copyLinkBtn.classList.add('shared');
  setTimeout(() => {
    if (textEl) textEl.textContent = original;
    copyLinkBtn.classList.remove('shared');
  }, 1800);
}

function copyLink() {
  const url = location.href;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(
      () => flashCopy('Copied!'),
      () => flashCopy('Link ready')
    );
  } else {
    flashCopy('Link ready');
  }
}

if (copyLinkBtn) copyLinkBtn.addEventListener('click', copyLink);

// ── New Problem ──────────────────────────────────────────────────────────────
function newProblemQL() {
  // Clear input
  input.value = '';
  _lastVal = '';
  _currentAstQL = null;
  history.replaceState(null, '', location.pathname);

  // Reset all display state
  setStatus(null);
  renderTree(null);
  updateVarsPanel(null);

  // Reset practice panels
  clearPracticeUIQL();

  // Hide the button itself
  const npBtn = document.getElementById('new-problem-btn');
  if (npBtn) npBtn.hidden = true;

  // Scroll to top of page and focus the input
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => input.focus(), 300);
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadHash();
if (!input.value) onFormulaChange();
if (_currentAstQL) startPracticeQL(_currentAstQL);
