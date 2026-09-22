<img src="assets/icons/png/icon-128.png" width="72" align="right" alt="">

# Sloppycat

**The ad blocker for fake releases.** Artists and authors verify their own catalogs; everyone else sees it.

Scammers upload AI-generated songs and books under real creators' names. In music they lie to a cheap
distributor, the release maps onto the real artist's profile, and they collect the royalties. In books they
publish under a real author's name, or clone a hot title. Platforms are slow: Spotify's Artist Profile
Protection, which lets an artist approve releases before they attach, is still a limited beta, and no book
platform has an equivalent.

Sloppycat is two things in one extension:

- **Creator mode.** Snapshot your public profiles, untick anything that isn't yours, and get a ready-to-send
  takedown packet for each one. Then it watches those profiles and alerts you when something new appears.
- **Blocker mode.** Subscribe to lists, uBlock-style. Badges appear on Spotify, Apple Music, Amazon and
  Goodreads pages: green when the creator verified it, red when the creator says it isn't theirs. Hover for a
  report card with the AI-disclosure the creator attached.

It is a band-aid over a problem the platforms should fix. It is also the only thing an independent creator
can do today, and it works on the platforms that have no verification at all.

## Status

Early. The core works and is tested; nothing has been published to the Chrome Web Store, and the default
community list URL in `src/lists/sources.ts` points at a repo that does not exist yet.

## Install for development

```bash
npm install && npm run build
```

Then load `dist/` at `chrome://extensions` with Developer mode on. `npm run watch` rebuilds on change.

```bash
npm test         # unit tests, including parsers run against real captured pages
npm run typecheck
npm run icons    # re-rasterize the icon from assets/icons/sloppycat.svg
npm run preview  # serve the UI pages with a stubbed chrome.* API, for layout checks
```

## How it gets the data

| Platform | Method | Notes |
|---|---|---|
| Spotify | Reads the artist response the web player itself loads | No usable public API since the Feb 2026 dev-mode changes. Gives the 10 newest albums and singles, which is where a hijack lands. |
| Apple Music | iTunes lookup API | Free, no key. |
| Deezer | Public API | Free, no key. |
| Amazon Books | Renders the author's store pages in a hidden tab | Author pages are JavaScript-rendered. Runs in your own session, so it looks like ordinary browsing. |
| Goodreads | Fetches the author list pages | Server-rendered; no API since 2020. |
| Google Books | Volumes API | Used as a lookalike-search signal only. |

Checks run on a configurable interval (default 60 minutes, minimum 15) and only while Chrome is open, because
that is the limit of what an extension can do. A hosted version would fix that; the JSON-based adapters port
to a server unchanged.

## Verification without accounts

You publish your list anywhere (a GitHub Gist is easiest), then paste its URL into a bio only you can edit:
Spotify for Artists, Amazon Author Central, or a claimed Goodreads profile. The extension checks the bio points
at the list and the list names that profile. Both directions must match. No sign-up, no server, no accounts.

## Documentation

- [List format](docs/list-format.md) — the Markdown format, and how to publish and claim a list.
- [Phase 2: the default list](docs/baseline-plan.md) — the cutoff date, who to cover first, and the jobs.
- [Contributing to the community list](lists/CONTRIBUTING.md) — the evidence bar for accusing a listing.
- [Marketing plan](docs/marketing.md) — positioning, audiences, launch sequence.

## What it deliberately does not do

- **It is not an AI detector.** Spotify, Deezer and other extensions already badge AI-generated music, and that
  misses hijacks entirely: a fake on a real artist's page is credited to a human. The only reliable authority on
  whether a release is genuine is the creator, so that is whose word the badges carry.
- **It does not file takedowns for you.** It writes the packet and tells you where to send it.
- **It does not accuse anyone on a hunch.** Heuristics like a distributor placeholder label are shown to the
  creator as context, never published as a verdict.
