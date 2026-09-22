import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { countsOf, driftBetween, pageRequest, parseSpotifyCaptures, pickPaginator } from "../src/adapters/spotify-json";

const overview = JSON.parse(readFileSync(resolve(__dirname, "fixtures", "spotify-overview.json"), "utf8"));
const now = "2026-09-22T00:00:00.000Z";

describe("counts from the artist response", () => {
  it("reads the totals per category, which exceed what was handed over", () => {
    const counts = countsOf([overview]);
    expect(counts).toMatchObject({ albums: 11, singles: 2, compilations: 1, appearsOn: 481 });
    // The response carried 3 albums but claims 11: that gap is the point.
    const parsed = parseSpotifyCaptures([overview], "3yY2gUcIsjMr8hjo51PoJ8", now);
    expect(parsed.items.filter((i) => i.kind === "album")).toHaveLength(3);
    expect(parsed.counts?.["albums"]).toBe(11);
  });

  it("reads counts whether the capture wraps the response or is the response", () => {
    expect(countsOf([{ json: overview }])["albums"]).toBe(11);
  });
});

describe("drift detection", () => {
  it("reports categories that grew", () => {
    expect(driftBetween({ albums: 11, singles: 2 }, { albums: 11, singles: 5 })).toEqual([{ category: "singles", added: 3 }]);
  });
  it("says nothing on a first run, or when nothing moved", () => {
    expect(driftBetween(undefined, { albums: 11 })).toEqual([]);
    expect(driftBetween({ albums: 11 }, { albums: 11 })).toEqual([]);
  });
  it("ignores a count that went down, which is a removal, not an insertion", () => {
    expect(driftBetween({ albums: 11 }, { albums: 9 })).toEqual([]);
  });
});

describe("paging the rest of the catalogue", () => {
  const capture = {
    url: "https://api-partner.spotify.com/pathfinder/v2/query",
    headers: { authorization: "Bearer test", "client-token": "ct" },
    body: JSON.stringify({
      operationName: "queryArtistDiscographyAlbums",
      variables: { uri: "spotify:artist:x", offset: 0, limit: 50 },
      extensions: { persistedQuery: { version: 1, sha256Hash: "abc" } },
    }),
    json: overview,
  };

  it("picks a request whose variables carry an offset and a limit, and that returned releases", () => {
    const p = pickPaginator([capture]);
    expect(p).toMatchObject({ operationName: "queryArtistDiscographyAlbums", offsetKey: "offset", limitKey: "limit" });
  });

  it("ignores requests with no offset, no auth, or no releases in the response", () => {
    const noOffset = { ...capture, body: JSON.stringify({ operationName: "queryArtistOverview", variables: { uri: "x" } }) };
    const noAuth = { ...capture, headers: {} };
    const noReleases = { ...capture, json: { data: { artistUnion: { id: "x" } } } };
    expect(pickPaginator([noOffset])).toBeNull();
    expect(pickPaginator([noAuth])).toBeNull();
    expect(pickPaginator([noReleases])).toBeNull();
  });

  it("builds the next page as the same query with a new offset", () => {
    const p = pickPaginator([capture])!;
    const { url, init } = pageRequest(p, 50, 50);
    expect(url).toBe(capture.url);
    const body = JSON.parse(String(init.body));
    expect(body.variables).toEqual({ uri: "spotify:artist:x", offset: 50, limit: 50 });
    expect(body.extensions).toEqual({ persistedQuery: { version: 1, sha256Hash: "abc" } });
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer test");
    // Never send cookies with a replayed query; the captured token is the whole authorisation.
    expect(init.credentials).toBe("omit");
  });

  it("merges replayed pages with the original capture", () => {
    const secondPage = {
      data: {
        artistUnion: {
          id: "3yY2gUcIsjMr8hjo51PoJ8",
          discography: {
            albums: {
              totalCount: 11,
              items: [
                {
                  releases: {
                    items: [
                      { id: "1aaaaaaaaaaaaaaaaaaaaa", name: "Older Record", type: "ALBUM", date: { year: 1985 }, label: "WM UK" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };
    const merged = parseSpotifyCaptures([overview, secondPage], "3yY2gUcIsjMr8hjo51PoJ8", now);
    expect(merged.items.find((i) => i.itemId === "1aaaaaaaaaaaaaaaaaaaaa")?.title).toBe("Older Record");
    expect(merged.items.length).toBeGreaterThan(parseSpotifyCaptures([overview], "3yY2gUcIsjMr8hjo51PoJ8", now).items.length);
  });
});
