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

**Spotify and Amazon are read in a real page, and you may see the window.** Spotify's catalogue arrives in the
GraphQL calls the player makes with a token minted per page load, and Amazon's author store is JavaScript
rendered against your own session. Neither can be put in an invisible frame: Amazon sends
`X-Frame-Options: SAMEORIGIN` and Spotify's CSP sets `frame-ancestors 'self'`, so an offscreen document is not
an option and a page is the only thing left. It is one reused tab in one minimized window of its own, never a
tab in a window you are working in, and it closes when the check finishes. Chrome gives an extension a window
with no address bar and no tab strip, which is the shape of a phishing window, so it carries a panel naming
the extension, the address it is reading and the fact that it closes itself, over a dimmed view of that page,
with a spinner while the check runs. The title and favicon are changed to match. Nothing about reading the
page changes. Apple Music, Deezer, Google Books
and Goodreads need none of this and are fetched directly. If you close the window mid-check, the check says so
and tries again next time. There is also a ceiling on page loads per check, so a bug upstream stops rather than
opening pages in a stream.

**Claims can only be self-proved where a creator controls a bio.** Spotify for Artists, Amazon Author Central
and a claimed Goodreads profile qualify. Apple Music, Deezer and Google Books give a creator nowhere to put
the link, so a claim there rests on registry attestation instead. See [trust.md](trust.md).

**A list off GitHub costs one permission click.** The manifest ships with the GitHub and Gist hosts, so a
list there is fetched with no prompt. A list on a creator's own domain needs an optional host permission,
which Chrome asks for at the moment you add that URL and not before: it names the one host, you can decline,
and declining just means that list is never fetched. This keeps the install prompt the size it is, at the
cost of one extra click per non-GitHub list. Removing the last list on a host gives the permission back.
Until the host is granted, the list shows "Sloppycat has no permission to read that host" with a button to
grant it, rather than a fetch that fails for reasons nobody can see.

**Identifiers mostly aren't on the page.** ISRCs and UPCs never appear on a public streaming page, so they
have to come from you or your distributor. ISBNs do appear on book pages and get read. ASIN churn is covered
in [the identifier notes](../research/identifiers.md).

**Google Books answers without a key, until it doesn't.** The volumes API is called anonymously, and the
keyless daily quota is shared by everyone calling it that way, so it returns HTTP 429 fairly often through no
fault of yours. That surfaces as an error on the profile rather than an empty catalogue, which is the
important part: it never reads as "this author has no books". Checked 2026-09-22, when it was over quota.

**A catalogue too long to read is read as far as it goes, and then trusted for nothing.** Amazon's author
grid loads sixteen at a time behind a "Show more" button, so an author with eighteen hundred titles takes
longer to expand than a check is willing to spend: it stops after forty-five seconds with a few hundred. A
read that stopped early says so, and a read that says so adds what it found to what was already known
instead of replacing it, and raises no alerts at all. Comparing one window against a different window would
report whichever books happened to load this time as newly published, and calling a real release fake is the
one mistake this is not allowed to make. The practical effect is that very long catalogues are recorded but
not monitored.

**Catalogue depth is capped per platform.** Apple's lookup returns up to 200 collections, Deezer paging stops
at 1000 albums, the Goodreads adapter reads 10 pages of 30. Prolific back catalogues will exceed those and
need paging work. Only Spotify reports a total to compare against, so only Spotify can tell you it saw fewer
than exist; on the others a truncated catalogue is silent.

**Lookalike search is shallow.** It checks your three most recent titles, every other check (about once a day), on the platforms
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
