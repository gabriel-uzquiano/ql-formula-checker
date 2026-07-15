// ── QL Evaluator ──────────────────────────────────────────────────────────────
// Determines the status of a raw input string:
//   { status: 'official',   ast, pretty, freeVars, predicates }
//   { status: 'unofficial', ast, pretty, freeVars, predicates, officialForm }
//   { status: 'error',      message }
//
// "Official" means the string parses as-is under the strict grammar.
// "Unofficial" means the string fails the strict grammar but parses after
//   wrapping in outer parentheses OR is an abbreviation (outer parens dropped
//   from a top-level binary formula).
// An unofficial formula shows the official form it abbreviates.

'use strict';

function evaluate(raw) {
  const input = raw.trim();
  if (!input) return { status: 'empty' };

  const arityMap = {};

  // ── Try to parse as official formula ──────────────────────────────────────
  let ast = null;
  try {
    ast = parse(input, arityMap);
  } catch (e) {
    // Not official — try unofficial paths below
  }

  if (ast !== null) {
    const pretty = prettyPrint(ast, true);
    return {
      status: 'official',
      ast,
      pretty,
      freeVars: [...freeVars(ast)].sort(),
      predicates: collectPredicates(ast),
    };
  }

  // ── Try unofficial: wrap in parens and re-parse ───────────────────────────
  // This handles cases like  p ∧ q  (missing outer parens on binary)
  const arityMap2 = {};
  let ast2 = null;
  let err2 = null;
  try {
    ast2 = parse('(' + input + ')', arityMap2);
  } catch (e) {
    err2 = e;
  }

  if (ast2 !== null) {
    const pretty2 = prettyPrint(ast2, false); // false = include outer parens
    return {
      status: 'unofficial',
      ast: ast2,
      pretty: prettyPrint(ast2, true),       // without outer parens (abbrev form)
      officialForm: pretty2,                  // with outer parens (official)
      freeVars: [...freeVars(ast2)].sort(),
      predicates: collectPredicates(ast2),
    };
  }

  // ── Neither worked — return an error ─────────────────────────────────────
  // Re-parse officially to get a cleaner error message.
  // Also attempt a parse with a fresh arity map to detect arity conflicts.
  let errMsg = 'Not a formula';
  try { parse(input, {}); } catch (e) { errMsg = e.message; }

  // If the wrapped parse also failed with an arity conflict, surface that.
  if (err2 && err2.message && err2.message.includes('used with')) {
    errMsg = err2.message;
  }

  return { status: 'error', message: errMsg };
}
