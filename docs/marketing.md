# Marketing plan

## This only works if the owners work it

An ad blocker is worthless without filter lists, and filter lists exist because a handful of people commit to
maintaining them in public. Same shape here. The extension is plumbing. What makes it useful is a set of lists
published by people whose word carries, and the lists have to come from the rights holders or from someone
acting for them.

So the product work is mostly done, and the remaining work is convincing trustworthy people to publish.

**The data already exists, just not in public.** Labels and distributors send release metadata to the
platforms through DDEX ERN feeds: titles, ISRCs, UPCs, artwork, territories. Publishers send ONIX. Every one
of those senders knows exactly which releases are theirs. What nobody publishes is a public, machine-readable
statement of that, from the owner, that a browser can check. MusicBrainz and Discogs are community-built, so
they answer "what do collectors believe" rather than "what does the rights holder assert". A Sloppycat list is
that missing public projection, and for a label it is an export of something they already hold.

**Who to ask, and why them**

- **Music rights lawyers with an audience.** Top Music Attorney has been explaining this exact scam to artists
  who are already worried about it. A lawyer's list carries weight partly because of what they'd be risking by
  publishing a bad one.
- **Rick Beato and others who raised it.** He put the problem in front of a large audience of working
  musicians. The ask isn't a sponsorship, it's whether he'd publish a list for his own catalog and say why.
- **Independent labels and distributors.** One list can cover a whole roster: the Creator table takes every
  artist profile, and each artist's bio links back. A label publishing for its roster is the single highest
  leverage move available, and it costs them an export.
- **The reporters already on the beat.** Digital Music News, Plagiarism Today, Engadget, Rolling Stone, CBC,
  Music Business Worldwide. Several of them named specific victims. Those artists are the first people who
  should be offered a verified list, with consent, and a story about a fix is a better second piece than
  another story about the problem.
- **Authors Guild, ALLi, and the librarians.** The book side has no platform fix at all, so the pitch there is
  simply that nothing else exists.

**Neutral turf, and it has to stay that way.** The moment this looks like one label's tool, every other label
is out, and so are the indies. That means governance has to be visible and boring: the format is open, anyone
can publish a list without asking me, the community list's evidence bar is written down, no platform or label
gets special treatment in the code, and a creator's own list always outranks anyone else's claim about them.
There's nothing to sell here and no account to own, which is the main argument that it stays neutral.

**Positioning:** "The ad blocker for fake releases. Artists verify their catalog; fans see it." Not an AI detector; an artist-verified overlay. Secondary: "Find out in an hour, not a month."

**Audiences, in order:**
1. Indie musicians hit by hijacks (jazz, legacy/inactive catalogs, small labels). Where: Spotify for Artists community, r/WeAreTheMusicMakers, r/musicmarketing, Discord servers of distributors, Artist Rights Alliance, UMAW, Music Workers Alliance.
2. Indie authors. Where: Authors Guild (already running scam alerts), ALLi, r/selfpublish, KDP Community, Goodreads Librarians Group, Jane Friedman's newsletter (she broke the story; ask, don't assume).
3. Fans of enrolled artists (creators bring them: "install Sloppycat and you'll see my ✓").
4. Curators for the community list (the EasyList role): librarians, superfans, journalists who already track this.

**Launch sequence:**
- Open source on GitHub from day one; list format spec published first so curators can start before the extension ships.
- Seed the default community list with already-public cases (the jazz musicians covered by DMN/Rolling Stone, Friedman's six titles) — contact each creator for consent and to enroll them as verified.
- Recruit 10 pilot creators (5 music, 5 books) before store launch; their bio links + testimonials are the launch asset.
- Press: pitch the reporters already on this beat (Digital Music News, Plagiarism Today, Engadget, Rolling Stone, CBC, Music Business Worldwide) with the angle "artists build the verification Spotify is still beta-testing, and it works on Amazon too". Time it to Spotify's Artist Profile Protection news cycle or the next hijack story.
- Show HN + Product Hunt on the same day; r/privacy and r/uBlockOrigin for the uBlock-export angle.
- Short-form video: "I watched my own Spotify page for a week" is a format that explains the problem faster
  than any copy does. Each one ends with the install link.

**Metrics:** enrolled verified creators; list entries; consumer installs; badge impressions; takedown packets copied; median time-to-detect for confirmed hijacks (the number to put in the press kit).

**Name/brand to-dos:** check Chrome Web Store, npm, GitHub org, domain, and USPTO for "sloppycat" before launch. Mark: polygon cat ninja. At 16px the silhouette must still read as a cat (two ear triangles) with the mask band as a single dark facet across the lower face and two eye facets above it; keep to ~10 facets, two-tone plus one accent for the headband tails. Build the 128px version first, then simplify down.
