# Who gets to speak for a profile

A list says "this is artist X's catalog, and that release isn't theirs". Anyone can write that file about
anyone. So the only interesting question in this project is which lists a browser should believe, and the
answer has to work without accounts, without a server, and without me being a gatekeeper anybody has to trust.

## What ad blockers do, and where it stops being enough

| | How they do it | Does it transfer? |
|---|---|---|
| **EasyList** | Small maintainer team, public git repo, flat files at stable URLs. Anyone proposes a filter by issue or PR; maintainers merge; clients refetch on an expiry. | Yes. Subscribe-by-URL, expiry, ETag, git history as the audit log. |
| **AdGuard** | Same, plus a *filter registry*: a repo holding an index of lists with metadata, reviewed in the open before inclusion. | Yes. This is the "official file people send PRs to". |
| **uBlock Origin** | Ships a curated set, lets you add any URL, and only honors its most powerful filter types from trusted lists, never from an arbitrary subscription. | Yes, and it's the most useful idea here: tier what a list is allowed to assert by how it earned trust. |
| **Adblock Plus** | A central Acceptable Ads whitelist, run by one company, which took payment for inclusion. | As a warning. A central list with a commercial incentive lost the room permanently. |

None of them have our problem. A filter author never has to prove they own anything: a rule about
`example.com/ads.js` is right or wrong on its own terms, and a bad one gets reverted. Our rows are claims of
ownership, so a wrong one is an accusation against a real person, and a malicious one is a way to smear a
competitor's catalog. That part needs identity, and identity is where the ad blocker model runs out.

## Why a central database can't be the root

A database only ever records a claim somebody made to it. If the root of trust is "it's in the database", then
whoever administers the database is the target: social engineering, a bad hire, a subpoena, or just me getting
it wrong on a Tuesday. It also puts me in the Eyeo position, where the thing everyone depends on is a list I
control and could be paid to change.

The platform bio is a better root, because the scammer has no way in. Editing the bio on a Spotify artist
profile requires Spotify for Artists access for that artist. Author Central, same. That's the one fact in this
whole system that an attacker can't forge, and it's the same trick as a DNS TXT record for domain validation,
or Keybase proofs.

So: **the bio link is the root, and everything else is a cache of that check.**

## The three layers

**1. Proof, at the platform.** The creator publishes a list anywhere with a URL, then pastes that URL into a
bio only they control. The list names the profile; the profile points at the list. Both directions have to
match, and the second direction is the one that matters, because it's the one a stranger can't write.

**2. Registry, on GitHub.** A public repo holding the index: which list URL claims which profiles, who checked
it, when, and a link to the evidence. Entries arrive as pull requests. A maintainer verifies the bio link at
merge time and says so in the review. Git history is the audit log, and anyone can fork the registry and point
their clients at their own copy, which is the escape hatch that keeps a maintainer honest.

The registry is published as a normal community list with an `## Attested` section, so it needs no special
code path and no server. Raw GitHub is the CDN.

**3. Client, in the browser.** Each copy decides for itself, and only two routes lead to a badge:

- it checked the bio itself, cached for 30 days, which happens lazily the first time you land on a page where
  that list has something to say;
- or a registry you subscribed to attests the claim, and subscribing to that registry was your decision, the
  same way subscribing to EasyList is.

An unproven claim renders nothing at all. Not a warning, not a grey badge, nothing. So publishing a forged
list about Taylor Swift's catalog gets a scammer a file that no browser will act on.

## Can't a user just fake it with DevTools?

Yes, and it doesn't matter. There is no server here that believes the client. If you open DevTools and mark a
list verified in your own extension storage, the only thing you've changed is what your own browser shows you.
Client-side checks are only dangerous when something downstream trusts the client's answer, and nothing does:
every viewer's copy does the check for itself, against the platform, and caches its own result.

The thing that must never happen is the reverse: a *server* accepting "I verified this" from a client. If the
registry ever grows automation, the check has to run on the registry's side, with the evidence recorded, or
not at all.

## Tiering, borrowed from uBlock

Not all rows are equally dangerous, so they don't all need the same proof.

| Row | Needs |
|---|---|
| `Mine` (green) | A proved claim over that profile. Worst case a creator over-claims their own catalog. |
| `Not mine` (red) | A proved claim over the profile the item sits on, or a registry attestation with evidence. This is an accusation, so it gets the strictest route. |
| `Likely accurate` (blue) | Nothing but a date. It's derived from the cutoff, and says only that the release predates the slop wave. |
| Heuristic signals | Never published at all. They exist to tell a creator where to look. |

## What's still open

- **Platforms with no editable bio.** Apple Music, Deezer and Google Books give a creator nowhere to put the
  link, so a claim there can't be self-proved. For now those rely on registry attestation, where a curator
  checks the artist's proof on a platform that does have a bio and records the cross-reference explicitly.
  Never inferred automatically from a name match.
- **Bio link removal.** If a platform strips URLs from bios, the fallback is a well-known file on the
  creator's own domain plus that domain in the profile, which is weaker but still outside the scammer's reach.
- **Registry capture.** The mitigations are that the rules are mechanical and public, the evidence is in the
  history, the default registry can be disabled in Settings like any other list, and forking it takes minutes.
  There is nothing to sell, and there will be no paid inclusion, ever. That is the whole Eyeo lesson.
- **Scale.** A registry with thousands of entries should ship as a generated JSON index next to the Markdown,
  so clients don't parse a huge file. Format stays the same; only the transport changes.
