// Takedown packets: per-platform, prefilled, copy-and-send. The packet is the product.
import type { Platform, Profile, SnapshotItem } from "../types";

export interface Packet {
  platform: Platform;
  /** "on_profile": the fake sits on the creator's page. "elsewhere": it uses their name/title on another page. */
  situation: "on_profile" | "elsewhere";
  title: string;
  where: { label: string; url: string; note?: string }[];
  steps: string[];
  subject: string;
  body: string;
  /** Fields the creator must fill in before sending. */
  blanks: string[];
}

export interface PacketInput {
  item: SnapshotItem;
  profile?: Profile;
  correctProfileUrl?: string;
  creatorName?: string;
  situation?: "on_profile" | "elsewhere";
  firstSeen?: string;
  note?: string;
}

function line(label: string, value: string | undefined): string {
  return `${label}: ${value && value.trim() ? value : "[FILL IN]"}`;
}

export function buildPacket(input: PacketInput): Packet {
  const { item } = input;
  const situation = input.situation ?? (item.source === "search" ? "elsewhere" : "on_profile");
  const name = input.creatorName ?? input.profile?.displayName ?? "[YOUR NAME]";
  const correct = input.correctProfileUrl ?? input.profile?.url ?? "";
  const seen = input.firstSeen ?? item.firstSeen.slice(0, 10);
  const common = [
    line("My name / artist name", name),
    line("My correct profile", correct),
    line("Item that is not mine", item.url),
    line("Title", item.title),
    line("First seen", seen),
  ];

  switch (item.platform) {
    case "spotify": {
      const blanks = ["UPC (ask your distributor if unknown)"];
      const body = [
        "Hello,",
        "",
        `A release has been attached to my artist profile that I did not create or authorize.`,
        "",
        ...common,
        line("Release link", item.url),
        line("Release UPC", ""),
        item.label ? line("Label shown on the release", item.label) : "",
        "",
        "Please remove this release from my profile and detach it from my artist identity.",
        "I have not deleted or re-uploaded anything on my side.",
        "",
        `Thank you,`,
        name,
      ]
        .filter((l) => l !== "")
        .join("\n");
      return {
        platform: "spotify",
        situation: "on_profile",
        title: "Report an incorrect release on Spotify",
        where: [
          {
            label: "Spotify for Artists → Music → Upcoming / Catalog → Report incorrect release",
            url: "https://artists.spotify.com/",
            note: "Prefilled form; attach the links below. Enrolling in Artist Profile Protection (if offered) prevents repeats.",
          },
          {
            label: "Your distributor's support (they can pull the mapping too)",
            url: "https://support.spotify.com/artists/",
            note: "Send them the same packet with the UPC.",
          },
          {
            label: "Spotify content mismatch support",
            url: "https://support.spotify.com/us/artists/article/content-mismatch/",
          },
        ],
        steps: [
          "Open Spotify for Artists, find the release under Music, choose Report incorrect release.",
          "Paste the packet. Include the correct-profile and release links; keep it short.",
          "Email your distributor the same packet with the UPC so they can request the correction from their side.",
          "Do not delete or re-upload your own releases; that creates duplicates and delays.",
          "Ask Spotify for Artists about Artist Profile Protection so future releases need your approval.",
        ],
        subject: `Incorrect release on my artist profile: "${item.title}"`,
        body,
        blanks,
      };
    }
    case "apple": {
      const body = [
        "Hello,",
        "",
        "A release was delivered to my Apple Music artist page that I did not create or authorize.",
        "",
        ...common,
        line("Apple Music album ID", item.itemId),
        line("UPC", ""),
        "",
        "Please remove it from my artist page and correct the artist mapping.",
        "",
        name,
      ].join("\n");
      return {
        platform: "apple",
        situation: "on_profile",
        title: "Fix an incorrect release on Apple Music",
        where: [
          { label: "Apple Music for Artists → Contact Us", url: "https://artists.apple.com/" },
          { label: "Your distributor's support", url: "", note: "They can file a metadata correction with Apple." },
        ],
        steps: [
          "Sign in to Apple Music for Artists and open the support/contact form for artist page issues.",
          "Paste the packet with the album ID and your correct artist page.",
          "Send the same packet to your distributor; Apple usually acts on distributor tickets fastest.",
        ],
        subject: `Unauthorized release on my artist page: "${item.title}"`,
        body,
        blanks: ["UPC"],
      };
    }
    case "deezer": {
      const body = [
        "Hello,",
        "",
        "A release was attached to my Deezer artist page that I did not create or authorize.",
        "",
        ...common,
        line("Deezer album ID", item.itemId),
        item.label ? line("Label on release", item.label) : "",
        "",
        "Please remove it from my artist page.",
        "",
        name,
      ]
        .filter((l) => l !== "")
        .join("\n");
      return {
        platform: "deezer",
        situation: "on_profile",
        title: "Report an incorrect release on Deezer",
        where: [
          { label: "Deezer for Creators support", url: "https://creatorsupport.deezer.com/" },
          { label: "Your distributor's support", url: "" },
        ],
        steps: [
          "Open Deezer for Creators support and file a catalog/artist page issue.",
          "Paste the packet. Mention the album ID and your correct artist page.",
          "Send the same packet to your distributor.",
        ],
        subject: `Unauthorized release on my artist page: "${item.title}"`,
        body,
        blanks: [],
      };
    }
    case "amazon": {
      if (situation === "on_profile") {
        const body = [
          "Hello,",
          "",
          "A book that I did not write is listed on my Author Central page. Please remove it from my author page.",
          "",
          ...common,
          line("ASIN", item.itemId),
          item.ids?.isbn ? line("ISBN", item.ids.isbn) : "",
          "",
          "I am the author associated with this page and this title is not my work.",
          "",
          name,
        ].join("\n");
        return {
          platform: "amazon",
          situation,
          title: "Remove a book that is not yours from your Amazon author page",
          where: [
            {
              label: "Author Central → Help → Contact Us",
              url: "https://author.amazon.com/",
              note: "Only works if you have an Author Central account; create one first if not (free).",
            },
            {
              label: "Amazon public infringement form (if the book uses your name to sell)",
              url: "https://www.amazon.com/report/infringement",
              note: "Choose copyright or right of publicity as applicable.",
            },
          ],
          steps: [
            "Sign in to Author Central, open Help → Contact Us, pick the topic about books on your author page.",
            "Paste the packet with the ASIN. Ask them to remove it from your page.",
            "If the listing uses your name as author, also file the public infringement form citing right of publicity.",
            "If it copies your text or cover, file the infringement form as copyright as well.",
          ],
          subject: `Book not by me on my Author Central page: ASIN ${item.itemId}`,
          body,
          blanks: [],
        };
      }
      const body = [
        "Hello,",
        "",
        "A listing on Amazon is using my name and/or a near-identical title to sell a work that is not mine.",
        "",
        ...common,
        line("Infringing ASIN", item.itemId),
        item.ids?.isbn ? line("Infringing ISBN", item.ids.isbn) : "",
        line("My original title / ASIN", ""),
        "",
        "I am the rights holder. Please remove this listing.",
        "",
        name,
      ].join("\n");
      return {
        platform: "amazon",
        situation,
        title: "Report a lookalike or impersonating listing on Amazon",
        where: [
          {
            label: "Amazon public infringement form",
            url: "https://www.amazon.com/report/infringement",
            note: "Right of publicity for name misuse; copyright for copied text or cover; trademark if you hold one.",
          },
          { label: "KDP: report a violation", url: "https://kdp.amazon.com/en_US/help/topic/G200652490" },
        ],
        steps: [
          "Open the infringement form; sign in with any Amazon account.",
          "Select the type: right of publicity (your name), copyright (your text/cover), or trademark.",
          "Paste the packet. Include your own listing's ASIN as proof of priority.",
          "Also report via KDP's violation form; it routes to the same team with a different queue.",
        ],
        subject: `Impersonating listing: ASIN ${item.itemId}`,
        body,
        blanks: ["Your original title / ASIN"],
      };
    }
    case "goodreads": {
      const body = [
        "Hello,",
        "",
        "A book that I did not write is attached to my author profile. Please remove it.",
        "",
        ...common,
        line("Goodreads book ID", item.itemId),
        "",
        name,
      ].join("\n");
      return {
        platform: "goodreads",
        situation,
        title: "Remove a book from your Goodreads author profile",
        where: [
          {
            label: "Goodreads Support (claimed author profiles)",
            url: "https://help.goodreads.com/s/contactus",
            note: "Librarians cannot edit claimed profiles; support must do it.",
          },
          {
            label: "Goodreads Librarians Group → Book Issues (unclaimed profiles)",
            url: "https://www.goodreads.com/group/show/220-goodreads-librarians-group",
          },
        ],
        steps: [
          "If you have claimed your author profile: contact Goodreads Support with the packet.",
          "If not: post in the Librarians Group, Book Issues folder, with the book link and your profile link.",
          "Goodreads does not delete books; ask for it to be moved off your profile.",
        ],
        subject: `Book not by me on my author profile: ${item.title}`,
        body,
        blanks: [],
      };
    }
    case "googlebooks": {
      return {
        platform: "googlebooks",
        situation,
        title: "Google Books is a signal, not a takedown target",
        where: [{ label: "Google Books partner support", url: "https://support.google.com/books/partner/" }],
        steps: ["Find the same listing on Amazon or the publisher's store and use that platform's packet."],
        subject: `Attribution issue: ${item.title}`,
        body: common.join("\n"),
        blanks: [],
      };
    }
  }
}

export function packetAsText(p: Packet): string {
  const where = p.where.map((w) => `- ${w.label}${w.url ? `: ${w.url}` : ""}${w.note ? ` (${w.note})` : ""}`).join("\n");
  const steps = p.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    p.title,
    "",
    "WHERE TO SEND",
    where,
    "",
    "STEPS",
    steps,
    "",
    `SUBJECT: ${p.subject}`,
    "",
    p.body,
    p.blanks.length ? `\nFill in before sending: ${p.blanks.join(", ")}` : "",
  ].join("\n");
}
