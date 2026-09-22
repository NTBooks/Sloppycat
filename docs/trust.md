# Who gets to speak for a profile

A list says "this is artist X's catalog, and that release isn't theirs". Anyone can write that file about
anyone. So the only interesting question in this project is which lists a browser should believe, and the
answer has to work without accounts, without a server, and without me being a gatekeeper anybody has to trust.

The answer is that the browser doesn't decide. You do, by adding a list. Nothing arrives on its own, nothing
is bundled that you can't remove, and dropping a list drops everything it ever said. That is the whole root.
Everything below is either where that idea came from, or what the extension does on top of it once you have
made the choice.

## What ad blockers do

| | How they do it | Does it transfer? |
|---|---|---|
| **EasyList** | Small maintainer team, public git repo, flat files at stable URLs. Anyone proposes a filter by issue or PR; maintainers merge; clients refetch on an expiry. | Yes, and it's the model: subscribe-by-URL, expiry, ETag, git history as the audit log. |
| **AdGuard** | Same, plus a *filter registry*: a repo holding an index of lists with metadata, reviewed in the open before inclusion. | Yes. This is the "official file people send PRs to". |
| **uBlock Origin** | Ships a curated set, lets you add any URL, and only honors its most powerful filter types from trusted lists, never from an arbitrary subscription. | Partly. The escape hatch transfers. The tiering doesn't, for the reason two sections down. |
| **Adblock Plus** | A central Acceptable Ads whitelist, run by one company, which took payment for inclusion. | As a warning. A central list with a commercial incentive lost the room permanently. |

Our rows are unlike a filter rule in one way that matters. A rule about `example.com/ads.js` is right or wrong
on its own terms, and a bad one gets reverted. A row here is a claim of ownership, so a wrong one is an
accusation against a real person, and a malicious one is a way to smear a competitor's catalog.

That's a real difference, and for a while I thought it meant this project needed an identity layer that ad
blockers don't. What limits the damage instead turns out to be the same thing that limits a bad filter rule:
the accusation is only ever visible to someone who went and added the list it came from, every card names
that list, and removing it is one click. A list that accuses people falsely loses its subscribers, which is
the only sanction that has ever worked on a filter list either.

## Why the root isn't a database, and isn't me

A database only ever records a claim somebody made to it. If the root of trust is "it's in the database", then
whoever administers the database is the target: social engineering, a bad hire, a subpoena, or just me getting
it wrong on a Tuesday. It also puts me in the Eyeo position, where the thing everyone depends on is a list I
control and could be paid to change.

So there is no database. The extension ships with defaults you can delete, and if you delete all of them it
has nothing to say about anything.

## Why the bio link isn't a requirement either

There is a genuinely unforgeable signal available here, and it's worth explaining, because an earlier version
of this document made it the root and I think that was a mistake.

A creator can publish their list anywhere with a URL, then paste that URL into a bio only they control.
Editing the bio on a Spotify artist profile requires Spotify for Artists access for that artist. Author
Central, same. The list names the profile, the profile names the list back, and a scammer can't write the
second direction. It's the same trick as a DNS TXT record for domain validation, or a Keybase proof.

It's a good signal. It can't be a requirement, for three reasons:

1. **It only exists on some platforms.** Apple Music, Deezer and Google Books give a creator nowhere to put a
   link. Gating on the bio check would mean the extension does nothing at all on those platforms, forever,
   through no fault of the artist.
2. **It has to stay up forever to keep working.** A client re-checks every 30 days. An artist who rewrites
   their bio for a tour announcement, or runs into a character limit, silently turns off their own badges for
   every subscriber, and nobody involved gets told why. Asking artists to treat a line of bio real estate as
   permanent infrastructure is not a thing that survives contact with real artists.
3. **Platforms can take it away.** If Spotify strips URLs from bios next quarter, a design rooted in the bio
   link stops working that day, everywhere, and there is nothing I can do about it.

So proof is a label on a list you already chose, never a gate. When a creator does put the link up, the
viewer's own browser confirms it against the platform and the card says so. When they don't, the card says
that too, and the rows still render.

## The routes

`routeFor` in [`src/lists/claims.ts`](../src/lists/claims.ts) records how a list came to be speaking on a
page. Every one of these renders. The difference between them is what the card says underneath.

| Route | Means | Card says |
|---|---|---|
| `own-list` | Your own decisions about your own catalog | Your own list |
| `self-checked` | This browser read the creator's bio and it pointed back, cached 30 days | Your browser checked this against the artist's profile |
| `attested` | A community list you subscribe to recorded that check, with evidence | Checked by *(that list)* |
| `community` | A community list you subscribe to, vouching for itself | A list you subscribe to |
| `unproved` | A creator list you added that nothing has corroborated yet | A list you added. Nothing has checked it against the artist's profile. |

The check runs lazily, the first time you land on a page where that list has something to say, and only for
creator lists that claim that profile. It's an upgrade, so a failure costs nothing but the label.

## Row types

Not all rows say the same kind of thing, and the card shouldn't pretend they do.

| Row | What it actually asserts |
|---|---|
| `Mine` (green) | A creator vouching for their own release. Worst case they over-claim their own catalog. |
| `Not mine` (red) | An accusation. It carries the route and the list name, so a reader can see who is making it and on what basis. |
| `Likely accurate` (blue) | Nothing but a date. It's derived from the cutoff, and says only that the release predates the slop wave. |
| Heuristic signals | Never published at all. They exist to tell a creator where to look. |

## How a creator takes something back

The list is fetched from a URL the creator controls, so the list is the revocation channel. Edit the file, and
on the next refresh every subscriber has the new version. I think that's better than the bio link ever was:
it's per-row rather than all-or-nothing, and it doesn't depend on a platform continuing to allow links.

A community list revokes the same way. The one thing nobody can revoke is a copy somebody has deliberately
pinned, which is true of every subscription system and isn't worth pretending otherwise.

## Can't a user just fake it with DevTools?

Yes, and it doesn't matter. There is no server here that believes the client. If you open DevTools and mark a
list corroborated in your own extension storage, the only thing you've changed is what your own browser shows
you. Client-side checks are only dangerous when something downstream trusts the client's answer, and nothing
does.

The thing that must never happen is the reverse: a *server* accepting "I verified this" from a client. If the
registry ever grows automation, the check has to run on the registry's side, with the evidence recorded, or
not at all.

## The registry

There's still a public repo holding an index: which list claims which profiles, who checked it, when, and a
link to the evidence. Entries arrive as pull requests, a maintainer verifies the bio link at merge time and
says so in the review, and git history is the audit log.

It isn't a root, and nothing depends on it. It's a convenience, so a creator who proves themselves once can
take the link back out of their bio and subscribers still see the check. Anyone can fork it and point their
clients at their own copy, which is the escape hatch that keeps a maintainer honest. It ships as a normal
community list with an `## Attested` section, so it needs no special code path and no server. Raw GitHub is
the CDN.

## What's still open

- **Discovery.** Subscription as the root only works if finding a good list is easy. Right now it isn't, and
  that's the weakest part of this design. It's the same problem EasyList solved with fifteen years of word of
  mouth, and I don't have a shortcut.
- **A list that goes bad.** The sanction is unsubscribing, which requires noticing. A changelog view, so you
  can see what a list started asserting since you added it, would help and doesn't exist yet.
- **Registry capture.** The mitigations are that the rules are mechanical and public, the evidence is in the
  history, the default registry can be disabled in Settings like any other list, and forking it takes minutes.
  There is nothing to sell, and there will be no paid inclusion, ever. That is the whole Eyeo lesson.
- **Scale.** A registry with thousands of entries should ship as a generated JSON index next to the Markdown,
  so clients don't parse a huge file. Format stays the same; only the transport changes.
