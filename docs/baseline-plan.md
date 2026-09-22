# Phase 2: the default list we ship with

The extension is useless to a consumer on day one if every item is grey "unconfirmed". This is the plan for
the data we ship before any creator enrolls.

## The cutoff idea

Most catalogs were clean before generative tools made fake releases free to produce. So: pick a date, treat
everything published before it as **likely accurate**, and spend our real effort on what came after. The back
catalog can be verified later, at leisure, as creators enroll.

**Recommended cutoff: `2022-11-30`** (ChatGPT's public launch). One global date, conservative for both media:

| Medium | What actually happened | Why the date still works |
|---|---|---|
| Books | AI knockoffs on Amazon surged through 2023; the Jane Friedman case broke August 2023. | Nov 2022 sits just before the first wave, so nothing from the wave gets waved through. |
| Music | Suno v3 and Udio arrived spring 2024; profile hijacking went mainstream 2025–2026. | Earlier than needed, which is the safe direction to err. |

The date is per-list (`Baseline-before:`), so a curator can publish a later cutoff for a medium where we have
better evidence. Earlier is always safer: a later cutoff marks more items "likely accurate" and risks blessing
a fake.

**The badge must not overclaim.** "Likely genuine: released before AI knockoffs took off" is a statement about
a date, not about the work. It never becomes a green check without a creator saying so.

## Who to cover first

Coverage should follow risk, not fame. Ranked by what the reporting shows is actually being targeted:

1. **Inactive or deceased musicians with real catalogs.** The documented victims. Nobody is watching these
   profiles, and jazz catalogs specifically have been hit repeatedly. Source: MusicBrainz artists with an end
   date, cross-referenced to a live Spotify/Apple/Deezer profile.
2. **Independent artists distributing through low-friction distributors.** The loophole is the distributor.
   Proxy signal: a catalog whose releases carry placeholder labels of the `NNNN Records DK` form.
3. **Authors with a recent bestseller.** Clone bait: summaries, workbooks, and near-identical titles appear
   within weeks. Source: public bestseller lists, then a title-similarity sweep.
4. **Authors with a large free corpus** (long-running blogs, newsletters). The Friedman pattern: enough public
   prose to imitate, and a name worth attaching. Source: Authors Guild and ALLi member directories, with consent.
5. **Artists and authors with common or colliding names.** Mis-mapping happens to them without any malice.

Documented victims from the press coverage go in first, each contacted before we publish anything about them.

## Jobs

Four batch jobs, run on a schedule, writing Markdown lists to the curator repo. All four use the free,
unauthenticated endpoints, so this is cheap: Apple's iTunes lookup, Deezer's API, Open Library and Google Books.
Spotify has no usable API and needs a rendering worker, so it runs last and slowest.

1. **`seed-targets`** — build the candidate roster from the sources above. Output: a roster file of
   `platform, profile URL, why-at-risk, contacted?`.
2. **`baseline-catalog`** — for each target, pull the full catalog and emit `## Likely accurate` rows for
   everything released before the cutoff. This is the bulk of the shipped list.
3. **`watch-new`** — for each target, poll for releases after the cutoff. These are *candidates*, never
   published as `Not mine` automatically. They land in a review queue with their signals attached
   (placeholder label, first-time label, title similarity to a known work).
4. **`publish`** — rebuild `lists/community.md` from reviewed entries, bump `Version`, open a pull request.

## Rules that keep this honest

The failure mode that kills the project is calling a real release fake. So:

- **Nothing enters `## Not mine` without either the creator's confirmation or two independent curator
  sign-offs with evidence recorded in the `note`.** Signals alone are never enough; a placeholder label is
  what most legitimate indie releases look like.
- **`## Likely accurate` is date-derived only.** No inference about content.
- **Creators outrank us.** The moment a creator publishes their own list, it wins for their profile, and our
  community rows for them are dropped rather than merged.
- **Anyone can be removed on request**, including from the roster, no questions asked.
- A creator's list, once verified, is the source of truth we cite in the report card.

## Open question

The note mentions using "Jev" for some of this. I don't know what that is, so I've left it out of the job
design. Tell me what it is and I'll fold it into whichever jobs it fits.
