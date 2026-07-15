// ── QL Formula Parser ──────────────────────────────────────────────────────
// Grammar (official formulas):
//   term       ::= variable | constant
//   variable   ::= x | y | z   (with optional numeric subscripts)
//   constant   ::= a | b | c | d | e  (with optional numeric subscripts)
//   predicate  ::= P | Q | R | S | T  (with optional numeric subscripts)
//   atomic     ::= predicate term+   |  term = term
//   formula    ::= atomic
//                | ¬ formula
//                | ( formula ∧ formula )
//                | ( formula ∨ formula )
//                | ( formula → formula )
//                | ∀ variable formula
//                | ∃ variable formula
//
// Arity is inferred from the *first* occurrence of each predicate.
// Subsequent occurrences with a different arity are an error.
//
// The parser returns an AST node or throws a ParseError.
// prettyPrint(ast, topLevel) returns the canonical (official) string.
// collectTerms(ast) returns { variables: Set, constants: Set }.
// freeVars(ast) returns Set of free variable names.

'use strict';

// ── Token types ──────────────────────────────────────────────────────────────
const T = {
  PRED:  'PRED',   // P Q R S T (uppercase, with optional subscript digits)
  VAR:   'VAR',    // x y z (with optional subscript digits)
  CONST: 'CONST',  // a b c d e (with optional subscript digits)
  NEG:   'NEG',    // ¬ ~
  AND:   'AND',    // ∧ &  /\
  OR:    'OR',     // ∨ |  \/
  IMP:   'IMP',    // → -> =>
  ALL:   'ALL',    // ∀
  EX:    'EX',     // ∃
  EQ:    'EQ',     // =
  LPAREN:'LPAREN', // (
  RPAREN:'RPAREN', // )
  EOF:   'EOF',
};

class ParseError extends Error {
  constructor(msg, pos) {
    super(msg);
    this.name = 'ParseError';
    this.pos  = pos;
  }
}

// ── Tokeniser ────────────────────────────────────────────────────────────────
function tokenise(src) {
  const tokens = [];
  let i = 0;
  const digits = () => { let d = ''; while (i < src.length && /\d/.test(src[i])) d += src[i++]; return d; };

  while (i < src.length) {
    const ch = src[i];

    // whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // multi-char ASCII operators first
    if (src.startsWith('->', i)) { tokens.push({ type: T.IMP, pos: i }); i += 2; continue; }
    if (src.startsWith('=>', i)) { tokens.push({ type: T.IMP, pos: i }); i += 2; continue; }
    if (src.startsWith('/\\', i)){ tokens.push({ type: T.AND, pos: i }); i += 2; continue; }
    if (src.startsWith('\\/', i)){ tokens.push({ type: T.OR,  pos: i }); i += 2; continue; }

    const pos = i;
    i++;

    // Unicode connectives / quantifiers
    if (ch === '¬' || ch === '~')  { tokens.push({ type: T.NEG, pos }); continue; }
    if (ch === '∧' || ch === '&')  { tokens.push({ type: T.AND, pos }); continue; }
    if (ch === '∨' || ch === '|')  { tokens.push({ type: T.OR,  pos }); continue; }
    if (ch === '→')                 { tokens.push({ type: T.IMP, pos }); continue; }
    if (ch === '∀' || ch === 'A' && src[i] === 'l' && src[i+1] === 'l') {
      // ∀ only — 'All' is not a shortcut we support
      tokens.push({ type: T.ALL, pos }); continue;
    }
    if (ch === '∃')                 { tokens.push({ type: T.EX,  pos }); continue; }
    if (ch === '=')                 { tokens.push({ type: T.EQ,  pos }); continue; }
    if (ch === '(')                 { tokens.push({ type: T.LPAREN, pos }); continue; }
    if (ch === ')')                 { tokens.push({ type: T.RPAREN, pos }); continue; }

    // Predicate letters P Q R S T (+ optional subscript digits)
    if (/[PQRST]/.test(ch)) {
      const sub = digits();
      tokens.push({ type: T.PRED, name: ch, sub, pos });
      continue;
    }

    // Variables x y z (+ optional subscript digits)
    if (/[xyz]/.test(ch)) {
      const sub = digits();
      tokens.push({ type: T.VAR, name: ch, sub, pos });
      continue;
    }

    // Constants a b c d e (+ optional subscript digits)
    if (/[abcde]/.test(ch)) {
      const sub = digits();
      tokens.push({ type: T.CONST, name: ch, sub, pos });
      continue;
    }

    throw new ParseError(`Unexpected character: '${ch}'`, pos);
  }
  tokens.push({ type: T.EOF, pos: i });
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────────────────
// arityMap: predicate-name → number (global within one parse call)

function parse(src, arityMap) {
  if (arityMap === undefined) arityMap = {};
  const tokens = tokenise(src);
  let pos = 0;

  const peek  = ()  => tokens[pos];
  const next  = ()  => tokens[pos++];
  const eat   = (t) => {
    if (peek().type !== t) throw new ParseError(`Expected ${t}, got ${peek().type}`, peek().pos);
    return next();
  };

  function parseTerm() {
    const tok = peek();
    if (tok.type === T.VAR || tok.type === T.CONST) {
      next();
      return { type: tok.type === T.VAR ? 'var' : 'const', name: tok.name, sub: tok.sub };
    }
    return null;
  }

  function parseFormula() {
    const tok = peek();

    // Negation: ¬ φ
    if (tok.type === T.NEG) {
      next();
      const arg = parseFormula();
      return { type: 'neg', arg };
    }

    // Quantifiers: ∀x φ  or  ∃x φ
    if (tok.type === T.ALL || tok.type === T.EX) {
      const qt = next();
      const varTok = peek();
      if (varTok.type !== T.VAR) throw new ParseError('Expected variable after quantifier', varTok.pos);
      next();
      const body = parseFormula();
      return { type: qt.type === T.ALL ? 'all' : 'ex', var: { name: varTok.name, sub: varTok.sub }, body };
    }

    // Parenthesised binary: ( φ op ψ )
    if (tok.type === T.LPAREN) {
      next(); // consume (
      const left = parseFormula();
      const op = peek();
      let nodeType;
      if      (op.type === T.AND) nodeType = 'and';
      else if (op.type === T.OR)  nodeType = 'or';
      else if (op.type === T.IMP) nodeType = 'imp';
      else throw new ParseError(`Expected connective inside parentheses, got ${op.type}`, op.pos);
      next(); // consume connective
      const right = parseFormula();
      eat(T.RPAREN);
      return { type: nodeType, left, right };
    }

    // Predicate atomic: P τ₁ … τₙ
    if (tok.type === T.PRED) {
      next();
      const predName = tok.name + (tok.sub || '');
      const terms = [];
      while (true) {
        const t = parseTerm();
        if (t === null) break;
        terms.push(t);
      }
      if (terms.length === 0) throw new ParseError(`Predicate ${predName} needs at least one term`, tok.pos);

      // Check/register arity
      if (arityMap[predName] === undefined) {
        arityMap[predName] = terms.length;
      } else if (arityMap[predName] !== terms.length) {
        throw new ParseError(
          `Predicate ${predName} used with ${terms.length} term(s) but earlier used with ${arityMap[predName]}`,
          tok.pos
        );
      }
      return { type: 'pred', name: tok.name, sub: tok.sub || '', terms };
    }

    // Identity atomic: τ₁ = τ₂
    {
      const t1 = parseTerm();
      if (t1 !== null) {
        if (peek().type === T.EQ) {
          next(); // consume =
          const t2 = parseTerm();
          if (t2 === null) throw new ParseError('Expected term after =', peek().pos);
          return { type: 'eq', left: t1, right: t2 };
        }
        // A bare term with no predicate or = is an error
        throw new ParseError(`Unexpected term '${t1.name}' without predicate or identity`, tok.pos);
      }
    }

    throw new ParseError(`Unexpected token: ${tok.type}`, tok.pos);
  }

  const ast = parseFormula();
  if (peek().type !== T.EOF) {
    throw new ParseError(`Unexpected extra input after formula`, peek().pos);
  }
  return ast;
}

// ── prettyPrint ──────────────────────────────────────────────────────────────
function termStr(t) {
  return t.name + (t.sub || '');
}

function prettyPrint(node, topLevel = true) {
  if (!node) return '';
  switch (node.type) {
    case 'pred': return node.name + (node.sub || '') + node.terms.map(termStr).join('');
    case 'eq':   return termStr(node.left) + ' = ' + termStr(node.right);
    case 'neg':  return '¬' + prettyAtom(node.arg);
    case 'and':  return wrap(`${prettyPrint(node.left, false)} ∧ ${prettyPrint(node.right, false)}`, topLevel);
    case 'or':   return wrap(`${prettyPrint(node.left, false)} ∨ ${prettyPrint(node.right, false)}`, topLevel);
    case 'imp':  return wrap(`${prettyPrint(node.left, false)} → ${prettyPrint(node.right, false)}`, topLevel);
    case 'all':  return `∀${termStr(node.var)} ${quantScope(node.body)}`;
    case 'ex':   return `∃${termStr(node.var)} ${quantScope(node.body)}`;
    default: return '?';
  }
}

function prettyAtom(node) {
  // Atomics and negations don't need extra parens; binary connectives and
  // quantifiers need wrapping so ¬ binds tightly
  if (node.type === 'pred' || node.type === 'eq' || node.type === 'neg') return prettyPrint(node, false);
  // For quantifiers under negation, wrap in parens so scope is unambiguous
  if (node.type === 'all' || node.type === 'ex') return '(' + prettyPrint(node, true) + ')';
  // Binary connectives
  return '(' + prettyPrint(node, true) + ')';
}


function quantScope(node) {
  // When a quantifier's body is a binary connective, wrap in parens so that
  // scope is unambiguous: ∀x(Px ∧ Qx) not ∀x Px ∧ Qx.
  if (node.type === 'and' || node.type === 'or' || node.type === 'imp') {
    return '(' + prettyPrint(node, true) + ')';
  }
  return prettyPrint(node, true);
}
function wrap(s, topLevel) {
  return topLevel ? s : `(${s})`;
}

// ── collectTerms ─────────────────────────────────────────────────────────────
function collectTerms(ast) {
  const variables = new Set();
  const constants = new Set();
  function walk(node) {
    if (!node) return;
    switch (node.type) {
      case 'pred': node.terms.forEach(t => (t.type === 'var' ? variables : constants).add(termStr(t))); break;
      case 'eq':
        [node.left, node.right].forEach(t => (t.type === 'var' ? variables : constants).add(termStr(t)));
        break;
      case 'neg': walk(node.arg); break;
      case 'and': case 'or': case 'imp': walk(node.left); walk(node.right); break;
      case 'all': case 'ex': variables.add(termStr(node.var)); walk(node.body); break;
    }
  }
  walk(ast);
  return { variables, constants };
}

// ── freeVars ─────────────────────────────────────────────────────────────────
// Returns a Set of variable name+sub strings that have free occurrences.
function freeVars(ast) {
  function walk(node, bound) {
    if (!node) return new Set();
    switch (node.type) {
      case 'pred': {
        const free = new Set();
        node.terms.forEach(t => { if (t.type === 'var' && !bound.has(termStr(t))) free.add(termStr(t)); });
        return free;
      }
      case 'eq': {
        const free = new Set();
        [node.left, node.right].forEach(t => { if (t.type === 'var' && !bound.has(termStr(t))) free.add(termStr(t)); });
        return free;
      }
      case 'neg': return walk(node.arg, bound);
      case 'and': case 'or': case 'imp': {
        const f = walk(node.left, bound);
        walk(node.right, bound).forEach(v => f.add(v));
        return f;
      }
      case 'all': case 'ex': {
        const newBound = new Set(bound);
        newBound.add(termStr(node.var));
        return walk(node.body, newBound);
      }
      default: return new Set();
    }
  }
  return walk(ast, new Set());
}

// ── collectPredicates ─────────────────────────────────────────────────────────
function collectPredicates(ast) {
  const preds = {}; // name → arity
  function walk(node) {
    if (!node) return;
    switch (node.type) {
      case 'pred': preds[node.name + (node.sub || '')] = node.terms.length; break;
      case 'neg': walk(node.arg); break;
      case 'and': case 'or': case 'imp': walk(node.left); walk(node.right); break;
      case 'all': case 'ex': walk(node.body); break;
    }
  }
  walk(ast);
  return preds;
}
