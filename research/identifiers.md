# Identifiers: what a claim should be keyed on

Researched 2026-09-22.

A list row has to name a thing. Which identifier it names decides whether a claim survives a re-upload, and
whether it can be checked anywhere other than the site it came from.

## ASIN is a shelf number, not an identity

Amazon assigns an ASIN to every listing. A new format gets a new ASIN, and an uploader gets one for free, so
"ASIN X is not mine" says nothing about the identical book re-uploaded tomorrow as ASIN Y. Crucially, **KDP
ebooks don't require an ISBN at all**: publish without one and Amazon simply assigns an ASIN. So the cheapest
path to publishing a knockoff is also the path that avoids the stronger identifier.

Sources:
[KDP: what is an ISBN](https://kdp.amazon.com/en_US/help/topic/G7DMSKCM9DVS65TC) ·
[ASIN](https://en.wikipedia.org/wiki/Amazon_Standard_Identification_Number)

## What's worth keying on

| Identifier | Covers | Why it helps | Limits |
|---|---|---|---|
| **ISBN** (13 or 10) | A book edition | Registered to a publisher, who pays for the block. Travels across Amazon, Goodreads, Google Books, Open Library and library catalogs, so one claim can be checked in several places. | Optional for KDP ebooks. A free KDP-assigned ISBN is tied to Amazon as the publisher of record. |
| **ISRC** | A recording | The recording's identity, independent of which release it appears on. | Not shown on public streaming pages; comes from the distributor or the label's own systems. |
| **UPC / EAN** | A release | What platforms and distributors key deliveries on. It's the number a takedown ticket wants. | Same: not published on the artist page, so the artist supplies it. |
| **MBID** | MusicBrainz entity | Stable id with links out to Spotify, Discogs and others, which makes it the glue for cross-platform matching. | Community-maintained, so it's a mapping, never proof of ownership. |
| **Discogs release id** | A release | Deep coverage of physical and older catalog that streaming metadata handles badly. | Community-maintained. |
| **Open Library id** | A book work or edition | Free, no key, maps ISBNs to works and authors. | Coverage is patchy for new self-published titles. |

So the format takes optional `isrc`, `upc`, `isbn`, `mbid`, `discogs` and `olid` columns beside the platform
id. The platform id is what the badge matches on the page you're looking at; the others are what let the same
claim be recognised elsewhere, including after a re-upload under a new ASIN.

## What MusicBrainz and Discogs are, and aren't, good for

Both are community-built. Neither is a rights-holder assertion, so neither can settle "is this really theirs".
What they can do is real and useful:

1. **Build the baseline cheaply.** MusicBrainz has artists, release groups, dates, labels and external URL
   relationships pointing at Spotify and others. That's most of what the phase-2 `baseline-catalog` job needs,
   for free, without scraping anyone. Discogs adds depth on older and physical releases.
2. **Map across platforms.** An MBID with a Spotify release-URL relationship is how a claim written against
   one platform gets recognised on another.
3. **Corroborate, never convict.** A 2026 release on an artist's page that appears in no external database, on
   a distributor placeholder label, with no ISRC, is worth a curator's attention. That's a reason to look, and
   the same rule as every other signal: it never renders as a verdict.

**Terms, checked 2026-09-22.** MusicBrainz core data is CC0; the API asks for about one request per second and
a User-Agent that identifies the application and a contact. Discogs database data is available under CC0, with
25 requests per minute unauthenticated and 60 authenticated, and their API terms restrict some non-database
("restricted") data from commercial use. Both are easily inside what a batch job needs; neither belongs in the
extension's hot path.

Sources:
[MusicBrainz rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) ·
[MusicBrainz release-URL relationships](https://musicbrainz.org/relationships/release-url) ·
[MusicBrainz](https://en.wikipedia.org/wiki/MusicBrainz) ·
[Discogs API terms](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) ·
[Discogs API docs](https://www.discogs.com/developers)

## The industry already has this data privately

Labels and distributors send release metadata to the platforms as DDEX ERN messages: titles, artists, ISRCs,
UPCs, artwork, territories, deal terms. Publishers send ONIX. Every sender knows precisely which releases are
theirs.

What nobody publishes is a public, machine-readable statement of that, from the owner, that a browser can
check. The public databases are community-built and answer a different question. That gap is the whole reason
this extension has to ask artists directly, and it's also why a label publishing a list is cheap for them: it
is an export of something they already hold.

Sources:
[DDEX ERN structure](https://kb.ddex.net/implementing-each-standard/electronic-release-notification-message-suite-(ern)/ern-4-explained/ern-4-structure/) ·
[DDEX implementation](https://kb.ddex.net/implementing-each-standard/)
