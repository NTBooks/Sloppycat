# Sloppycat privacy policy

Last updated: 22 September 2026

Sloppycat is a browser extension that watches a creator's own public profiles for releases they didn't
publish, and marks items that creators have publicly disowned.

## What it collects

**Nothing.** There is no account, no server run by this project, no analytics, no telemetry, and no
identifier of any kind assigned to you.

Everything the extension records is stored by Chrome on your own computer, in the extension's local storage,
and is readable only by the extension. That includes:

- the profiles you chose to watch and the catalog snapshots taken from them,
- alerts and the decisions you made about them,
- your own list, until you choose to publish it somewhere,
- the list subscriptions you added and a cached copy of each list,
- your settings.

You can delete all of it at any time by removing the extension, or piece by piece in Settings.

## What it sends, and to whom

The extension makes requests to these places, and no others:

| Where | Why | When |
|---|---|---|
| The platforms you watch (Spotify, Apple Music, Deezer, Amazon, Goodreads, Google Books) | To read the public catalog of the profiles you added, the same pages your browser would load if you visited them | On the schedule you set, and when you press a button |
| The list URLs you subscribed to | To fetch those lists | On the list's refresh interval |
| GitHub, if you choose to sign in | To create or update your own list as a Gist, at your request | Only when you ask |

Requests to the platforms are made by your browser, in your own session, and look like ordinary browsing.
No copy of what you browse is sent anywhere. In particular, the extension does **not** report the pages you
visit to this project or anyone else: when it marks items on a page, it checks them against lists already
cached on your computer.

## What it does not do

- It does not collect personal information, browsing history, credentials, payment details, health, location
  or anything of the kind.
- It does not sell or share data, because it has none to sell or share.
- It does not run remote code. All code ships in the extension package.
- It does not transmit your list anywhere unless you publish it yourself.

## Permissions, and why each one exists

- **storage** — keeps your watched profiles, snapshots, decisions and settings on your computer.
- **alarms** — schedules the periodic check. Without it, checks would stop when the browser worker sleeps.
- **notifications** — tells you when something new appears on a profile you watch.
- **tabs** and **scripting** — reads the public catalog from a platform page, and marks items on pages when
  you have turned that on. Used only on the sites listed below.
- **offscreen** — parses saved HTML from a platform page. Chrome's extension worker cannot parse HTML on its
  own, and this keeps the work off the page you are reading.
- **host permissions** for `open.spotify.com`, `music.apple.com`, `itunes.apple.com`, `api.deezer.com`,
  `deezer.com`, `amazon.com` and its country domains, `goodreads.com`, `googleapis.com`, `openlibrary.org`,
  `api-partner.spotify.com` — the platforms whose catalogs it reads; and `raw.githubusercontent.com`,
  `gist.githubusercontent.com`, `gist.github.com`, `api.github.com`, `github.com` — where lists are fetched
  from and, at your request, published to.

## Children

The extension is not directed at children and collects nothing from anyone.

## Changes

Any change to this policy will be committed to the public repository, so the history of what was promised is
part of the record: <https://github.com/NTBooks/Sloppycat>

## Contact

Open an issue at <https://github.com/NTBooks/Sloppycat/issues>, or write to sloptrawler@gmail.com.

The published copy of this policy, which is the URL given to the Chrome Web Store, is
<https://ntbooks.github.io/Sloppycat/docs/privacy.html>.
