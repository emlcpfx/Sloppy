/**
 * Regex safety analysis. Pure, dependency-free, and shared by BOTH gates.
 *
 * This lives in core rather than in the ruleset package for one reason: the CI
 * gate is not the runtime gate. Rules are fetched from a server at runtime, and
 * a gate that only ever runs in CI protects the repository's own rules.json and
 * nothing that a user actually executes. A compromised or hostile server could
 * previously ship a catastrophic pattern that the client would compile and run
 * over every post in the feed.
 *
 * So the same analysis runs in three places now:
 *   - CI, against the repo's rules.json (packages/ruleset/validate.ts)
 *   - the extension, against every fetched ruleset, before it is stored
 *   - and it is the reason the store listing can describe a real control
 *
 * Nothing in here imports zod, node, or the DOM - it has to run in a Worker, a
 * service worker and a test runner unchanged.
 */

export interface PatternProblem {
  code:
    | 'too-long'
    | 'bad-flags'
    | 'backreference'
    | 'lookbehind'
    | 'nested-quantifier'
    | 'adjacent-quantifiers'
    | 'huge-repetition'
    | 'uncompilable'
    | 'slow';
  message: string;
}

export const MAX_PATTERN_LEN = 300;
export const MAX_REPETITION = 1000;
/** Budget per pattern across the whole adversarial corpus. */
export const MAX_PATTERN_MS = 50;

const ALLOWED_FLAGS = /^[imsu]*$/;

/**
 * Strings chosen to blow up the classic ReDoS shapes: long runs of one
 * character, long runs that fail only at the very end, and realistic prose that
 * is simply long.
 *
 * Sized in two tiers and run smallest-first. The probe cannot interrupt a regex
 * once it is running - JavaScript has no way to - so the only protection
 * against the probe itself hanging is to never hand it a big string until a
 * small one has come back fast.
 */
const PROBE_SMALL: readonly string[] = [
  'a'.repeat(120),
  `${'a'.repeat(120)}!`,
  `${'ab'.repeat(60)}!`,
  `${'it is not '.repeat(12)}x`,
];

const PROBE_LARGE: readonly string[] = [
  'a'.repeat(2000),
  `${'a'.repeat(2000)}!`,
  `${'ab'.repeat(1000)}!`,
  ' '.repeat(2000),
  `${'it is not '.repeat(200)}x`,
  `${'word '.repeat(400)}—`,
  `${'\n'.repeat(800)}end`,
];

/** If 120 characters already cost this much, never try 2000. */
const SMALL_PROBE_BUDGET_MS = 5;

interface Span {
  start: number;
  body: string;
}

/**
 * Walk a pattern, tracking group spans, character classes and escapes.
 *
 * Not a full regex parser and not trying to be - it needs to answer exactly one
 * question: is a quantifier applied to something that already contains a
 * quantifier or an alternation? That is the `(a+)+` shape, and it is the shape
 * that turns a 40-character rule into a hung tab.
 */
function findNestedQuantifiers(pattern: string): string[] {
  const found: string[] = [];
  const stack: number[] = [];
  let inClass = false;

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];

    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '(') {
      stack.push(i);
      continue;
    }
    if (c === ')') {
      const start = stack.pop();
      if (start === undefined) continue;
      const span: Span = { start, body: pattern.slice(start + 1, i) };
      const next = pattern.slice(i + 1);
      const quantified = /^(?:[*+]|\{\d+(?:,\d*)?\})/.exec(next);
      if (!quantified) continue;
      if (bodyIsRisky(span.body)) {
        found.push(`(${span.body})${quantified[0]}`);
      }
    }
  }
  return found;
}

/** A group body is risky if it can match the same text more than one way. */
function bodyIsRisky(body: string): boolean {
  let inClass = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      continue;
    }
    if (c === '[') {
      inClass = true;
      continue;
    }
    if (c === '*' || c === '+' || c === '|') return true;
    if (c === '{' && /^\{\d+,\d*\}/.test(body.slice(i))) return true;
  }
  return false;
}

interface Atom {
  text: string;
  quant: string | null;
}

/**
 * Split a pattern into quantified atoms.
 *
 * Same philosophy as findNestedQuantifiers: not a regex parser, just enough
 * structure to answer one question - are two unbounded quantifiers sitting next
 * to each other over overlapping character sets? `a*a*b` has no nested group at
 * all and is every bit as catastrophic as `(a+)+b`, so the group-based check
 * alone would wave it through.
 */
function tokenizeAtoms(pattern: string): Atom[] {
  const atoms: Atom[] = [];
  let i = 0;

  const readGroup = (): string => {
    const start = i;
    let depth = 0;
    let inClass = false;
    for (; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (inClass) {
        if (c === ']') inClass = false;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return pattern.slice(start, i);
  };

  const readClass = (): string => {
    const start = i;
    i++; // consume '['
    for (; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === ']') {
        i++;
        break;
      }
    }
    return pattern.slice(start, i);
  };

  while (i < pattern.length) {
    const c = pattern[i];
    let text: string;

    if (c === '\\') {
      text = pattern.slice(i, i + 2);
      i += 2;
    } else if (c === '[') {
      text = readClass();
    } else if (c === '(') {
      text = readGroup();
    } else if (c === '|' || c === '^' || c === '$') {
      // A boundary: quantifiers on either side are not adjacent.
      atoms.push({ text: c, quant: null });
      i++;
      continue;
    } else {
      text = c ?? '';
      i++;
    }

    const rest = pattern.slice(i);
    const q = /^(?:[*+?]\??|\{\d+(?:,\d*)?\}\??)/.exec(rest);
    if (q) i += q[0].length;
    atoms.push({ text, quant: q ? q[0] : null });
  }

  return atoms;
}

/** `*`, `+` and `{n,}` can each match unboundedly; `?` and `{n,m}` cannot. */
function isUnbounded(quant: string | null): boolean {
  if (!quant) return false;
  return quant.startsWith('*') || quant.startsWith('+') || /^\{\d+,\}/.test(quant);
}

/**
 * Do two atoms accept any common character?
 *
 * Deliberately conservative and openly incomplete: it catches identical atoms,
 * anything against `.`, and the `\d` inside `\w` case. Two different character
 * classes that happen to overlap will slip past, which is why the timing probe
 * still runs afterwards - the grammar gate is a filter, not a proof.
 */
function atomsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === '.' || b === '.') return true;
  const pair = new Set([a, b]);
  if (pair.has('\\d') && pair.has('\\w')) return true;
  if (pair.has('\\s') && pair.has('\\S')) return false;
  return false;
}

function findAdjacentQuantifiers(pattern: string): string[] {
  const atoms = tokenizeAtoms(pattern);
  const out: string[] = [];
  for (let i = 1; i < atoms.length; i++) {
    const prev = atoms[i - 1]!;
    const curr = atoms[i]!;
    if (!isUnbounded(prev.quant) || !isUnbounded(curr.quant)) continue;
    if (!atomsOverlap(prev.text, curr.text)) continue;
    out.push(`${prev.text}${prev.quant}${curr.text}${curr.quant}`);
  }
  return out;
}

function hugeRepetitions(pattern: string): string[] {
  const out: string[] = [];
  for (const m of pattern.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    const lo = Number(m[1]);
    const hi = m[2] === undefined || m[2] === '' ? Infinity : Number(m[2]);
    if (lo > MAX_REPETITION || (hi !== Infinity && hi > MAX_REPETITION)) {
      out.push(m[0]);
    }
  }
  return out;
}

/** Backreferences, not octal escapes or \0. */
function hasBackreference(pattern: string): boolean {
  return /\\[1-9]/.test(pattern.replace(/\\\\/g, '')) || /\\k<[^>]+>/.test(pattern);
}

/**
 * Lookbehind is rejected on target-floor grounds, not correctness grounds.
 * Sloppy ships to iOS Safari, and a rule that silently fails to compile on one
 * platform is worse than a rule that never shipped - the same snapshot would
 * hide different posts depending on the browser.
 */
function hasLookbehind(pattern: string): boolean {
  return /\(\?<[=!]/.test(pattern);
}

export function checkPattern(pattern: string, flags = ''): PatternProblem[] {
  const problems: PatternProblem[] = [];
  const push = (code: PatternProblem['code'], message: string) => problems.push({ code, message });

  if (pattern.length > MAX_PATTERN_LEN) {
    push('too-long', `${pattern.length} chars, cap is ${MAX_PATTERN_LEN}`);
  }
  if (!ALLOWED_FLAGS.test(flags)) {
    push('bad-flags', `flags "${flags}" - only i, m, s, u are allowed (g and y are stateful)`);
  }
  if (hasBackreference(pattern)) {
    push('backreference', 'backreferences make matching super-linear; rewrite without one');
  }
  if (hasLookbehind(pattern)) {
    push('lookbehind', 'lookbehind is not on the iOS Safari floor; rewrite with a capture');
  }
  for (const shape of findNestedQuantifiers(pattern)) {
    push('nested-quantifier', `${shape} - a quantified group containing a quantifier or alternation`);
  }
  for (const shape of findAdjacentQuantifiers(pattern)) {
    push('adjacent-quantifiers', `${shape} - two unbounded quantifiers over overlapping characters`);
  }
  for (const rep of hugeRepetitions(pattern)) {
    push('huge-repetition', `${rep} exceeds ${MAX_REPETITION}`);
  }

  let re: RegExp | null = null;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    push('uncompilable', String((err as Error).message));
  }

  // NEVER EXECUTE A PATTERN THAT ALREADY FAILED A STRUCTURAL CHECK.
  //
  // The first version of this gate flagged `(.*a){20}$` and then ran it against
  // a 5000-character string anyway "to time it", and hung the test suite for
  // over two minutes. A gate that reproduces the attack it is detecting is not
  // a gate. Structure first; only patterns that already look safe get executed.
  if (!re || problems.length > 0) return problems;

  const smallMs = timeAgainst(re, PROBE_SMALL);
  if (smallMs > SMALL_PROBE_BUDGET_MS) {
    push('slow', `${smallMs.toFixed(1)}ms on 120-char input - superlinear, not escalating further`);
    return problems;
  }

  const largeMs = timeAgainst(re, PROBE_LARGE);
  if (largeMs > MAX_PATTERN_MS) {
    push('slow', `${largeMs.toFixed(1)}ms against adversarial input, budget is ${MAX_PATTERN_MS}ms`);
  }

  return problems;
}

function timeAgainst(re: RegExp, corpus: readonly string[]): number {
  const t0 = performance.now();
  for (const s of corpus) re.test(s);
  return performance.now() - t0;
}


// ---------------------------------------------------------------------------
// Runtime gate
// ---------------------------------------------------------------------------

export interface DroppedFeature {
  id: string;
  problems: PatternProblem[];
}

export interface SanitizedRuleset<T> {
  ruleset: T;
  dropped: DroppedFeature[];
}

/**
 * Drop every feature that fails the safety analysis, and keep the rest.
 *
 * DROP, NOT REJECT. A single bad pattern must not discard an otherwise good
 * ruleset - that would hand anyone who can influence the ruleset an easy way to
 * disable filtering entirely by appending one hostile rule.
 *
 * A metric feature has no pattern to analyse, so it always survives; its bounds
 * are already constrained by the schema.
 */
export function sanitizeRuleset<
  R extends { features: readonly F[] },
  F extends { id: string; type: string; pattern?: string; flags?: string },
>(ruleset: R): SanitizedRuleset<R> {
  const dropped: DroppedFeature[] = [];
  const kept: F[] = [];

  for (const f of ruleset.features) {
    if (f.type !== 'regex' || typeof f.pattern !== 'string') {
      kept.push(f);
      continue;
    }
    const problems = checkPattern(f.pattern, f.flags ?? '');
    if (problems.length === 0) kept.push(f);
    else dropped.push({ id: f.id, problems });
  }

  return { ruleset: { ...ruleset, features: kept }, dropped };
}
