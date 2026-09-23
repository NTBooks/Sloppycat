import { beforeEach, describe, expect, it } from "vitest";
import { lookup } from "../src/lists/sources";
import type { CachedList } from "../src/storage";
import type { ListDocument } from "../src/types";

const JANE = "https://open.spotify.com/artist/0123456789abcdefghijkl";
const BOB = "https://open.spotify.com/artist/ZYXWVUTSRQPONMLKJIHGFE";
const JANE_LIST = "https://example.test/jane.md";
const BOB_LIST = "https://example.test/bob.md";
const COMMUNITY = "https://example.test/community.md";
const ALBUM = "AAAAAAAAAAAAAAAAAAAAAA";

function doc(extra: Partial<ListDocument>): ListDocument {
  return { title: "A list", type: "creator", creator: [], mine: [], notMine: [], ...extra };
}

/** Enough of chrome.storage.local for lookup to read the subscribed lists. */
function lists(entries: [string, ListDocument][], myList: ListDocument | null = null) {
  const listCache: Record<string, CachedList> = {};
  for (const [source, d] of entries) listCache[source] = { source, doc: d, fetchedAt: new Date().toISOString() };
  const data: Record<string, unknown> = {
    listCache,
    listSources: entries.map(([url]) => ({ url, enabled: true })),
    myList,
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async (key: string) => ({ [key]: data[key] }), set: async () => {} },
      onChanged: { addListener() {}, removeListener() {} },
    },
  };
}

const janeSays = (section: "mine" | "notMine") =>
  doc({ title: "Jane", creator: [{ platform: "spotify", profile: JANE }], [section]: [{ platform: "spotify", id: ALBUM, title: "Blue Room" }] });
const communitySays = (section: "mine" | "notMine") =>
  doc({ title: "Community", type: "community", [section]: [{ platform: "spotify", id: ALBUM, title: "Blue Room" }] });

beforeEach(() => lists([]));

describe("lookup precedence", () => {
  // Red is the creator's to give. A community list saying "not theirs" used to overwrite the
  // creator's own "mine", because the verdict already held was always ranked as a community one.
  it("keeps the creator's own word over a community list that disagrees, in either order", async () => {
    for (const order of [
      [[JANE_LIST, janeSays("mine")], [COMMUNITY, communitySays("notMine")]],
      [[COMMUNITY, communitySays("notMine")], [JANE_LIST, janeSays("mine")]],
    ] as [string, ListDocument][][]) {
      lists(order);
      const v = await lookup("spotify", [ALBUM], JANE);
      expect(v[ALBUM]?.status).toBe("verified");
    }
  });

  it("keeps your own list over a community list that disagrees", async () => {
    lists([[COMMUNITY, communitySays("notMine")]], janeSays("mine"));
    const v = await lookup("spotify", [ALBUM], JANE);
    expect(v[ALBUM]).toMatchObject({ status: "verified", via: "own-list" });
  });

  it("still lets a creator's not-mine beat their own mine", async () => {
    lists([[JANE_LIST, doc({ ...janeSays("mine"), notMine: [{ platform: "spotify", id: ALBUM, title: "Blue Room" }] })]]);
    expect((await lookup("spotify", [ALBUM], JANE))[ALBUM]?.status).toBe("not_mine");
  });

  it("lets a community list speak where no creator has", async () => {
    lists([[COMMUNITY, communitySays("notMine")]]);
    expect((await lookup("spotify", [ALBUM], JANE))[ALBUM]).toMatchObject({ status: "not_mine", via: "community" });
  });
});

describe("lookup scope", () => {
  // One artist's list vouching for an item on somebody else's page is not something it can know.
  it("ignores a creator list's mine rows on a profile it does not name", async () => {
    lists([[JANE_LIST, janeSays("mine")]]);
    expect((await lookup("spotify", [ALBUM], BOB))[ALBUM]).toBeUndefined();
  });

  // An impostor page under the artist's name is where "not mine" matters most, so it still shows,
  // but as the list's artist speaking rather than the page's.
  it("shows a creator list's not-mine on a profile it does not name, marked as off its profile", async () => {
    lists([[JANE_LIST, janeSays("notMine")]]);
    const v = (await lookup("spotify", [ALBUM], BOB))[ALBUM];
    expect(v).toMatchObject({ status: "not_mine", offProfile: true, creatorProfile: JANE });
  });

  it("lets the page's own artist outrank another artist's list on their own page", async () => {
    const bob = doc({ title: "Bob", creator: [{ platform: "spotify", profile: BOB }], mine: [{ platform: "spotify", id: ALBUM, title: "Blue Room" }] });
    lists([[JANE_LIST, janeSays("notMine")], [BOB_LIST, bob]]);
    const v = (await lookup("spotify", [ALBUM], BOB))[ALBUM];
    expect(v).toMatchObject({ status: "verified", listUrl: BOB_LIST });
  });

  it("does not mark a verdict off-profile on the list's own profile", async () => {
    lists([[JANE_LIST, janeSays("notMine")]]);
    expect((await lookup("spotify", [ALBUM], JANE))[ALBUM]?.offProfile).toBeUndefined();
  });

  it("applies creator rows on an item page, where the profile is not known", async () => {
    lists([[JANE_LIST, janeSays("mine")]]);
    expect((await lookup("spotify", [ALBUM]))[ALBUM]?.status).toBe("verified");
  });

  it("does not treat a URL that merely ends in the profile as naming it", async () => {
    const spoof = doc({
      title: "Not Jane",
      creator: [{ platform: "spotify", profile: `https://anything.example/open.spotify.com/artist/0123456789abcdefghijkl` }],
      mine: [{ platform: "spotify", id: ALBUM, title: "Blue Room" }],
    });
    lists([[BOB_LIST, spoof]]);
    expect((await lookup("spotify", [ALBUM], JANE))[ALBUM]).toBeUndefined();
  });
});
