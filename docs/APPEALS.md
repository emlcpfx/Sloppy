# If Sloppy is hiding your posts

Sloppy can hide a post because people tagged that specific post, or because an
account was added to a reviewed list of repeat posters. This page is how to get
that undone.

**A blocklist without a right of reply is a reputation system without a right of
reply.** This exists so that isn't what Sloppy is.

## First: it may not be what you think

Sloppy is a browser extension that individual people choose to install. It does
not touch your account, your reach, or what LinkedIn or Reddit show anybody. It
only changes what a reader sees in their own browser, and every hide shows the
reason with a **show** control next to it.

Nobody is prevented from reading your posts. Some readers have collapsed them by
default.

## How to appeal

Open an issue on the repository titled `appeal: <your profile URL>`, or email
the address in the store listing. Include:

- The profile the hiding applies to.
- Anything you want considered.

You do not have to argue a case. "I'd like off the list" is enough to get it
looked at again.

## What happens then

1. The decision and its note are looked up.
2. Unless the original reason still clearly holds, the account is removed.
3. Removal is **permanent and sticky** — `author_decisions` records the
   rejection, so the nightly rollup cannot re-propose the same account. You will
   not have to appeal twice for the same thing.

Removing an account is one command:

```bash
pnpm --filter @sloppy/api authors reject <authorId> <site> "appeal upheld"
```

The change reaches readers on their next snapshot sync, within a day.

## What cannot be appealed

**Individual post hides.** If several readers tagged one post as generated, that
post stays tagged; the tag describes the post, not you, and it ages out of the
14-day window on its own. Appeals are for the account-level list, which is the
part that carries across everything you write.

**Somebody's own settings.** Anyone can tag anything for themselves, and their
tags hide posts only in their own feed. That is not a list and there is nothing
to appeal — it is a person using a filter.

## How an account gets on the list at all

Not automatically. The nightly job proposes candidates — accounts with at least
five distinct tagged posts from at least two distinct installs inside a 90-day
window — and writes them to `author_candidates`, which is served to nobody.
A person then reviews the actual posts and decides.

That gate exists because promoting an account hides *everything* it posts, which
is the one action here that can affect somebody's work. A counter crossing a
threshold is not a good enough reason, particularly since anybody can write to
the tag endpoint (see [TRUST.md](TRUST.md)).

## The standard being applied

The tag vocabulary is deliberately about **form**, never substance — how a post
is written, not whether it is true, useful, or agreeable. Approval means "this
account reliably posts in this form." It does not mean the account is bad, and
it is not a judgement anybody should read as one.

If you find an approved account where the honest answer is "I disagree with what
they say," that is a mistake and removing it is not a favour.
