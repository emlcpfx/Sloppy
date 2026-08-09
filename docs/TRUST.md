# The open question: anyone can write to the list

**Status: unresolved. This blocks P1 (sharing), not P0.**

Sharing is off by default and there is no deployed server, so nothing here is
currently exploitable. It needs deciding *before* a server exists, because the
answer is architectural rather than a patch.

## The problem

`POST /tag` has no authentication. `installId` is a UUID the client generates
and sends in the body. Nothing ties it to a person, a browser, or a cost.

That makes every threshold in the design a formality:

| Bar | What it costs an attacker |
|---|---|
| Rate limit, 300 tags/hour per install | One new UUID. It constrains honest clients only. |
| Hide a post on LinkedIn (`postHideThreshold: 1`) | **One** unauthenticated request. |
| Hide a post on Reddit (`postHideThreshold: 3`) | Three requests, three UUIDs. |
| Promote an author (5 posts, 2 distinct reporters) | **Ten** requests, two UUIDs. |

Promoting an author hides *everything they post* for every user subscribed to
that tag. So ten HTTP requests silence a named person across the whole install
base, for as long as the 90-day window keeps rolling forward.

This is precisely the harm the plan set out to avoid. §8 chose to rank phrases
and volume rather than people, specifically "to remove the incentive to farm
flags against a named target, which matters more in a small industry where
people are tagging posts by studios they might want work from." The leaderboard
avoids naming people. The blocklist does not — it is a mechanism for
suppressing them, and right now it is unauthenticated.

## Why the obvious fixes do not work

**Rate limiting harder.** The limit is keyed on a value the attacker chooses.
Any per-install limit is bypassed by minting installs.

**Keying on IP instead.** Cheap to rotate, and it punishes shared networks — a
studio behind one NAT is exactly the population this tool is for.

**Raising the thresholds.** Raising `authorReporters` from 2 to 20 raises the
attacker's cost from two UUIDs to twenty, which is no cost at all, while making
the feature useless for a genuine community of thirty people. It hurts only the
honest side.

**Requiring more consensus generally.** Same shape. On LinkedIn, single-tag
propagation is load-bearing — personalised feeds barely overlap, so waiting for
consensus means the post has decayed before the threshold is met (§A.1). The
design already committed to `postHideThreshold: 1` for a real reason.

The problem is not the numbers. It is that a report costs nothing to
manufacture.

## Options, roughly in order of cost to build

**1. Ship local-only. Don't build the shared list.**
P0 already works and is genuinely useful: your own tags hide your own feed.
This is the current default and it has no sybil surface at all, because there
is no server. The cost is that the community-tagging premise never gets tested.

**2. Make writes cost something.** A proof-of-work stamp on each tag, or a
Cloudflare Turnstile token. Turnstile is free, invisible for most people, and
raises the cost of ten thousand fake reports considerably. It does not stop a
determined attacker with a browser farm — it stops a shell script, which is the
realistic threat at this scale. Cheapest thing that actually changes the
economics.

**3. Require an account for writing, keep reading anonymous.**
Reading the list stays unauthenticated and unlogged, so the privacy property
that matters — the server never learns what you looked at — is untouched. Only
tagging needs identity. GitHub OAuth costs nothing and gives an account with an
age and a history, which is far harder to mint in bulk than a UUID. The cost is
that it contradicts "no accounts, no email, no OAuth" in §4, and it will reduce
tagging.

**4. Author promotion becomes human-curated.**
Keep post-level hides automatic and unauthenticated — the blast radius of a bad
post hide is one post, and it is visible and reversible. Make *author*
promotion, the part that can silence a person, require a human to approve it.
At community scale that is a handful of decisions a week. This does not fix
post-level poisoning but it removes the part that can hurt someone's
livelihood.

**5. Weight reporters by history.** The schema already stores tuples rather than
counters specifically so this can be computed retroactively (§11): an install
that has been tagging plausibly for months counts for more than one that
appeared this morning. Real, but it is scale infrastructure, and a new
deployment has no history to weight with.

## What is worth doing

Probably **4 + 2**: automatic post hides with a Turnstile stamp, and author
promotion gated on a human. That keeps the product's premise, keeps writes
anonymous, and puts a person in front of the only decision that can damage
someone.

**Whatever is chosen, one thing should ship with it:** an appeal route. If a
name lands on the author list, they need somewhere to say so, and it needs to
be findable by someone who has just discovered their posts are being hidden and
does not know why. A blocklist without an appeal is a reputation system with no
right of reply.

## Related and unfixed

- **The tags table is a per-person profile.** `(install_id, post_id, author_id,
  ts)` means the server holds, per install, the set of posts that person flagged
  and when — keyed to an ID that lives in `storage.sync` and therefore follows
  them across devices. `docs/PRIVACY.md` is accurate that Sloppy never records
  what you *viewed*; it should also say plainly that what you *tagged* is
  retained and linkable. Coarsening `ts` to the day and adding a deletion path
  both help and neither is hard.
- **There is no way for a user to withdraw their tags** from the server once
  sent.
