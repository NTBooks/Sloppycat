# What this can't see

Every limit worth knowing about, so nobody relies on a promise the code doesn't make. Checked
2026-09-22 against the live platforms.

## The Spotify window, and the reason it matters more than it looks

An artist page hands over the **ten newest albums and ten newest singles**, newest first. That sounds like
enough for monitoring, and it isn't, for two reasons.

**A release date is whatever the uploader typed.** It's metadata that travels with the delivery, not a fact
the platform establishes. So a fake dated 2019 lands in the middle of a catalogue, not at the top, and a
newest-first window never reaches it. Anyone reading this page could work that out, so assume the people doing
this already have.

**A catch-up can overflow the window.** Leave the browser closed for a week on a profile that's being hit, and
more than ten can arrive between checks. The reported cases run to hundreds of tracks on a single profile.

Three things address it:

1. **Paging the rest.** When the page makes a paginated request, the extension re-issues that same request
   with a different offset, using the page's own short-lived token, for the artist you're already looking at.
   That reaches the whole catalogue. It depends on the player making such a request, which it does when
   signed in and browsing a full discography.
2. **Counting, not just listing.** The response reports a total per category. Those totals are stored with
   each snapshot, and if the total grows by more than the number of new items that showed up at the top,
   that's a release hiding behind an old date. You get an alert saying so and pointing at your full
   discography, rather than silence.
3. **Saying so.** After a snapshot the wizard tells you when it saw fewer than the platform claims exist, with
   a link to load the rest.

## The other limits, honestly

**It only runs while your browser is open.** An extension has no other option. A hosted version would fix it,
and the JSON adapters would move to a server unchanged.

**Claims can only be self-proved where a creator controls a bio.** Spotify for Artists, Amazon Author Central
and a claimed Goodreads profile qualify. Apple Music, Deezer and Google Books give a creator nowhere to put
the link, so a claim there rests on registry attestation instead. See [trust.md](trust.md).

**Identifiers mostly aren't on the page.** ISRCs and UPCs never appear on a public streaming page, so they
have to come from you or your distributor. ISBNs do appear on book pages and get read. ASIN churn is covered
in [the identifier notes](../research/identifiers.md).

**Catalogue depth is capped per platform.** Apple's lookup returns up to 200 collections, Deezer paging stops
at 1000 albums, the Goodreads adapter reads 10 pages of 30. Prolific back catalogues will exceed those and
need paging work.

**Lookalike search is shallow.** It checks your three most recent titles, every sixth run, on the platforms
that can search. A clone of an older title won't be found unless someone reports it.

**Amazon can challenge the request.** Running inside your own session usually avoids it, and a challenge
surfaces as an error on the profile rather than a silent zero.

**Pre-existing fakes are your call, once.** The first snapshot is where you untick what's already wrong.
Nothing before that is flagged for you, because the extension has no idea what your catalogue looked like
before it arrived.

**Platforms not covered at all.** Tidal, Amazon Music, YouTube Music, Audible, Kobo, Apple Books. The scam
happens on those too; the delivery goes to every store at once. Each needs an adapter.

**Track-level attacks aren't covered.** The unit here is a release. A single fake track slipped into an
otherwise real album wouldn't be caught.

**Blocker features are web client only.** They change what a page looks like, so the Spotify desktop app,
phones and the Kindle app are all out of reach. They're experimental and off by default.

## Testing it without owning a catalogue

You don't need to be published to exercise any of this. Watch any public artist or author profile: snapshot,
review and takedown letters all work on someone else's page, you just can't prove a claim over it, and
watching that verification correctly fail is itself worth doing.

Settings has a **Testing** panel that plants a new release, a lookalike or a hidden-count warning on a watched
profile, so the whole path from alert to letter can be walked in about a minute. It also plants a list update,
which is the blocker-side equivalent: the notification and the changelog entry you would get when a list you
subscribe to confirms or flags something, without waiting for the next refresh. Nothing is sent anywhere and
nothing on the platform changes; the planted items live only in that browser.

For the security property that matters most, publish a list claiming a profile you don't control, subscribe to
it, and confirm no badges ever appear. An unproven claim renders nothing at all.
