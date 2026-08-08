# What Sloppy collects

Written to be pasted, more or less as-is, into the Chrome Web Store data
disclosure, the AMO listing, and Apple's privacy nutrition label. It is also the
honest answer to "so what does this thing send?".

## The short version

**With sharing off — the default — nothing leaves your device. Ever.**

Sloppy installs with `syncEnabled: false` and no API address configured. In that
state it makes no network requests at all: tagging a post writes to local
storage and hides the post for you, and that is the whole loop.

## With sharing on

You turn it on in Settings, and then a tag click sends exactly this:

| Field | Example | Why |
|---|---|---|
| `site` | `linkedin` | Which list the tag belongs to |
| `postId` | `urn:li:activity:7…` | The thing being tagged. Public, on a public post |
| `authorId` | `urn:li:member:123` | So an account posting slop daily can be promoted |
| `authorKind` | `person` / `org` | Company accounts get a different threshold |
| `tag` | `ai-text` | Which stylistic category |
| `textHash` | `9f2c1a…` (16 hex) | A 64-bit fingerprint of the post body |
| `installId` | a UUID | Enforces "2 distinct people" and rate-limits |

And periodically it downloads the whole shared list.

## What Sloppy never collects

- **Which posts you looked at.** This is the important one, and it is
  structural rather than a promise: the client downloads the entire blocklist
  and matches it locally, so the server is never asked about a specific post. It
  cannot log a question nobody asked it.
- **The text of any post.** Only the 16-hex fingerprint, which exists so the
  server can notice the same body posted by many different accounts — the repost
  signal — without ever holding the body.
- **Your name, email, or any account.** There is no sign-up. The install id is a
  random UUID generated on your device.
- **Your browsing.** No history, no page contents, no analytics, no third-party
  scripts. The extension has host permissions for exactly two domains.
- **Which posts you un-hid.** Every "show anyway" is recorded — it is the only
  negative-label source there is — and it is recorded **locally only**, capped at
  the most recent 500, and never transmitted.

## About that fingerprint

`textHash` is a 64-bit FNV-1a digest of the whitespace- and case-normalised post
text. It is deliberately **not** described as a cryptographic hash, because it
isn't one:

- It **is** one-way and lossy. 64 bits cannot reconstruct a paragraph.
- It is **not** resistant to a dictionary attack. If someone already has a
  candidate text, they can confirm a match by hashing it.

That is acceptable here because it is only ever computed over text that is
already public on the page. It would not be acceptable for anything private, and
nothing private is ever fingerprinted.

## Permissions, and why each one

| Permission | Why |
|---|---|
| `storage` | Preferences, your tag list, the downloaded snapshot |
| `alarms` | Wakes the daily snapshot refresh |
| `*://*.linkedin.com/*` | Read the feed to find posts; draw the button and the stub |
| `*://*.reddit.com/*` | The same, on Reddit |

There is no `tabs` permission, no `<all_urls>`, no `declarativeNetRequest`, and
no remotely-hosted code.

## On remote rules

Sloppy ships a rules interpreter and an **empty** ruleset, so phrasing filters
can be enabled later as a data update rather than a store resubmission.

Those rules are *data interpreted by code that already shipped* — not remote
code execution. Because the data includes regular expressions, every pattern is
gated in CI before it can be published: validated against a restricted grammar,
rejected if it contains a backreference, lookbehind, nested quantifier or
adjacent unbounded quantifiers, capped at 300 characters, and timed against
adversarial input on an escalating budget. At runtime, patterns compile inside a
try/catch, stateful flags are stripped, and no pattern is run over more than
8,000 characters of text.

The gate is `packages/ruleset/validate.ts`. It runs on every push.

## Data retention

- On your device: until you uninstall, or press **Forget my tags** in Settings.
- On the server, if sharing is on: tag tuples are kept and rolled up on a
  90-day window. The published post list covers a rolling 14 days.
