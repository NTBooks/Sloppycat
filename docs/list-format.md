# Sloppycat list format (v1)

A list is a Markdown file. GitHub renders it, humans can read it, pull requests can review it, and the
extension parses a strict subset: `Key: value` headers, then `##` sections containing pipe tables.

Anything the parser doesn't recognize is ignored with a warning, so you can write prose around the tables.

## Example

```markdown
# Jane Doe — verified catalog
<!-- sloppycat/v1 -->
Title: Jane Doe — verified catalog
Type: creator
Homepage: https://janedoe.example
Version: 2026-09-22
Expires: 7 days

## Creator
| platform | profile |
|---|---|
| spotify | https://open.spotify.com/artist/0123456789abcdefghijkl |
| amazon | https://www.amazon.com/stores/author/B000APXXXX |

## Mine
| platform | id | title | disclosure |
|---|---|---|---|
| spotify | 4aBcdefghijklmnopqrstu | Blue Room | vocals:human; art:ai-generated |
| amazon | B0C1234567 | The Long Field | text:human; cover:ai-assisted |

## Not mine
| platform | id | title | first seen | note |
|---|---|---|---|---|
| spotify | 9xYcdefghijklmnopqrstu | Midnight Jazz Vibes | 2026-09-14 | delivered via 8412 Records DK; reported to Spotify for Artists 2026-09-15 |
```

## Headers

| Header | Required | Meaning |
|---|---|---|
| `Title` | yes | Shown in the report card and the list-sources table. |
| `Type` | yes | `creator` (one creator's own catalog) or `community` (curated, aggregates others). |
| `Homepage` | no | Where to learn more. |
| `Version` | no | Free text; a date is conventional. |
| `Expires` | no | Refresh interval, e.g. `7 days`, `6 hours`. Default 6 hours. |
| `Baseline-before` | no | ISO date. Items in `## Likely accurate` are presumed genuine because they predate it. |

The `<!-- sloppycat/v1 -->` marker identifies the format. Its absence is a warning, not an error.

## Sections

**`## Creator`** — which public profiles this list speaks for. Required for `Type: creator`.
Columns: `platform`, `profile` (full URL).

**`## Mine`** — items the creator confirms are theirs. Columns: `platform`, `id`, `title`, `disclosure`.

**`## Not mine`** — items the creator says are not theirs. Columns: `platform`, `id`, `title`,
`first seen`, `note`, and on community lists `source` (the creator list the claim came from).

**`## Likely accurate`** — items that predate `Baseline-before` and are presumed genuine but are not
creator-verified. Columns: `platform`, `id`, `title`, `released`. See [baseline-plan.md](baseline-plan.md).

## Platforms and ids

| platform | id | from |
|---|---|---|
| `spotify` | 22-char album id | `open.spotify.com/album/<id>` |
| `apple` | numeric album id | `music.apple.com/…/album/…/<id>` |
| `deezer` | numeric album id | `deezer.com/album/<id>` |
| `amazon` | ASIN | `amazon.com/dp/<ASIN>` |
| `goodreads` | numeric book id | `goodreads.com/book/show/<id>` |
| `googlebooks` | volume id | `books.google.com/books?id=<id>` |

A literal `|` inside a cell is escaped as `\|`.

## Disclosure

Semicolon-separated `key:value` pairs, mirroring what the platforms themselves collect.

- Music keys (as in Spotify's DDEX-based AI credits): `vocals`, `instruments`, `postproduction`, `art`, `lyrics`
- Book keys (as in Amazon KDP's disclosure): `text`, `images`, `cover`, `translation`
- Values: `human`, `ai-assisted`, `ai-generated`

Unknown keys and values are preserved and displayed verbatim, so the vocabulary can grow without a format change.

## Publishing and claiming

1. Publish the file at any URL the extension can fetch: a GitHub Gist raw URL, a repo raw URL, your own site.
2. Put that URL in a bio only you can edit: Spotify for Artists, Amazon Author Central, or a claimed
   Goodreads profile. The extension reads the bio, fetches the list, and checks that the list's
   `## Creator` table names that same profile. Both directions must match, which is what makes the claim
   meaningful. `sloppycat:<gist-id>` is accepted as a short form.

## Precedence

For one item id: an explicit `Not mine` beats `Mine`; a creator list beats a community list; `Likely accurate`
applies only when nothing else matches. Items on an enrolled creator's profile that appear in no section are
shown as "not yet confirmed".
