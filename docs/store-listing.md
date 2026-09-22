# Chrome Web Store submission notes

Everything the dashboard asks for, written out, so a submission is copy and paste rather than improvisation.
Keep this in step with the manifest: the reviewer cross-checks the listing, the manifest and the privacy
policy against each other, and a mismatch is the most common reason for a rejection.

## Single purpose

> Sloppycat monitors a creator's own public profiles on music and book platforms for releases published under
> their name that they did not publish, and marks items that creators have publicly disowned.

Everything in the extension serves that: reading a profile's catalog, alerting on changes, drafting the
platform's takedown form, and marking items from lists creators publish. There is no second purpose.

## Listing copy

**Name:** Sloppycat

**Summary (132 characters max):**

> Watches your artist or author profiles for releases you didn't publish, writes the takedown, and marks
> fakes for listeners.

**Category:** Productivity

**Description:**

> Someone uploads an AI-generated track through a cheap distributor, claims it's yours, and it lands on your
> artist page next to your real records. The royalties go to them. Your fans think it's you. The same thing
> happens to authors: your name on a book you didn't write, or a title one word off yours.
>
> Sloppycat snapshots your own profiles on Spotify, Apple Music, Deezer, Amazon and Goodreads. You untick
> anything that isn't yours, and it hands you the takedown letter for each one: the right form for that
> platform, with your links and the release id already filled in. Then it watches those profiles on a timer
> and tells you when something new turns up.
>
> It is not an AI detector. A fake on your page is credited to a human, so detection misses it entirely. The
> only person who knows whether a release is yours is you, so yours is the word it carries.
>
> Creators can publish what they confirmed as a plain Markdown list. Other people can subscribe to those
> lists, the way you subscribe to filter lists in an ad blocker, and see disowned items marked on the page.
> Those blocker features are experimental and switched off until you turn them on, and they only work in the
> web client.
>
> No account, no server, no telemetry. Everything stays in your browser. Open source, MIT licensed:
> https://github.com/NTBooks/Sloppycat

## Permission justifications

Paste each into the matching box. Keep them literal; a reviewer checks them against the code.

- **storage** — Stores the profiles the user chose to watch, catalog snapshots, alerts and settings locally.
  Nothing leaves the browser.
- **alarms** — Runs the periodic check on the user's chosen interval. Chrome terminates the extension worker
  between events, so timers are not an option.
- **notifications** — Tells the user when a release they did not publish appears on a profile they watch.
- **tabs** — Detects when the user is on a supported profile page so the popup can offer to snapshot it, and
  opens the extension's own pages.
- **scripting** — Reads the public catalog from a supported platform page, and marks items on those pages
  when the user turns that feature on. Injected only into the declared host permissions.
- **offscreen** — Parses saved HTML from a platform page with DOMParser, which is unavailable in the
  extension service worker.
- **Host permissions** — Reads the public catalog pages of the platforms the user watches
  (Spotify, Apple Music, Deezer, Amazon, Goodreads, Google Books, Open Library), and fetches the lists the
  user subscribed to from GitHub, publishing the user's own list there at their request.

**Remote code:** none. All code ships in the package. The extension fetches Markdown lists, which are data,
never executed.

## Data disclosures

Tick nothing. The extension collects no user data: no personally identifiable information, no health,
financial, authentication, personal communications, location, browsing history, or user activity, and no
website content is sent anywhere. All processing is local.

Then affirm all three certifications: no sale of data, no use outside the single purpose, no use for
creditworthiness.

**Privacy policy URL:** the published copy of [privacy.md](privacy.md).

## Assets

- Icon, 128×128: `assets/icons/png/icon-128.png`
- Screenshots, 1280×800: `docs/store/` (at least one required, up to five)
- Small promo tile, 440×280: optional, only needed for featuring

## The account

The developer account is an ordinary Google account: a personal Gmail or a Workspace account on a domain you
own. A YouTube Brand Account cannot be used, because Brand Accounts have been limited to YouTube since 2021.
There is no "channel" concept in the Web Store.

Two things worth settling before paying the fee, because both are awkward to change later:

- **The contact email is shown publicly**, under the contact information on every extension you publish. Use
  an address made for this, not a personal one. A Workspace alias on a domain you own is tidiest and opens
  the verified-publisher route, where the store can display your site instead of a name.
- **The publisher display name** appears under the title of each extension and is separate from the account
  address, so the listing can say Sloppycat without exposing whose account it is. It is not easily changed
  once published.

The $5 fee is per account, so publishing from a fresh account later means paying it again. Group publisher
accounts exist for sharing or transferring ownership of an item without handing over the account itself,
which is the route to take if this ever needs to outlive one person's Gmail.

## Publishing an alpha

Visibility lives in the Distribution tab:

- **Unlisted** — anyone with the link can install it, but it never appears in search or browse. This is the
  right setting for an alpha you hand to a handful of artists.
- **Private** — only accounts on your trusted-tester list, or members of a Google Group, can install it.
  Tighter, but every tester needs adding by email.
- **Public** — listed and searchable. Not yet.

Review applies to all three, including unlisted. An extension with this many host permissions is likely to
draw a slower, closer look than a trivial one, so submit early and expect questions rather than a same-day
approval.

## Before each submission

1. `npm test` and `npm run build`
2. `npm run package`, which zips `dist/` with the manifest at the root of the archive
3. Bump `version` in `manifest.json`. The store rejects a re-upload at the same version.
4. Check this file still matches the manifest's permissions.
