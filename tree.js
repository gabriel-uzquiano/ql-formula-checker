/**
 * Parse tree renderer for the QL formula checker.
 *
 * Each node shows its complete subformula label (not just the connective).
 * Box widths are measured via canvas to fit the label exactly.
 *
 * Colour scheme:
 *   Quantifier nodes  : border + text coloured by binder colour (unique per quantifier)
 *   Atomic nodes      : teal border; variable occurrences underlined and coloured by
 *                       binder colour (bound) or gold (free); predicate/constant in teal
 *   All other nodes   : maroon (--color-primary)
 *
 * Hover interaction (when showFB = true):
 *   Hovering a quantifier → dims all other nodes; highlights that quantifier
 *   and all atomics containing variables it binds.
 *   Hovering an atomic → highlights its binder quantifiers.
 */

'use strict';

// ── Geometry constants ────────────────────────────────────────────────────────
const PAD_X   = 16;
const PAD_Y   = 10;
const FONT_SZ = 15;
const V_GAP   = 52;
const H_GAP   = 18;

// Binder colours — one per quantifier depth, cycling if needed
const BINDER_COLORS = [
  '#7a1a3a',   // maroon  (primary)
  '#6a0dad',   // purple
  '#1565c0',   // blue
  '#2e7d32',   // green
  '#e65100',   // orange
];

// ── Children helper (my parser's AST types) ──────────────────────────────────
function treeChildren(node) {
  switch (node.type) {
    case 'pred': case 'eq':          return [];
    case 'neg':                      return [node.arg];
    case 'all': case 'ex':           return [node.body];
    case 'and': case 'or': case 'imp': return [node.left, node.right];
    default:                         return [];
  }
}

// ── isAtomic / isQuant helpers ────────────────────────────────────────────────
const isAtomic = n => n.type === 'pred' || n.type === 'eq';
const isQuant  = n => n.type === 'all'  || n.type === 'ex';

// ── Assign binder colours to quantifier nodes ─────────────────────────────────
function assignBinderColors(root) {
  let idx = 0;
  function walk(node) {
    if (isQuant(node)) {
      node._bindColor = BINDER_COLORS[idx % BINDER_COLORS.length];
      idx++;
      walk(node.body);
    } else {
      treeChildren(node).forEach(walk);
    }
  }
  walk(root);
}

// ── Annotate variable occurrences with free/bound info ───────────────────────
// After this pass, each term in a pred node has:
//   term._free   = true  (free occurrence)
//   term._free   = false (bound occurrence)
//   term._binder = the quantifier node that binds it (or null if free)
function annotateVars(node, scope = new Map()) {
  if (node.type === 'pred') {
    node.terms.forEach(t => {
      if (t.type === 'var') {
        const key = t.name + (t.sub || '');
        const binder = scope.get(key) || null;
        t._free   = binder === null;
        t._binder = binder;
      } else {
        t._free   = null;  // constants don't need marking
        t._binder = null;
      }
    });
  } else if (node.type === 'eq') {
    [node.left, node.right].forEach(t => {
      if (t.type === 'var') {
        const key = t.name + (t.sub || '');
        const binder = scope.get(key) || null;
        t._free   = binder === null;
        t._binder = binder;
      } else {
        t._free = null; t._binder = null;
      }
    });
  } else if (isQuant(node)) {
    const key = node.var.name + (node.var.sub || '');
    const newScope = new Map(scope);
    newScope.set(key, node);
    annotateVars(node.body, newScope);
  } else {
    treeChildren(node).forEach(c => annotateVars(c, scope));
  }
}

// ── Text measurement ──────────────────────────────────────────────────────────
let _ctx = null;
function measureText(text) {
  if (!_ctx) {
    _ctx = document.createElement('canvas').getContext('2d');
  }
  _ctx.font = `${FONT_SZ}px "Consolas", "Liberation Mono", Menlo, Courier, monospace`;
  return _ctx.measureText(text).width;
}

// ── Node label: full subformula (using parser's prettyPrint) ──────────────────
function nodeLabel(node, isRoot) {
  return prettyPrint(node, isRoot);
}

// ── Layout: compute _w, _h, _subtreeW, then x/y positions ───────────────────
function computeLayout(root) {
  // Step 1: annotate node sizes
  function sizeNode(node, isRoot) {
    const label = nodeLabel(node, isRoot);
    node._label = label;
    node._w = Math.ceil(measureText(label)) + PAD_X * 2;
    node._h = FONT_SZ + PAD_Y * 2;
    treeChildren(node).forEach(c => sizeNode(c, false));
  }
  sizeNode(root, true);

  // Step 2: subtree widths
  function subtreeW(node) {
    const ch = treeChildren(node);
    if (!ch.length) { node._subtreeW = node._w; return node._w; }
    const total = ch.reduce((s, c) => s + subtreeW(c), 0) + (ch.length - 1) * H_GAP;
    node._subtreeW = Math.max(node._w, total);
    return node._subtreeW;
  }
  subtreeW(root);

  // Step 3: assign x/y positions (centred layout)
  const positions = new Map();
  function assign(node, cx, depth) {
    const y = depth * (FONT_SZ + PAD_Y * 2 + V_GAP);
    const x = cx - node._w / 2;
    positions.set(node, { x, y, w: node._w, h: node._h });
    const ch = treeChildren(node);
    if (!ch.length) return;
    const totalW = ch.reduce((s, c) => s + c._subtreeW, 0) + (ch.length - 1) * H_GAP;
    let cur = cx - totalW / 2;
    ch.forEach(child => {
      assign(child, cur + child._subtreeW / 2, depth + 1);
      cur += child._subtreeW + H_GAP;
    });
  }
  assign(root, root._subtreeW / 2, 0);
  return positions;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
function svgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// ── Atomic text with per-character variable colouring ────────────────────────
function buildAtomicText(node, cx, cy, baseColor) {
  const textEl = svgEl('text', {
    x: cx, y: cy,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    'font-family': 'var(--font-mono)',
    'font-size': FONT_SZ,
    fill: baseColor,
  });

  // Build character parts
  const parts = [];

  if (node.type === 'pred') {
    // Predicate name chars — base colour, no underline
    for (const ch of (node.name + (node.sub || ''))) {
      parts.push({ char: ch, color: baseColor, underline: false });
    }
    node.terms.forEach(t => {
      const tStr = t.name + (t.sub || '');
      for (const ch of tStr) {
        if (t.type === 'var' && t._free !== null) {
          const color = t._free ? 'var(--color-free)' : t._binder._bindColor;
          parts.push({ char: ch, color, underline: true });
        } else {
          parts.push({ char: ch, color: baseColor, underline: false });
        }
      }
    });
  } else if (node.type === 'eq') {
    // τ₁ = τ₂
    const renderTerm = t => {
      const tStr = t.name + (t.sub || '');
      for (const ch of tStr) {
        if (t.type === 'var' && t._free !== null) {
          const color = t._free ? 'var(--color-free)' : t._binder._bindColor;
          parts.push({ char: ch, color, underline: true });
        } else {
          parts.push({ char: ch, color: baseColor, underline: false });
        }
      }
    };
    renderTerm(node.left);
    for (const ch of ' = ') parts.push({ char: ch, color: baseColor, underline: false });
    renderTerm(node.right);
  }

  // If no underlines, just use plain text
  if (!parts.some(p => p.underline)) {
    textEl.textContent = node._label;
    return textEl;
  }

  // Group consecutive same-style chars into tspan runs
  let run = null;
  const flush = () => {
    if (!run) return;
    const ts = svgEl('tspan', {
      fill: run.color,
      ...(run.underline ? {
        'text-decoration':          'underline',
        'text-decoration-color':    run.color,
        'text-decoration-thickness':'2px',
        'text-underline-offset':    '3px',
      } : {}),
    });
    ts.textContent = run.chars;
    textEl.appendChild(ts);
    run = null;
  };
  parts.forEach(p => {
    if (!run || run.color !== p.color || run.underline !== p.underline) {
      flush();
      run = { chars: p.char, color: p.color, underline: p.underline };
    } else {
      run.chars += p.char;
    }
  });
  flush();
  return textEl;
}

// ── Collect all quantifier nodes ──────────────────────────────────────────────
function collectQuantifiers(node, result = []) {
  if (isQuant(node)) { result.push(node); collectQuantifiers(node.body, result); }
  else treeChildren(node).forEach(c => collectQuantifiers(c, result));
  return result;
}

// ── Collect all atomic nodes ──────────────────────────────────────────────────
function collectAtomics(node, result = []) {
  if (isAtomic(node)) { result.push(node); }
  else treeChildren(node).forEach(c => collectAtomics(c, result));
  return result;
}

// ── Main render function ──────────────────────────────────────────────────────
function renderTree(ast) {
  const container = document.getElementById('tree-container');
  const empty     = document.getElementById('tree-empty');
  const svgWrap   = document.getElementById('tree-svg');
  if (!svgWrap) return;

  if (!ast) {
    if (empty) { empty.hidden = false; empty.style.display = ''; }
    svgWrap.innerHTML = '';
    return;
  }
  if (empty) { empty.hidden = true; empty.style.display = 'none'; }

  // Annotate before layout
  assignBinderColors(ast);
  annotateVars(ast);

  const positions = computeLayout(ast);

  // Canvas bounding box
  const MARGIN = 16;
  let maxX = 0, maxY = 0;
  for (const { x, y, w, h } of positions.values()) {
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  const W = maxX + MARGIN * 2;
  const H = maxY + MARGIN * 2;

  const svg = svgEl('svg', { width: W, height: H, 'aria-label': 'Parse tree' });

  const edgeG = svgEl('g', { transform: `translate(${MARGIN},${MARGIN})` });
  const nodeG = svgEl('g', { transform: `translate(${MARGIN},${MARGIN})` });
  svg.appendChild(edgeG);
  svg.appendChild(nodeG);

  const nodeEls = new Map();

  function draw(node) {
    const pos = positions.get(node);
    const ch  = treeChildren(node);

    // Edges to children
    ch.forEach(child => {
      const cpos = positions.get(child);
      edgeG.appendChild(svgEl('line', {
        x1: pos.x + pos.w / 2, y1: pos.y + pos.h,
        x2: cpos.x + cpos.w / 2, y2: cpos.y,
        stroke: 'var(--color-border)',
        'stroke-width': '1.5',
      }));
      draw(child);
    });

    // Node colours
    let strokeColor, textColor;
    if (isAtomic(node)) {
      strokeColor = textColor = 'var(--color-teal)';
    } else if (isQuant(node)) {
      strokeColor = textColor = node._bindColor || 'var(--color-primary)';
    } else {
      strokeColor = textColor = 'var(--color-primary)';
    }

    const g = svgEl('g', { class: 'tree-node' });
    g.appendChild(svgEl('rect', {
      x: pos.x, y: pos.y,
      width: pos.w, height: pos.h,
      rx: 5, ry: 5,
      fill: 'var(--color-surface)',
      stroke: strokeColor,
      'stroke-width': '1.8',
    }));

    const cx = pos.x + pos.w / 2;
    const cy = pos.y + pos.h / 2;

    if (isAtomic(node)) {
      g.appendChild(buildAtomicText(node, cx, cy, textColor));
    } else {
      g.appendChild(svgEl('text', {
        x: cx, y: cy,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-family': 'var(--font-mono)',
        'font-size': FONT_SZ,
        fill: textColor,
      }, node._label));
    }

    nodeG.appendChild(g);
    nodeEls.set(node, g);
  }

  draw(ast);

  svgWrap.innerHTML = '';
  svgWrap.appendChild(svg);

  // ── Hover interaction ─────────────────────────────────────────────────────
  const quantifiers = collectQuantifiers(ast);
  const atomics     = collectAtomics(ast);

  const quantBindsAtomics = new Map();
  quantifiers.forEach(q => {
    const varKey = q.var.name + (q.var.sub || '');
    const bound  = atomics.filter(a => {
      const terms = a.type === 'pred' ? a.terms : [a.left, a.right];
      return terms.some(t => t.type === 'var' && t._binder === q);
    });
    quantBindsAtomics.set(q, bound);
  });

  const atomicBoundBy = new Map();
  atomics.forEach(a => {
    const terms = a.type === 'pred' ? a.terms : [a.left, a.right];
    const binders = new Set(terms.filter(t => t.type === 'var' && t._binder).map(t => t._binder));
    atomicBoundBy.set(a, binders);
  });

  const setOpacities = highlight => {
    nodeEls.forEach((el, n) => { el.style.opacity = highlight.has(n) ? '1' : '0.2'; });
  };
  const resetOpacities = () => {
    nodeEls.forEach(el => { el.style.opacity = '1'; });
  };

  quantifiers.forEach(q => {
    const el = nodeEls.get(q);
    if (!el) return;
    const targets = new Set([q, ...quantBindsAtomics.get(q)]);
    el.addEventListener('mouseenter', () => setOpacities(targets));
    el.addEventListener('mouseleave', resetOpacities);
  });

  atomics.forEach(a => {
    const el = nodeEls.get(a);
    if (!el) return;
    const binders = atomicBoundBy.get(a);
    if (!binders || !binders.size) return;
    const targets = new Set([a, ...binders]);
    el.addEventListener('mouseenter', () => setOpacities(targets));
    el.addEventListener('mouseleave', resetOpacities);
  });
}
