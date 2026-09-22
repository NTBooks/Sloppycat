# User reports, and where they should live

Listeners and readers spot this stuff before anyone else. A report from a fan is worth having. It is also the
easiest thing in the system to abuse, so where it lives and what it's allowed to do both matter.

## Recommendation in one line

Keep the assertions on GitHub, put reports in a small Cloudflare Worker with its own D1, publish an aggregated
snapshot back to GitHub on a cron, and never let a report become a verdict.

## Keep it its own thing

Whatever else you run, this should be a separate product: its own name, its own worker, its own database, its
own domain. Sharing a hosting account is fine and costs nothing extra. Sharing a brand is not.

The reason is the pitch. Getting labels, managers and music lawyers to publish lists depends on this looking
like neutral infrastructure that nobody profits from. Anything that reads as a side feature of a bigger
project, or as a bit of fun, gives a rights holder a reason to pass. The audience is different too: the people
this serves are people something was done to.

## Two kinds of data, two different homes

| | Assertions | Reports |
|---|---|---|
| **What** | "This is mine", "this is not mine", attestations | "This looks like AI slop to me" |
| **From** | Rights holders, curators | Anyone |
| **Rate** | Slow, deliberate | Fast, noisy |
| **Stakes** | High: an accusation about a named person | Low on its own |
| **Home** | GitHub repo, pull requests, git history | Worker + D1 |
| **Why** | Auditable, forkable, free, and the trust root must not depend on a server I run | Needs a write endpoint, spam control and rate limiting, which a static file can't do |

## How a report travels

1. **Someone reports.** From the extension's hover card, on explicit click, or from a form on the site for
   people who haven't installed anything. Payload is the platform, the item id, any identifier the page shows
   (ISBN, UPC), and an optional reason. No page-view telemetry, ever: the extension only talks to the endpoint
   when a person presses the button.
2. **The Worker stores it,** rate-limited per IP hash, with Turnstile on the web form. Weighting is
   the usual shape: anonymous counts for something, a GitHub-authenticated report counts for more. A verified
   creator reporting their own profile doesn't go in this pile at all; that belongs in their list.
3. **A cron aggregates** and publishes a snapshot to the registry repo: items at or above a threshold, with
   counts and first-seen dates, as a normal community list with a `## Reported` section.
4. **The extension subscribes** to that snapshot like any other list. No per-page API calls, so nobody's
   browsing history reaches my server, and the hot path stays a static file on a CDN. If the Worker is down,
   the last snapshot still works.
5. **Curators promote,** or don't. A report queue is a place to look, not an output. A row only becomes a
   `Not mine` in the community list when the creator confirms it or two curators sign off with evidence, which
   is the existing rule and doesn't change.

## What a report is allowed to look like

Reports render as a count, in grey: "12 listeners reported this". Never a red badge, never a strikethrough.
Red is reserved for a creator saying it isn't theirs, because that's the only claim with an owner behind it.

That line is the whole defence against brigading. If crowd counts could turn red, then the attack is obvious:
organise fifty accounts and smear a rival's release. With counts capped at a grey advisory, a brigade buys the
attacker nothing except a curator looking at the item, and the creator's own list overrides it instantly.

Also: an item inside a verified creator's `Mine` list suppresses reports about it entirely. The artist saying
"that's my record" ends the argument, which is the correct outcome and also stops the obvious harassment
vector of mass-reporting a real artist's real work.

## Cost

Roughly nothing. Workers and D1 free tiers carry a write endpoint and a nightly aggregate comfortably at this
scale, GitHub serves the snapshot, and the extension reads static files. The thing that would cost money is
per-view API calls from every installed extension, which is exactly what the snapshot design avoids.

## To decide

- A domain for the reporting endpoint and the site, separate from anything else you run, for the neutrality
  reason above.
- Whether GitHub login is offered from day one for weighted reports, or added once volume justifies it.
- Privacy and terms pages before the endpoint accepts anything, covering what a report stores and how a
  creator gets something about them removed.
