/**
 * snapshot + rules + prefs -> Verdict.
 *
 * This is the whole product in one pure function. Everything the extension
 * does visually is a render of its output, which is what makes the behaviour
 * testable under `node --test` without a browser anywhere in sight.
 */

import { computeMetrics } from './metrics.ts';
import type { Metrics } from './metrics.ts';
import { scoreText, thresholdFor } from './rules.ts';
import type { RuleScore, Ruleset } from './rules.ts';
import { isSubscribed, tagLabel } from './taxonomy.ts';
import type {
  AdapterPolicy,
  PostFeatures,
  Prefs,
  SnapshotIndex,
  Verdict,
} from './types.ts';
import { SHOW } from './types.ts';
import { isImmuneAuthor, isImmunePost } from './immune.ts';

export interface DecideContext {
  index: SnapshotIndex;
  prefs: Prefs;
  policy: AdapterPolicy;
  ruleset: Ruleset;
}

export interface Explanation {
  verdict: Verdict;
  metrics: Metrics | null;
  rules: RuleScore | null;
  threshold: number;
}

/**
 * Full working, for the options page and for debugging a surprising hide.
 * `decide` is the thin wrapper everybody else calls.
 */
export function explain(features: PostFeatures, ctx: DecideContext): Explanation {
  const { index, prefs, policy, ruleset } = ctx;
  const threshold = thresholdFor(ruleset, features.site, prefs.threshold);
  const none: Explanation = { verdict: SHOW, metrics: null, rules: null, threshold };

  if (!prefs.enabled) return none;
  if (prefs.sites[features.site] === false) return none;
  if (isImmuneAuthor(features.authorId) || isImmunePost(...features.postIds)) return none;

  // 1. Direct post hit. Checked against every id the adapter surfaced, so a
  //    reshare of tagged slop collapses too.
  for (const id of features.postIds) {
    const p = index.posts.get(id);
    if (!p) continue;
    if (p.n < policy.postHideThreshold) continue;
    if (!isSubscribed(p.tag, prefs.subscribedTags)) continue;
    return {
      ...none,
      verdict: { action: 'collapse', reason: tagLabel(p.tag), source: 'post' },
    };
  }

  // 2. Author hit. Promotion thresholds live in the rollup; the client still
  //    re-checks them so a stale snapshot cannot hide more than it should.
  if (features.authorId) {
    const a = index.authors.get(features.authorId);
    if (
      a &&
      a.flaggedPosts >= policy.authorPosts &&
      a.reporters >= policy.authorReporters &&
      isSubscribed(a.tag, prefs.subscribedTags)
    ) {
      return {
        ...none,
        verdict: {
          action: 'collapse',
          reason: `${tagLabel(a.tag)} - repeat poster`,
          source: 'author',
        },
      };
    }
  }

  // 3. Rules. Empty ruleset at launch, so this costs nothing until it ships.
  if (!prefs.rulesEnabled || ruleset.features.length === 0) return none;

  const metrics = computeMetrics(features.text, features.media);
  const rules = scoreText(features.text, metrics, ruleset);
  if (rules.score < threshold) {
    return { verdict: SHOW, metrics, rules, threshold };
  }

  const reason = rules.hits.slice(0, 2).map((h) => h.label).join(' + ') || 'phrasing';
  return {
    verdict: { action: 'collapse', reason, source: 'rule' },
    metrics,
    rules,
    threshold,
  };
}

export function decide(features: PostFeatures, ctx: DecideContext): Verdict {
  return explain(features, ctx).verdict;
}
