// ── QL Tree Practice — ql-tree-practice.js ───────────────────────────────────
// Three-stage interactive practice:
//   Stage 1 (TREE):    Top-down parse-tree construction by clicking connective buttons
//   Stage 2 (VARS):    For each variable occurrence in the formula, mark free or bound
//   Stage 3 (OC):      Answer whether the formula is open or closed
//
// Depends on: parser.js (parse, prettyPrint, freeVars, termStr)
//             tree.js   (renderTree — used for the solution panel)
'use strict';

// ── Stage constants ───────────────────────────────────────────────────────────
const STAGE_IDLE  = 'idle';
const STAGE_TREE  = 'tree';
const STAGE_VARS  = 'vars';
const STAGE_OC    = 'oc';
const STAGE_DONE  = 'done';

// ── Node states (tree stage) ──────────────────────────────────────────────────
const ST_PENDING = 'pending';
const ST_ACTIVE  = 'active';
const ST_DONE_N  = 'done';
const ST_ERROR   = 'error';

// ── Module state ─────────────────────────────────────────────────────────────
let _stage     = STAGE_IDLE;
let _ast       = null;      // current AST root
let _activeNode = null;     // currently highlighted node (tree stage)
let _varOccurrences = [];   // [{varName, path, correctAnswer, studentAnswer}] (vars stage)
let _ocAnswer  = null;      // 'open'|'closed' student answer
let _ocCorrect = null;      // boolean

// ── Public API ────────────────────────────────────────────────────────────────
function startPracticeQL(ast) {
  _ast   = ast;
  _stage = STAGE_TREE;
  _activeNode = null;
  _varOccurrences = [];
  _ocAnswer = null;
  _ocCorrect = null;

  // Reset all node states
  flattenBFS(ast).forEach(n => { n._ptState = ST_PENDING; });
  ast._ptState = ST_ACTIVE;
  _activeNode = ast;

  ptRenderQL();
  ptUpdateToolbarQL();
  ptSetStatusQL('Click the connective buttons to identify the main connective of the highlighted node.');
  ptHideCompletion();
  ptHideVarQuiz();
  ptHideOCQuiz();

  const panel = document.getElementById('ql-panel-build');
  if (panel) panel.scrollTop = 0;
}

function practiceAnswerQL(conn) {
  if (_stage !== STAGE_TREE || !_activeNode) return;

  const correct = mainConnectiveQL(_activeNode);
  if (conn !== correct) {
    // Wrong — shake the SVG
    const svg = document.getElementById('ql-practice-svg');
    if (svg) {
      svg.classList.remove('pt-shake');
      void svg.offsetWidth;
      svg.classList.add('pt-shake');
      svg.addEventListener('animationend', () => svg.classList.remove('pt-shake'), { once: true });
    }
    ptSetStatusQL('Not quite — try again.');
    return;
  }

  // Correct — mark node done, find next
  _activeNode._ptState = ST_DONE_N;
  ptMarkRevealed(_activeNode);

  const next = flattenBFS(_ast).find(n => n._ptState === ST_ACTIVE);
  _activeNode = next || null;

  ptRenderQL();
  ptUpdateToolbarQL();

  if (!_activeNode) {
    // Tree stage complete — move to var quiz
    ptSetStatusQL('Tree complete! Now identify free and bound variable occurrences below.');
    ptShowTreeComplete();
    _stage = STAGE_VARS;
    buildVarQuiz();
  } else {
    ptSetStatusQL('Good! Now identify the main connective of the highlighted node.');
  }
}

function resetPracticeQL() {
  if (!_ast) return;
  startPracticeQL(_ast);
}

// ── Stage helpers ─────────────────────────────────────────────────────────────

// Returns the main connective string for a node, used to check button clicks.
// Returns one of: '∀' '∃' '¬' '∧' '∨' '→' 'atom'
function mainConnectiveQL(node) {
  switch (node.type) {
    case 'all':  return '∀';
    case 'ex':   return '∃';
    case 'neg':  return '¬';
    case 'and':  return '∧';
    case 'or':   return '∨';
    case 'imp':  return '→';
    case 'pred': return 'atom';
    case 'eq':   return 'atom';
    default:     return 'atom';
  }
}

// BFS traversal — returns all nodes in breadth-first order
function flattenBFS(root) {
  if (!root) return [];
  const result = [];
  const q = [root];
  while (q.length) {
    const n = q.shift();
    result.push(n);
    childrenQL(n).forEach(c => q.push(c));
  }
  return result;
}

function childrenQL(node) {
  switch (node.type) {
    case 'neg':  return [node.arg];
    case 'and': case 'or': case 'imp': return [node.left, node.right];
    case 'all': case 'ex': return [node.body];
    default: return [];
  }
}

// After marking a node done, reveal its children as ACTIVE
function ptMarkRevealed(node) {
  childrenQL(node).forEach(c => {
    if (c._ptState === ST_PENDING) c._ptState = ST_ACTIVE;
  });
}

// ── SVG helpers (DOM-based so CSS vars resolve) ───────────────────────────────
function qlSvgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// Colour constants — CSS vars; resolved at paint time because we set them
// as attribute values on DOM elements created via createElementNS.
const QL_COLOR_PENDING  = 'var(--color-border)';
const QL_COLOR_ACTIVE   = 'var(--color-practice-active, #1565c0)';
const QL_COLOR_DONE     = 'var(--color-primary, #7a1a3a)';
const QL_COLOR_ACTIVE_BG = 'var(--color-practice-active-bg, #e8f0fe)';
const QL_COLOR_SURFACE  = 'var(--color-surface)';
const QL_COLOR_TEXT_MUTED = 'var(--color-text-muted)';
const QL_COLOR_TEXT     = 'var(--color-text)';
const QL_COLOR_BORDER   = 'var(--color-border)';

// ── SVG rendering (tree stage) ────────────────────────────────────────────────
// Renders the FULL tree into #ql-practice-svg — all nodes are shown from the
// start (pending nodes appear muted) so students can see the whole formula
// structure as they work top-down.
function ptRenderQL() {
  const svgEl = document.getElementById('ql-practice-svg');
  if (!svgEl || !_ast) return;

  // Measure label widths using a temporary canvas.
  // Use the same monospace font + size as the View tree (tree.js: FONT_SZ=15, --font-mono).
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 15;
  const fontFace = 'Consolas, "Liberation Mono", Menlo, Courier, monospace';
  ctx.font = `${fontSize}px ${fontFace}`;

  const PAD_H = 16, PAD_V = 10, LEVEL_H = 52, H_GAP = 16, MIN_W = 36;
  const BOX_H = PAD_V * 2 + fontSize;
  // Top margin must be at least BOX_H/2 so the root rect isn't clipped.
  const MARGIN = Math.ceil(BOX_H / 2) + 4;

  // Layout: ALL nodes (including pending)
  const positions = new Map();

  function nodeLabel(n) {
    return prettyPrint(n, n === _ast);
  }

  function nodeW(n) {
    return Math.max(MIN_W, Math.ceil(ctx.measureText(nodeLabel(n)).width) + PAD_H * 2);
  }

  function subtreeW(n) {
    const ch = childrenQL(n);
    if (ch.length === 0) return nodeW(n);
    const childTotal = ch.reduce((s, c) => s + subtreeW(c), 0) + (ch.length - 1) * H_GAP;
    return Math.max(nodeW(n), childTotal);
  }

  function layoutNode(n, xCenter, depth) {
    positions.set(n, { x: xCenter, y: depth * LEVEL_H + MARGIN, w: nodeW(n) });
    const ch = childrenQL(n);
    if (!ch.length) return;
    const totalW = ch.reduce((s, c) => s + subtreeW(c), 0) + (ch.length - 1) * H_GAP;
    let cursor = xCenter - totalW / 2;
    ch.forEach(c => {
      const sw = subtreeW(c);
      layoutNode(c, cursor + sw / 2, depth + 1);
      cursor += sw + H_GAP;
    });
  }

  const rootSW = subtreeW(_ast);
  const svgW = Math.max(rootSW + MARGIN * 2, 120);
  layoutNode(_ast, svgW / 2, 0);

  const maxY = Math.max(...[...positions.values()].map(p => p.y));
  const svgH = maxY + BOX_H + MARGIN + 16;

  svgEl.setAttribute('width',  svgW);
  svgEl.setAttribute('height', svgH);
  svgEl.innerHTML = '';

  const edgeG = qlSvgEl('g', {});
  const nodeG = qlSvgEl('g', {});
  svgEl.appendChild(edgeG);
  svgEl.appendChild(nodeG);

  positions.forEach((pos, n) => {
    const state = n._ptState;
    const isActive  = state === ST_ACTIVE;
    const isDone    = state === ST_DONE_N;
    const isPending = state === ST_PENDING;

    // Edges to children
    childrenQL(n).forEach(child => {
      const cp = positions.get(child);
      if (!cp) return;
      edgeG.appendChild(qlSvgEl('line', {
        x1: pos.x,           y1: pos.y + BOX_H / 2,
        x2: cp.x,            y2: cp.y - BOX_H / 2,
        stroke: QL_COLOR_BORDER,
        'stroke-width': '1.5',
        'stroke-dasharray': isPending ? '4 3' : 'none',
        opacity: isPending ? '0.4' : '1',
      }));
    });

    // Node box
    const x = pos.x - pos.w / 2;
    const y = pos.y - BOX_H / 2;
    const strokeColor = isActive ? QL_COLOR_ACTIVE : isDone ? QL_COLOR_DONE : QL_COLOR_PENDING;
    const fillColor   = isActive ? QL_COLOR_ACTIVE_BG : QL_COLOR_SURFACE;
    const textColor   = isActive ? QL_COLOR_ACTIVE : isDone ? QL_COLOR_DONE : QL_COLOR_TEXT_MUTED;
    const strokeW     = isActive ? '2.5' : '1.5';

    const g = qlSvgEl('g', { class: `pt-node pt-node-${state}` });
    g.appendChild(qlSvgEl('rect', {
      x, y, width: pos.w, height: BOX_H, rx: 4, ry: 4,
      fill: fillColor, stroke: strokeColor, 'stroke-width': strokeW,
      opacity: isPending ? '0.55' : '1',
    }));
    g.appendChild(qlSvgEl('text', {
      x: pos.x, y: pos.y + fontSize * 0.38,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-family': 'var(--font-mono)',
      'font-size': fontSize,
      fill: textColor,
    }, nodeLabel(n)));
    nodeG.appendChild(g);
  });
}

// ── Toolbar state ─────────────────────────────────────────────────────────────
function ptUpdateToolbarQL() {
  const buttons = document.querySelectorAll('#ql-pt-toolbar .pt-conn-btn');
  const done = (_stage !== STAGE_TREE || !_activeNode);
  buttons.forEach(b => { b.disabled = done; });
}

function ptSetStatusQL(msg, cls) {
  const el = document.getElementById('ql-practice-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'practice-status' + (cls ? ' ' + cls : '');
}

function ptShowTreeComplete() {
  // Nothing extra — stage message suffices; var quiz appears below
}

function ptHideCompletion() {
  const b = document.getElementById('ql-practice-complete-banner');
  if (b) b.hidden = true;
  const r = document.getElementById('ql-practice-solution-row');
  if (r) r.hidden = true;
}

function ptHideVarQuiz() {
  const p = document.getElementById('ql-var-quiz-panel');
  if (p) p.hidden = true;
}

function ptHideOCQuiz() {
  const p = document.getElementById('ql-oc-quiz-panel');
  if (p) p.hidden = true;
}

// ── Variable quiz (Stage 2) ───────────────────────────────────────────────────
//
// We tokenise the formula's prettyPrint string and for every variable token
// that is NOT the binding variable in a quantifier (i.e. not immediately after
// ∀/∃), we create a clickable chip.  The correct answer for each comes from
// the freeVars() set computed over the full AST.

function buildVarQuiz() {
  if (!_ast) return;

  // Collect the set of free variable names (strings like "x", "y1")
  const freeSet = freeVars(_ast); // Set<string>

  // Tokenise the pretty-printed formula into segments:
  //   { kind: 'text'|'var', text, occIdx, isBinding, correctAnswer }
  const formulaStr = prettyPrint(_ast, true);
  const tokens = tokeniseFormula(formulaStr, freeSet);

  // Build occurrence records for those that need an answer (non-binding vars)
  _varOccurrences = tokens
    .filter(t => t.kind === 'var' && !t.isBinding)
    .map((t, i) => ({
      idx: i,
      varName: t.text,
      correctAnswer: t.correctAnswer,  // 'free' | 'bound'
      studentAnswer: null,             // null | 'free' | 'bound'
    }));

  if (_varOccurrences.length === 0) {
    // No variable occurrences to quiz — skip to OC stage
    _stage = STAGE_OC;
    buildOCQuiz();
    return;
  }

  // Render the quiz panel
  const panel = document.getElementById('ql-var-quiz-panel');
  if (!panel) return;

  panel.hidden = false;  // ensure visible before scroll
  setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

  const formulaDiv = document.getElementById('ql-var-quiz-formula');
  if (formulaDiv) {
    formulaDiv.innerHTML = '';
    let occIdx = 0;
    tokens.forEach(t => {
      if (t.kind === 'text') {
        const span = document.createElement('span');
        span.className = 'var-quiz-token';
        span.textContent = t.text;
        formulaDiv.appendChild(span);
      } else if (t.isBinding) {
        // Binding occurrence — show as plain text (not clickable)
        const span = document.createElement('span');
        span.className = 'var-quiz-token';
        span.textContent = t.text;
        formulaDiv.appendChild(span);
      } else {
        // Clickable variable occurrence
        const btn = document.createElement('button');
        btn.className = 'var-quiz-var';
        btn.dataset.occIdx = occIdx;
        btn.title = 'Click to mark as free or bound';
        // Variable name span
        const varSpan = document.createElement('span');
        varSpan.className = 'vq-name';
        varSpan.textContent = t.text;
        btn.appendChild(varSpan);
        // Badge span (shows ?, free, or bound)
        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'vq-badge';
        badgeSpan.textContent = '?';
        btn.appendChild(badgeSpan);
        const _idx = occIdx;
        btn.addEventListener('click', () => varQuizToggle(_idx));
        formulaDiv.appendChild(btn);
        occIdx++;
      }
    });
  }

  // Reset feedback
  const fb = document.getElementById('ql-var-quiz-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'var-quiz-feedback'; }

  // Enable check button
  const checkBtn = document.getElementById('ql-var-quiz-check');
  if (checkBtn) checkBtn.disabled = false;

  panel.hidden = false;
}

// Toggle a variable chip: null → 'free' → 'bound' → null
function varQuizToggle(occIdx) {
  if (_stage !== STAGE_VARS) return;
  const occ = _varOccurrences[occIdx];
  if (!occ) return;

  const cycle = { null: 'free', free: 'bound', bound: null };
  occ.studentAnswer = cycle[occ.studentAnswer] ?? null;

  // Update chip appearance
  const btn = document.querySelector(`.var-quiz-var[data-occ-idx="${occIdx}"]`);
  if (btn) {
    btn.dataset.answer = occ.studentAnswer || '';
    btn.classList.remove('correct', 'incorrect');
    const badge = btn.querySelector('.vq-badge');
    if (badge) badge.textContent = occ.studentAnswer || '?';
  }

  // Clear feedback when student changes an answer
  const fb = document.getElementById('ql-var-quiz-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'var-quiz-feedback'; }
}

function varQuizCheck() {
  if (_stage !== STAGE_VARS) return;

  // Check all occurrences are answered
  const unanswered = _varOccurrences.filter(o => o.studentAnswer === null);
  if (unanswered.length > 0) {
    const fb = document.getElementById('ql-var-quiz-feedback');
    if (fb) { fb.textContent = 'Please classify all variable occurrences first.'; fb.className = 'var-quiz-feedback err'; }
    return;
  }

  // Compare
  let allCorrect = true;
  _varOccurrences.forEach(occ => {
    const btn = document.querySelector(`.var-quiz-var[data-occ-idx="${occ.idx}"]`);
    if (occ.studentAnswer === occ.correctAnswer) {
      if (btn) btn.classList.add('correct');
    } else {
      if (btn) btn.classList.add('incorrect');
      allCorrect = false;
    }
  });

  const fb = document.getElementById('ql-var-quiz-feedback');
  if (allCorrect) {
    if (fb) { fb.textContent = '✓ Correct!'; fb.className = 'var-quiz-feedback ok'; }
    // Disable further changes
    const checkBtn = document.getElementById('ql-var-quiz-check');
    if (checkBtn) checkBtn.disabled = true;
    document.querySelectorAll('.var-quiz-var').forEach(b => { b.style.pointerEvents = 'none'; });
    // Move to OC stage after brief pause
    setTimeout(() => {
      _stage = STAGE_OC;
      buildOCQuiz();
    }, 800);
  } else {
    if (fb) { fb.textContent = 'Some occurrences are wrong — the incorrect ones are highlighted. Try again.'; fb.className = 'var-quiz-feedback err'; }
    // Clear incorrect chips so student can retry
    setTimeout(() => {
      _varOccurrences.forEach(occ => {
        const btn = document.querySelector(`.var-quiz-var[data-occ-idx="${occ.idx}"]`);
        if (btn && btn.classList.contains('incorrect')) {
          occ.studentAnswer = null;
          btn.dataset.answer = '';
          btn.classList.remove('incorrect');
          const badge = btn.querySelector('.vq-badge');
          if (badge) badge.textContent = '?';
        }
      });
    }, 1200);
  }
}

// ── Tokenise formula string for variable quiz ─────────────────────────────────
// Walks the pretty-printed formula string and tags each character sequence.
// A "binding" occurrence is the variable immediately after ∀ or ∃.
// All other variable tokens are quizzable.
function tokeniseFormula(str, freeSet) {
  const tokens = [];
  let i = 0;

  // Helper: read a variable token starting at i (letter + optional digits)
  function readVarOrConst(start) {
    // Variables: x y z; Constants: a b c d e
    // Subscripts: digits following the letter
    let j = start + 1;
    while (j < str.length && /\d/.test(str[j])) j++;
    return str.slice(start, j);
  }

  // We need to know which occurrences are binding.
  // Simple approach: track whether we just saw ∀ or ∃.
  let prevWasQuantifier = false;

  while (i < str.length) {
    const ch = str[i];

    // Quantifier — emit as text, set flag
    if (ch === '∀' || ch === '∃') {
      tokens.push({ kind: 'text', text: ch });
      prevWasQuantifier = true;
      i++;
      continue;
    }

    // Variable letter (x, y, z)
    if (/[xyz]/.test(ch)) {
      const text = readVarOrConst(i);
      const isBinding = prevWasQuantifier;
      const correctAnswer = freeSet.has(text) ? 'free' : 'bound';
      tokens.push({ kind: 'var', text, isBinding, correctAnswer });
      prevWasQuantifier = false;
      i += text.length;
      continue;
    }

    // Anything else (including constants a-e, predicates P-T, connectives, parens, spaces)
    // Accumulate into a text run
    let textRun = ch;
    i++;
    while (i < str.length && !/[xyz∀∃]/.test(str[i])) {
      textRun += str[i];
      i++;
    }
    tokens.push({ kind: 'text', text: textRun });
    prevWasQuantifier = false;
    // Correction: if textRun ends with a quantifier character we already advanced past it,
    // but the while condition prevents that. Safe.
    continue;
  }

  return tokens;
}

// ── Open/closed quiz (Stage 3) ────────────────────────────────────────────────
function buildOCQuiz() {
  const panel = document.getElementById('ql-oc-quiz-panel');
  if (!panel) return;

  // Reset button states
  ['ql-oc-btn-open','ql-oc-btn-closed'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.className = 'oc-btn'; b.disabled = false; }
  });
  const fb = document.getElementById('ql-oc-quiz-feedback');
  if (fb) { fb.textContent = ''; fb.className = 'oc-quiz-feedback'; }

  panel.hidden = false;
}

function ocQuizAnswer(answer) {
  if (_stage !== STAGE_OC) return;
  _ocAnswer = answer;

  const freeSet = freeVars(_ast);
  const isOpen  = freeSet.size > 0;
  _ocCorrect = (answer === 'open') === isOpen;

  const openBtn   = document.getElementById('ql-oc-btn-open');
  const closedBtn = document.getElementById('ql-oc-btn-closed');
  const fb        = document.getElementById('ql-oc-quiz-feedback');

  // Disable both buttons
  if (openBtn)   openBtn.disabled   = true;
  if (closedBtn) closedBtn.disabled = true;

  const chosen = answer === 'open' ? openBtn : closedBtn;
  if (_ocCorrect) {
    if (chosen) chosen.className = 'oc-btn selected-correct';
    if (fb) { fb.textContent = '✓ Correct!'; fb.className = 'oc-quiz-feedback ok'; }
    setTimeout(() => finishPracticeQL(), 700);
  } else {
    if (chosen) chosen.className = 'oc-btn selected-wrong';
    // Show the correct answer
    const correctBtn = answer === 'open' ? closedBtn : openBtn;
    if (correctBtn) correctBtn.className = 'oc-btn selected-correct';
    const reason = isOpen
      ? `This formula is open — it has free variable${freeSet.size > 1 ? 's' : ''}: ${[...freeSet].sort().join(', ')}.`
      : 'This formula is closed — it has no free variables.';
    if (fb) { fb.textContent = '✗ ' + reason; fb.className = 'oc-quiz-feedback err'; }
    setTimeout(() => finishPracticeQL(), 1500);
  }
}

// ── Completion ────────────────────────────────────────────────────────────────
function finishPracticeQL() {
  _stage = STAGE_DONE;
  ptSetStatusQL('');

  const banner = document.getElementById('ql-practice-complete-banner');
  if (banner) banner.hidden = false;

  const solRow = document.getElementById('ql-practice-solution-row');
  if (solRow) solRow.hidden = false;
}

function togglePracticeSolutionQL() {
  const panel = document.getElementById('ql-practice-solution-panel');
  const btn   = document.getElementById('ql-practice-solution-btn');
  if (!panel || !btn) return;

  const showing = !panel.hidden;
  panel.hidden = showing;
  btn.textContent = showing ? 'Show solution' : 'Hide solution';

  if (!showing && _ast) {
    // Render the full reference tree into the solution panel
    const solSvg = document.getElementById('ql-solution-svg');
    if (solSvg) {
      // Swap IDs temporarily so renderTree writes to the solution container
      const treeSvg = document.getElementById('tree-svg');
      if (treeSvg) treeSvg.id = '__tree-svg-hidden';
      solSvg.id = 'tree-svg';
      renderTree(_ast);
      solSvg.id = 'ql-solution-svg';
      if (treeSvg) treeSvg.id = 'tree-svg';
    }
  }
}
