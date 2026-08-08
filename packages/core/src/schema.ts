/**
 * Wire schemas, shared by the extension and the Worker.
 *
 * Validation belongs at the network boundary and nowhere else. The background
 * script validates a fetched snapshot before it reaches storage; the content
 * script - which runs on every post in a feed - never imports this module, so
 * zod stays out of the hot path and out of the injected bundle.
 */

import { z } from 'zod';
import { METRIC_NAMES } from './metrics.ts';
import { SITE_IDS } from './types.ts';

export const zSiteId = z.enum(SITE_IDS as unknown as [string, ...string[]]);
export const zAuthorKind = z.enum(['person', 'org', 'unknown']);

/** Tags are slugs by the time they hit the wire; see taxonomy.slugifyTag. */
export const zTag = z.string().min(1).max(32).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const zPostId = z.string().min(1).max(128);
export const zAuthorId = z.string().min(1).max(128);
export const zInstallId = z.string().uuid();

export const zTagEvent = z.object({
  site: zSiteId,
  postId: zPostId,
  authorId: zAuthorId.nullable(),
  authorKind: zAuthorKind,
  tag: zTag,
  textHash: z.string().regex(/^[0-9a-f]{16}$/),
  ts: z.number().int().nonnegative(),
});

export const zTagRequest = zTagEvent.omit({ ts: true }).extend({
  installId: zInstallId,
});

export const zSnapshotPost = z.object({
  id: zPostId,
  tag: zTag,
  n: z.number().int().positive(),
});

export const zSnapshotAuthor = z.object({
  id: zAuthorId,
  kind: zAuthorKind,
  tag: zTag,
  flaggedPosts: z.number().int().nonnegative(),
  reporters: z.number().int().nonnegative(),
});

export const zSnapshot = z.object({
  site: zSiteId,
  generatedAt: z.number().int().nonnegative(),
  rulesVersion: z.number().int().nonnegative(),
  posts: z.array(zSnapshotPost).max(200_000),
  authors: z.array(zSnapshotAuthor).max(50_000),
});

const zRegexFeature = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('regex'),
  pattern: z.string().min(1).max(300),
  flags: z.string().regex(/^[imsu]*$/).optional(),
  weight: z.number().min(-10).max(10),
  label: z.string().max(64).optional(),
});

const zMetricFeature = z.object({
  id: z.string().min(1).max(64),
  type: z.literal('metric'),
  metric: z.enum(METRIC_NAMES as unknown as [string, ...string[]]),
  gte: z.number().optional(),
  lte: z.number().optional(),
  weight: z.number().min(-10).max(10),
  label: z.string().max(64).optional(),
});

export const zFeature = z.discriminatedUnion('type', [zRegexFeature, zMetricFeature]);

export const zRuleset = z.object({
  version: z.number().int().nonnegative(),
  features: z.array(zFeature).max(200),
  threshold: z.object({
    default: z.number(),
    bySite: z.record(zSiteId, z.number()).optional(),
  }),
});

export type TagRequest = z.infer<typeof zTagRequest>;
