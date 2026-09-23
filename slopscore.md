---
slopscore: 2
spec: https://slopscore.org/spec
ai_generated: entirely
human_touch: heavy
content_rating: everyone
contains: [scraping, legal]
category: [extension, automation, media]
status: alpha
tagline: Artists say what is theirs. Everyone else gets to see it.
built_with: [claude-code, claude]
models: [claude-opus-5]
interface: [plugin, web]
platforms: [browser]
frameworks: [preact, typescript, esbuild]
audience: [end-users, developers]
data: [local-only, scrapes]
needs: ["GitHub account (optional, only to have the extension publish your list for you)"]
domain: music, books, publishing, AI-generated fakes
tags:
  - chrome-extension
  - manifest-v3
  - spotify
  - amazon
  - goodreads
  - apple-music
  - deezer
  - takedown
  - provenance
  - ai-slop
slopbucket: [anti-slop, scraper, extension]
images:
  - docs/store/01-review.png
  - docs/store/02-takedown.png
  - docs/store/03-overlay.png
maintainers: [NTBooks]
---

Somebody uploads an AI song under a real artist's name and it lands on that artist's Spotify page, right
next to their actual records. The scammer collects the royalties. It happens with books too: a knockoff
goes up under a real author's name, or a near-copy of a title that just sold well, and the people who buy
it think they bought the real thing.

The platforms could fix this by asking the artist first. Spotify is beta-testing something like that. The
rest aren't, and I got tired of waiting.

So this is the other way round. You snapshot your own profile, untick whatever isn't yours, and publish
that as a markdown file somewhere with a URL. Put the link in your bio, which only you can edit, and that
bio is the proof: the list names the profile, the profile names the list back, and a scammer can't write
the second half. Other people subscribe to your list and the fakes get marked on the page before they press
play or buy.

The file is the whole format. No account, no signup, nothing to trust me with, and it works fine if you
never install the extension at all: it's readable markdown either way.

Should you believe any of it? Only as far as you believe the person who published the list. Nothing here
decides what's real on its own. An unproven claim shows you nothing, which I think is the right default,
and `docs/limits.md` is an honest list of everything it can't see, including the bits that embarrass me.

tl;dr: your catalog, said once, in a file you own.
