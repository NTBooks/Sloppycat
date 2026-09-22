# What each platform gives us

Checked against the live sites on 2026-09-22. Where a page is described as rendered or server-rendered, that
was verified by loading it, not assumed.

## Reading a catalog

| Platform | What works | What doesn't |
|---|---|---|
| **Spotify** | The web player loads artist data from its own GraphQL endpoint (`api-partner.spotify.com/pathfinder/v2/query`, operation `queryArtistOverview`). The response carries release ids, names, types, dates, labels, copyright lines, the artist bio, external links, and an `onPlatformReputationTrait.verification.aiPersona` flag. Newest first. | The public Web API is effectively closed: since Feb 2026 development mode is 5 users and requires the owner to hold Premium, and extended quota needs a registered business with 250k+ MAU. The discography page is virtualized: only about two albums are in the DOM at once, and scrolling in a background tab loads no more. Persisted-query hashes change, so replaying them is brittle. |
| **Apple Music** | `itunes.apple.com/lookup?id=<artistId>&entity=album&sort=recent`, free, no key, about 20 requests/minute. Gives collection ids, titles, dates, copyright, artwork. | Copyright line is the closest thing to a label. No creator-editable bio, so a claim can't be self-proved here. |
| **Deezer** | `api.deezer.com/artist/<id>/albums`, free, no key, paginated, includes `label` and `record_type`. | No creator-editable bio. |
| **Amazon Books** | The author page redirects to a JavaScript store page. The catalog is at `/stores/author/<id>/allbooks`, 16 at a time behind a "Show more" button; each card's overlay link carries the title in `title`/`aria-label`. The full bio is on `/stores/author/<id>/about`. Search results are still server-rendered with `data-asin` cards. | `/-/e/<id>` returns a JS shell with no catalog data in the HTML, so plain fetching gets nothing. Bot challenges are real; running in the user's own session avoids them. Format links ("Hardcover", "Audiobook") and series links ("Book 1 of 8") sit next to real titles and must be skipped. |
| **Goodreads** | `/author/list/<id>` is server-rendered and paginated, 30 per page, with ratings counts and published years. Bio is on `/author/show/<id>` in `#freeTextauthor<id>`. | No API since 2020. Librarians can't edit claimed author profiles, which changes the takedown route. |
| **Google Books** | `googleapis.com/books/v1/volumes?q=inauthor:"…"`, free at low volume, returns ISBNs. | Author matching is by name string, so it's a signal source rather than a profile. |

## Getting something removed

| Platform | Route | Notes |
|---|---|---|
| Spotify | Spotify for Artists → report incorrect release, plus the distributor with the UPC | Don't delete and re-upload your own release while waiting; it creates duplicates and delays. Ask about Artist Profile Protection to stop repeats. |
| Apple Music | Apple Music for Artists contact form, plus the distributor | Distributor tickets tend to move fastest. |
| Deezer | Deezer for Creators support, plus the distributor | |
| Amazon (on your author page) | Author Central → Help → Contact Us, with the ASIN | Requires an Author Central account; free to create. |
| Amazon (using your name elsewhere) | `amazon.com/report/infringement` | Right of publicity for name misuse, copyright for copied text or cover, trademark if registered. No seller account needed. |
| Goodreads | Claimed profile: Goodreads Support. Unclaimed: Librarians Group, Book Issues folder | Goodreads does not delete books; ask for it to be moved off your profile. |

Sources:
[Spotify Feb 2026 dev mode migration](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) ·
[Spotify extended access criteria](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access) ·
[iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/LookupExamples.html) ·
[Amazon infringement form](https://www.amazon.com/report/infringement) ·
[Author Central guidance](https://writersweekly.com/ask-the-expert/amazon-wrong-author) ·
[Goodreads Librarians Group](https://www.goodreads.com/topic/show/18545416-remove-book-from-author-profile) ·
[Hypebot on Spotify content mismatch](https://www.hypebot.com/music-on-the-wrong-spotify-artist-profile-how-to-fix-it-in-2026/)

## Browser extension limits

`chrome.alarms` fires while the service worker is asleep, minimum period 30 seconds, but alarms are lost when
the browser closes and must be re-created on `onStartup`. `setTimeout` and `setInterval` don't survive worker
termination. Fetches from the worker don't reliably carry cookies, and `DOMParser` isn't available there, so
HTML parsing happens in an offscreen document. Net effect: monitoring runs only while the browser is open,
which is a real limit worth stating rather than hiding.

Sources:
[Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) ·
[Cookies in service workers](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/RMUtNEhR0R8)
