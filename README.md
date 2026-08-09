<p align="center">
  <img src="packages/brand/assets/splat.svg" width="120" alt="">
</p>

<h1 align="center">Sloppy</h1>

<p align="center">Community-tagged feed filtering. LinkedIn first, Reddit too, one codebase, $0 hosting.</p>

---

You see a post that is obviously generated. You click the splat. It collapses,
with a note saying why and a `[show]` control. Nothing is deleted, and you can
always see what was hidden and undo it.

That is the whole product. Everything below is how it stays that simple across
two sites, four browsers, and eventually a shared list.

## Try it

```bash
pnpm install
pnpm brand      # generate the splat and the icon set
pnpm build      # -> apps/extension/.output/chrome-mv3
```

Then load `apps/extension/.output/chrome-mv3` at `chrome://extensions` with
developer mode on. Or `pnpm dev` for a live-reloading browser.

**It works with no server.** Sharing is off by default: a tag is recorded
locally and hides the post for you immediately. The Worker in `apps/api` is
there for when the shared list is wanted, not before.

## Layout

```
packages/
  core/        pure TS - scoring, taxonomy, decide(). No DOM, no browser.
  adapters/    the ONLY place a CSS selector is allowed to live
  ruleset/     rules.json (ships empty) + the CI gate that guards it
  brand/       the splat, generated from a metaball field
apps/
  extension/   WXT. The only package that knows a browser exists
  api/         Cloudflare Worker + D1. Three routes and a cron
```

Two independent axes. **WXT owns the browser axis** (Chrome, Firefox, Edge,
Safari). **`SiteAdapter` owns the site axis** (LinkedIn, Reddit). Neither leaks
into the other, and the test of that is `packages/adapters/src/adapter.ts`:
if `core` or the shared UI ever needs `if (site === 'linkedin')`, the interface
is missing a method.

## The two interfaces that matter

`decide(features, ctx) -> Verdict` is a pure function. Everything the extension
draws is a render of its output, which is why the behaviour is testable under
`node --test` with no browser in sight.

`SiteAdapter` holds everything platform-specific: selectors, id extraction,
media detection, and **policy**. Policy is per-site on purpose:

|  | LinkedIn | Reddit |
|---|---|---|
| Posts hide at | **1** tag | **3** tags |
| Why | Personalised feeds barely overlap, so waiting for consensus means the post has decayed before the threshold is met | Everyone sees the same `t3_…` objects, so consensus is reachable — and a threshold of 1 would hand one user reach over a whole subreddit |

Your own tag always hides the post for **you**, on either site. Consensus
governs what other people see; it has no business overruling you about your own
feed.

## Commands

| | |
|---|---|
| `pnpm check` | typecheck + unit tests + the ruleset gate |
| `pnpm test` | 112 unit tests across core, adapters, ruleset, the API boundary and the rollup |
| `pnpm --filter @sloppy/extension test:e2e` | builds, loads into real Chromium, drives the whole loop |
| `pnpm brand` | regenerate the splat, icons and path data |
| `pnpm build:all` | Chrome, Firefox and Edge |

## Things worth knowing before you change something

**The splat is generated, not drawn.** `packages/brand/splat.mjs` builds a
metaball field — a lumpy core, small tight lumps on the rim, five fat fingers,
two drips and three droplets — and extracts the outline with marching squares.
Three things make it read as liquid rather than as a starburst: fingers are
**waisted** (widest at the base, pinched in the middle, swelling to a rounded
club), links are spaced **by radius** so an arm stays connected however far it
reaches, and the rim lumps are **small** so the notches between fingers stay
deep. Icons under 48px use a separate, chunkier cut, because at 16px a thin
finger rasterises away to nothing. `sweep.mjs` renders variants side by side at
the sizes they actually ship at.

**Read post ids at click time, never at injection time.** Both feeds virtualise
and recycle DOM nodes, so the element you tagged thirty seconds ago may be a
different post now.

**The observer watches attributes, not just childList.** Recycling frequently
rewrites the id *in place* on an element already in the tree — no node added, no
node removed — so a childList-only observer never fires and a recycled node
keeps showing the previous post's stub. Found by the e2e test, not by reasoning.

**Re-assert light-DOM state every sweep.** A re-render does not only throw our
button away, it throws our attributes away, and those are what the collapse
stylesheet keys off. Re-injecting the button while leaving the post uncollapsed
means a hidden post silently pops back into the feed. Also found by the e2e
test. Every write is guarded by a read first, because setting an attribute to
the value it already has still fires the observer that scheduled the sweep.

**A CI gate is not a runtime gate.** The ruleset carries regular expressions and
arrives over the network from an address the user configures — so checking it
only in CI protects this repository's `rules.json` and nothing anybody executes.
The safety analysis lives in `packages/core/src/pattern-safety.ts` and runs in
both places; the extension drops unsafe rules individually before storing them.
Every response from that server is untrusted input: size-capped while reading,
schema-checked after, and the address must be https.

**A report has to cost something, and promoting a person costs a person.**
`installId` is a client-generated UUID, so the per-install rate limit constrains
honest clients and nobody else. Every tag now carries a proof-of-work stamp
bound to that specific post (`packages/core/src/stamp.ts`), which cannot be
minted once and replayed — roughly 165ms to send one, roughly twenty minutes of
a core to forge ten thousand. And the nightly rollup no longer promotes anyone:
it writes candidates, and a human decides with
`pnpm --filter @sloppy/api authors pending`, because hiding everything an
account posts is the one action here that can affect somebody's livelihood.
Rejections are permanent, and there is an appeal route.
[`docs/TRUST.md`](docs/TRUST.md) · [`docs/APPEALS.md`](docs/APPEALS.md)

**Never `innerHTML`.** LinkedIn enforces Trusted Types. Content scripts are
currently exempt via the isolated world, but that exemption is not ours to rely
on. `createElement` + `textContent` costs nothing and cannot be revoked.

**The shadow root is closed, and that has a testing cost.** `element.shadowRoot`
is null for Playwright exactly as it is for LinkedIn, so the e2e test drives the
UI the way someone without a mouse would: click at the host's coordinates, then
keyboard. Everything it asserts is light-DOM state or extension storage.

**The tag taxonomy describes FORM, never SUBSTANCE.** A style tag ("this is
written one sentence per line") cannot be aimed at someone who does not write
that way. A substance tag ("this is wrong", "this is a lie") is pure ammunition,
and in a small industry where people tag posts by studios they may want work
from, it will be used as such. Substance tags will get requested. Don't. There
is a test asserting none have crept in.

## Where this stands against the plan

Built: **P0** (LinkedIn adapter, splat button, tag picker, collapse stub, fully
local), **P1** (Worker + D1 + snapshot sync, off by default), **P2** (author
rollup, options page), **P4** (rules interpreter wired, ruleset empty, threshold
slider), **P5** (Reddit — one adapter file, zero changes to core), and **P6**
insofar as Firefox and Edge builds are wired.

Not built:

- **`apps/site`**, the static leaderboard. It ranks phrases and volume, which
  needs a corpus that does not exist yet.
- **P3** beyond the scaffolding. The C2PA badge and generator-native dimensions
  are read and scored, but the selectors for LinkedIn's Content Credentials
  marker are a hypothesis — that one needs verifying in devtools against a real
  signed image.
- **Safari / iOS** (P6–P8). `wxt build -b safari` is wired; the Xcode project,
  container app and mobile selectors are not.
- **Volume normalisation in author promotion.** The plan asks that promotion be
  normalised by post volume so prolific accounts do not drift onto the list by
  arithmetic. That needs each author's *total* post count, and Sloppy
  deliberately never records the posts you merely saw — so the denominator does
  not exist. Getting it would mean collecting exactly the browsing signal the
  whole design avoids. What ships instead is the raw 5-posts/2-reporters bar
  plus a per-entity-type split. It is a deliberate trade, written up in
  `apps/api/src/rollup.ts`.

**Every selector in `packages/adapters` is a hypothesis.** They were written
against the plan's appendix and are covered by tests over fabricated markup —
which proves the parsing logic, not that the markup is real. LinkedIn A/B-tests
its DOM and its class names rotate. Verify in devtools before trusting any of
them; that is what the fallback chains and the popup health check are for.

## Privacy

Off by default, and nothing leaves the device in that state. Full disclosure,
written to be pasted into the store listings: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## Licence

MIT.
