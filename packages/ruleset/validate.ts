/**
 * The ruleset CI gate.
 *
 * Rules are *data* interpreted by shipped code, which is what keeps this on the
 * right side of MV3's remote-code-execution rule. Building a `RegExp` from a
 * remotely-fetched string is nonetheless a grey area that reviewers do
 * occasionally flag, so the defensible position is a gate you can point at:
 * every pattern is validated against a restricted grammar, ReDoS shapes are
 * rejected, length is capped, and each pattern is timed against adversarial
 * input before it can ship. That paragraph goes in the store listing.
 *
 * Run: `node validate.ts rules.json`
 */

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPattern as analyse, type PatternProblem } from '@sloppy/core';
import { zRuleset } from '@sloppy/core/schema';

export interface Problem {
  featureId: string;
  code:
    | 'schema'
    | 'too-long'
    | 'bad-flags'
    | 'backreference'
    | 'lookbehind'
    | 'nested-quantifier'
    | 'adjacent-quantifiers'
    | 'huge-repetition'
    | 'uncompilable'
    | 'slow'
    | 'no-bounds'
    | 'duplicate-id';
  message: string;
}
/**
 * The pattern analysis itself now lives in @sloppy/core, because the CI gate is
 * not the only gate that matters - the extension runs the same checks against
 * every ruleset it fetches, before storing it. One implementation, three
 * callers, no drift.
 */
export { MAX_PATTERN_LEN, MAX_PATTERN_MS, MAX_REPETITION } from '@sloppy/core';

/** CI reports problems against a feature id; core reports them bare. */
function attribute(id: string, problems: readonly PatternProblem[]): Problem[] {
  return problems.map((p) => ({ featureId: id, code: p.code, message: p.message }));
}

export function validateRuleset(raw: unknown): Problem[] {
  const parsed = zRuleset.safeParse(raw);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({
      featureId: i.path.join('.') || '<root>',
      code: 'schema' as const,
      message: i.message,
    }));
  }

  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const f of parsed.data.features) {
    if (seen.has(f.id)) {
      problems.push({ featureId: f.id, code: 'duplicate-id', message: 'id used more than once' });
    }
    seen.add(f.id);

    if (f.type === 'regex') {
      problems.push(...attribute(f.id, analyse(f.pattern, f.flags ?? '')));
    } else if (f.gte === undefined && f.lte === undefined) {
      problems.push({
        featureId: f.id,
        code: 'no-bounds',
        message: 'a metric feature with neither gte nor lte can never fire',
      });
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  const file = argv[2] ?? 'rules.json';
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[ruleset] cannot read ${file}: ${(err as Error).message}`);
    return 1;
  }

  const problems = validateRuleset(raw);
  if (problems.length === 0) {
    const count = (raw as { features?: unknown[] }).features?.length ?? 0;
    console.log(`[ruleset] ${file} OK - ${count} feature(s)`);
    return 0;
  }

  for (const p of problems) {
    console.error(`[ruleset] ${p.featureId}: ${p.code} - ${p.message}`);
  }
  console.error(`[ruleset] FAILED with ${problems.length} problem(s)`);
  return 1;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exit(main(process.argv));
}
