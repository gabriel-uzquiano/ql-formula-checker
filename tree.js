// ── QL Parse Tree Renderer ────────────────────────────────────────────────────
// Renders an AST produced by parser.js into an SVG inside #tree-svg.
// Mirrors prop-formula-checker/tree.js with QL-specific node labels.

'use strict';

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_W   = 90;   // node box width
const NODE_H   = 32;   // node box height
const H_GAP    = 14;   // minimum horizontal gap between sibling subtrees
const V_GAP    = 48;   // vertical distance between levels (centre to centre)
const PAD      = 24;   // padding around the whole tree

// ── Node label ───────────────────────────────────────────────────────────────
function nodeLabel(node) {
  switch (node.type) {
    case 'pred': return node.name + (node.sub || '') + node.terms.map(t => t.name + (t.sub || '')).join('');
    case 'eq':   return (node.left.name + (node.left.sub||'')) + ' = ' + (node.right.name + (node.right.sub||''));
    case 'neg':  return '¬';
    case 'and':  return '∧';
    case 'or':   return '∨';
    case 'imp':  return '→';
    case 'all':  return '∀' + node.var.name + (node.var.sub || '');
    case 'ex':   return '∃' + node.var.name + (node.var.sub || '');
    default:     return '?';
  }
}

// ── Node type classification (for colouring) ─────────────────────────────────
function nodeClass(node) {
  if (node.type === 'pred' || node.type === 'eq') return 'node-atomic';
  if (node.type === 'neg')                         return 'node-neg';
  if (node.type === 'all' || node.type === 'ex')   return 'node-quant';
  return 'node-binary';
}

// ── Children of a node ───────────────────────────────────────────────────────
function children(node) {
  switch (node.type) {
    case 'neg':                    return [node.arg];
    case 'and': case 'or': case 'imp': return [node.left, node.right];
    case 'all': case 'ex':         return [node.body];
    default:                       return [];
  }
}

// ── Measure subtree widths (Reingold-Tilford-lite) ───────────────────────────
function measure(node) {
  const kids = children(node);
  if (kids.length === 0) {
    node._w = NODE_W;
    return;
  }
  kids.forEach(measure);
  const totalKidW = kids.reduce((s, k) => s + k._w, 0) + H_GAP * (kids.length - 1);
  node._w = Math.max(NODE_W, totalKidW);
}

// ── Assign x/y positions ─────────────────────────────────────────────────────
function place(node, x, y) {
  node._x = x + node._w / 2;  // centre of this subtree
  node._y = y;
  const kids = children(node);
  if (kids.length === 0) return;
  let cx = x;
  kids.forEach(k => {
    place(k, cx, y + V_GAP);
    cx += k._w + H_GAP;
  });
}

// ── Collect all nodes in DFS order ──────────────────────────────────────────
function collect(node, arr = []) {
  arr.push(node);
  children(node).forEach(k => collect(k, arr));
  return arr;
}

// ── SVG helpers ─────────────────────────────────────────────────────────────
function svgEl(tag, attrs, text) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// ── Main render function ─────────────────────────────────────────────────────
function renderTree(ast) {
  const container = document.getElementById('tree-container');
  const empty     = document.getElementById('tree-empty');
  const svgWrap   = document.getElementById('tree-svg');
  if (!container || !svgWrap) return;

  if (!ast) {
    if (empty) { empty.hidden = false; empty.style.display = ''; }
    svgWrap.innerHTML = '';
    return;
  }

  if (empty) { empty.hidden = true; empty.style.display = 'none'; }

  // Layout
  measure(ast);
  place(ast, 0, 0);

  const nodes = collect(ast);
  const minX  = Math.min(...nodes.map(n => n._x)) - NODE_W / 2;
  const maxX  = Math.max(...nodes.map(n => n._x)) + NODE_W / 2;
  const minY  = Math.min(...nodes.map(n => n._y)) - NODE_H / 2;
  const maxY  = Math.max(...nodes.map(n => n._y)) + NODE_H / 2;

  const W = maxX - minX + PAD * 2;
  const H = maxY - minY + PAD * 2;

  const svg = svgEl('svg', {
    width: W, height: H,
    viewBox: `0 0 ${W} ${H}`,
    'aria-label': 'Parse tree',
  });

  const ox = PAD - minX;  // origin offset
  const oy = PAD - minY;

  // Edges first (so nodes render on top)
  nodes.forEach(node => {
    children(node).forEach(kid => {
      svg.appendChild(svgEl('line', {
        x1: node._x + ox, y1: node._y + oy,
        x2: kid._x  + ox, y2: kid._y  + oy,
        class: 'tree-edge',
      }));
    });
  });

  // Nodes
  nodes.forEach(node => {
    const cx = node._x + ox;
    const cy = node._y + oy;
    const cls = nodeClass(node);

    const g = svgEl('g', { class: `tree-node ${cls}`, transform: `translate(${cx},${cy})` });

    // Box
    g.appendChild(svgEl('rect', {
      x: -NODE_W / 2, y: -NODE_H / 2,
      width: NODE_W, height: NODE_H,
      rx: 5, ry: 5,
      class: 'tree-node-rect',
    }));

    // Label
    const label = nodeLabel(node);
    g.appendChild(svgEl('text', {
      x: 0, y: 1,
      class: 'tree-node-text',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
    }, label));

    svg.appendChild(g);
  });

  svgWrap.innerHTML = '';
  svgWrap.appendChild(svg);
}
