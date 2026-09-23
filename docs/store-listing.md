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

**Summary.** The store caps this at 132 characters and it must match the `description` field in
manifest.json, which has the same limit. Currently 124 characters:

> Watches your artist or author profiles for releases you did not publish, writes the takedown, and marks fakes for listeners.

**Category:** Productivity, then Tools. (Workflow & Planning also fits if the dropdown offers it. The
category groups are Productivity, Lifestyle and Make Chrome Yours.)

**Language:** English (United States)

**Description** (16,000 character limit, currently 3154):

```
Someone uploads an AI-generated track through a cheap distributor, claims it is yours, and it lands on your artist page next to your real records. The royalties go to them. Your fans think it is you. The same thing happens to authors: your name on a book you did not write, or a title one word off yours.

Sloppycat watches for it.

WHAT IT DOES

Snapshot your own profile on Spotify, Apple Music, Deezer, Amazon or Goodreads. It reads what is on the page the same way anyone else's browser would. Everything starts ticked as yours and you untick what is not. Nothing is unticked for you, because a guess about your own catalog is worse than no guess.

Everything you untick comes with the takedown letter already written: the right form for that platform, the steps in the order the platform wants them, and your links and the release id filled in. You copy it and send it.

Then it keeps checking on a timer, hourly by default, and tells you when something new turns up that you have not claimed. It also looks for near-copies of your titles listed elsewhere under a made-up name, which is the half of this you cannot catch by watching your own page.

IT IS NOT AN AI DETECTOR

Spotify and Deezer already badge AI-generated music, and it misses this entirely: a fake on your page is credited to a human, so nothing flags it. The only person who knows whether a release is yours is you. So yours is the word it carries.

FOR EVERYONE ELSE

Creators can publish what they confirmed as a plain Markdown list, anywhere with a URL. Other people subscribe to those lists the way you subscribe to filter lists in an ad blocker, and disowned items get marked on the page before you press play or buy a copy. Hovering a mark tells you who said what and when, including which parts of a record were made with AI if the artist said so.

Those lists are re-fetched on a timer and each fetch is compared with the last, so you can be told what changed: a release the artist has just confirmed as theirs, a new fake they have flagged, or an accusation they have withdrawn. It is one notification per check rather than one per entry, the first fetch of a list you just added counts as a starting point rather than news, and removing a list takes its history with it.

Those blocker features are experimental, switched off until you turn them on, and they only work in the web client.

HOW A LIST IS TRUSTED

Anyone can write a file claiming your catalog, so no file proves itself. Mine does not either. Nothing gets marked on a page unless you added the list that says so, the same way you add filter lists to an ad blocker. Every mark names the list it came from, and dropping that list drops everything it ever said.

Artists who want to go further can point a bio only they control, in Spotify for Artists or Amazon Author Central, at their list. When that link is there your own browser checks it against the platform, and the card tells you it did. It is optional, and nothing breaks if an artist takes it back out.

PRIVACY

No account, no server, no analytics, no telemetry. Everything stays in your browser, and the extension never reports the pages you visit to anyone. Requests go to the platforms you asked it to watch and to the lists you subscribed to, and nowhere else.

HONEST LIMITS

It only runs while your browser is open. It writes the takedown, you send it. Blocker features are web client only, so not the desktop app and not your phone. Spotify only hands over your ten newest albums and singles, so the extension pages past that where it can and watches the release counts to catch what hides behind an old release date.

Open source, MIT licensed, and the research behind every design decision is in the repository with its sources: https://github.com/NTBooks/Sloppycat
```

**Official URL:** https://ntbooks.github.io/Sloppycat/site/

**Support URL:** https://github.com/NTBooks/Sloppycat/issues

**Mature content:** no.

## Permission justifications

Paste each into the matching box. Keep them literal; a reviewer checks them against the code.

- **storage** — Stores the profiles the user chose to watch, catalog snapshots, alerts and settings locally.
  Nothing leaves the browser.
- **alarms** — Runs the periodic check on the user's chosen interval. Chrome terminates the extension worker
  between events, so timers are not an option.
- **notifications** — Tells the user when a release they did not publish appears on a profile they watch, and
  when a list they subscribed to adds or withdraws an entry. One notification per check, and both can be
  turned off in Settings.
- **tabs** — Detects when the user is on a supported profile page so the popup can offer to snapshot it, and
  opens the extension's own pages.
- **scripting** — Reads the public catalog from a supported platform page, and marks items on those pages
  when the user turns that feature on. Injected only into the declared host permissions.
- **offscreen** — Parses saved HTML from a platform page with DOMParser, which is unavailable in the
  extension service worker.
- **Host permissions** — Reads the public catalog pages of the platforms the user watches
  (Spotify, Apple Music, Deezer, Amazon, Goodreads, Google Books), and fetches the lists the user subscribed
  to from GitHub, publishing the user's own list there at their request. Scoped to paths wherever the site
  is not a single-page app: on Amazon only `/stores/*` and `/s*`, on Goodreads only `/author/*` and
  `/search*`, which is the difference between reading an author's catalog and being able to reach a cart or
  an order history. Spotify and Apple Music are whole hosts because a path stops matching as soon as the
  user navigates inside the app, and neither host carries a checkout.
- **Optional host permissions (`https://*/*`)** — A list is a Markdown file the creator hosts themselves,
  and not every creator uses GitHub. The extension never fetches an arbitrary host on its own: when the
  user pastes a list URL outside the GitHub hosts above, the page calls `chrome.permissions.request` for
  that single origin, from the user's own click, and Chrome names the host in its own dialog. Declining
  leaves the list unfetched and nothing else changes. Removing the last list on a host revokes the grant
  again. Nothing is requested at install time, so the install prompt covers only the required hosts above.

**Remote code:** none. All code ships in the package. The extension fetches Markdown lists, which are data,
never executed.

## Data disclosures

Tick nothing. The extension collects no user data: no personally identifiable information, no health,
financial, authentication, personal communications, location, browsing history, or user activity, and no
website content is sent anywhere. All processing is local.

Then affirm all three certifications: no sale of data, no use outside the single purpose, no use for
creditworthiness.

**Privacy policy URL:** <https://ntbooks.github.io/Sloppycat/docs/privacy.html> (source: [privacy.html](privacy.html),
kept in step with [privacy.md](privacy.md)).

## Assets

- Icon, 128×128: `assets/icons/png/icon-128.png`
- Screenshots, 1280×800: `docs/store/` (at least one required, up to five)
- Small promo tile, 440×280: optional, only needed for featuring

## The account

Registered as **sloptrawler@gmail.com**, publisher display name **Sloppycat**, fee paid.

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

The likeliest question is the optional `https://*/*`. The answer is above and it is worth having ready: it
is optional, it is never requested at install, every request is one origin the user just typed, and the
only thing granted hosts are used for is fetching that one Markdown file. The alternative would be telling
creators their list has to live on GitHub, which is a worse product and would still not shrink the install
prompt, because nothing here is added to it.

## Before each submission

1. `npm test` and `npm run build`
2. `npm run package`, which zips `dist/` with the manifest at the root of the archive
3. Bump `version` in `manifest.json`. The store rejects a re-upload at the same version.
4. Check this file still matches the manifest's permissions and description, `optional_host_permissions`
   included, and that [privacy.md](privacy.md) and [privacy.html](privacy.html) still say the same thing.
5. `npm run check:store` verifies the description length before you waste an upload on it.
