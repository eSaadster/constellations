import { describe, expect, it } from "vitest";
import {
  cleanSlackText,
  extractArtifacts,
  extractAsks,
  extractDates,
  extractDecisions,
  extractEntities,
  extractFacts,
  extractPeople,
  resolveActorIds,
  slackMentionIds,
} from "../../extraction/heuristics.js";

const USERS = new Map([
  ["U076FDG8K9B", "Ali Zaidi <ali@phi.consulting>"],
  ["U08L4B53J2U", "Saad Farooq <saad@data-grid.ai>"],
]);

describe("cleanSlackText", () => {
  it("resolves user mentions to bare names", () => {
    expect(cleanSlackText("ping <@U076FDG8K9B> about this", USERS)).toBe(
      "ping @Ali Zaidi about this",
    );
  });

  it("keeps the raw id for unknown users and unwraps channels/links", () => {
    expect(cleanSlackText("<@U000UNKNOWN> see <#C123ABC|standup> and <https://x.ai/doc|the doc>")).toBe(
      "@U000UNKNOWN see #standup and https://x.ai/doc",
    );
  });
});

describe("slackMentionIds / resolveActorIds", () => {
  it("collects mention ids from raw markup", () => {
    expect(slackMentionIds("<@U076FDG8K9B> and <@U08L4B53J2U|saad>")).toEqual([
      "U076FDG8K9B",
      "U08L4B53J2U",
    ]);
  });

  it("maps actor ids to Name <email> form, passing unknown ids through", () => {
    expect(resolveActorIds(["U076FDG8K9B", "U999"], USERS)).toEqual([
      "Ali Zaidi <ali@phi.consulting>",
      "U999",
    ]);
  });
});

describe("extractArtifacts", () => {
  it("does not leak Slack |label> tails into URLs", () => {
    // Live bug: stored excerpts contain "<http://postjobfree.com|postjobfree.com>"
    const text = cleanSlackText("see <http://postjobfree.com|postjobfree.com> today");
    expect(extractArtifacts(text)).toEqual(["http://postjobfree.com"]);
  });

  it("strips trailing punctuation", () => {
    expect(extractArtifacts("read https://docs.x.ai/spec.")).toEqual(["https://docs.x.ai/spec"]);
  });
});

describe("extractPeople", () => {
  it("does not treat email domains as @mentions", () => {
    // Live bug: "uatech.events@calendar.luma-mail.com" produced people:["calendar.luma-mail.com"]
    expect(extractPeople("mail uatech.events@calendar.luma-mail.com now")).toEqual([
      "uatech.events@calendar.luma-mail.com",
    ]);
  });

  it("captures forwarded From: headers as Name <email>", () => {
    const people = extractPeople("From: Raza Rehman <raza@phi.consulting>\nDate: Tue");
    expect(people).toContain("Raza Rehman <raza@phi.consulting>");
  });

  it("captures plain @mentions", () => {
    expect(extractPeople("cc @haris on this")).toEqual(["haris"]);
  });
});

describe("extractDates", () => {
  it("finds month-day and ISO forms", () => {
    const dates = extractDates("Starting from June 8th, then 2026-06-10 and Jun 9, 2026");
    expect(dates).toContain("June 8th");
    expect(dates).toContain("2026-06-10");
    expect(dates).toContain("Jun 9, 2026");
  });
});

describe("extractAsks / extractDecisions", () => {
  it("keeps request sentences and drops statements", () => {
    const asks = extractAsks("Can you review the doc by Friday? The weather is nice.");
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatch(/review the doc/);
  });

  it("detects decision language", () => {
    const decisions = extractDecisions(
      "We decided to go with Postgres. Lunch was great. Switching to weekly syncs going forward.",
    );
    expect(decisions.some((d) => /Postgres/.test(d))).toBe(true);
    expect(decisions.some((d) => /weekly syncs/.test(d))).toBe(true);
    expect(decisions.some((d) => /Lunch/.test(d))).toBe(false);
  });
});

describe("extractEntities", () => {
  it("extracts multi-word proper phrases and strong singles", () => {
    const entities = extractEntities(
      undefined,
      "Successful kick off for both Tentrucks and DPB. Work with TruckerZoom on it.",
    );
    expect(entities).toContain("Tentrucks");
    expect(entities).toContain("DPB");
    expect(entities).toContain("TruckerZoom");
  });

  it("ignores plain sentence-initial capitalization", () => {
    expect(extractEntities(undefined, "Starting from next month. Working on it.")).toEqual([]);
  });

  it("does not bridge sentence boundaries", () => {
    const entities = extractEntities(undefined, "talked to Bob. Apollo review is set.");
    expect(entities).not.toContain("Bob Apollo");
    expect(entities).toContain("Bob");
  });

  it("handles calendar-title name runs", () => {
    const entities = extractEntities("Daily Huddle - Saad/AZ/Haris/Mahad", "");
    expect(entities).toContain("Daily Huddle");
    // The slash-separated name run joins into one stable phrase — identical
    // across recurrences of the series, which is what matching needs.
    expect(entities).toContain("Saad AZ Haris Mahad");
  });
});

describe("extractFacts", () => {
  it("slack: resolves mentions into people and cleans link markup", () => {
    const facts = extractFacts({
      source: "slack",
      text: "<@U076FDG8K9B> please review <http://signalhire.com|signalhire.com> for Tentrucks",
      slackUsers: USERS,
    });
    expect(facts.people).toContain("Ali Zaidi <ali@phi.consulting>");
    expect(facts.artifacts).toEqual(["http://signalhire.com"]);
    expect(facts.entities).toContain("Tentrucks");
    expect(facts.asks.length).toBeGreaterThan(0);
  });

  it("email: decodes entities and reads forwarded headers", () => {
    const facts = extractFacts({
      source: "email",
      title: "Fwd: Apollo Launch Review",
      text: "---------- Forwarded message ---------\nFrom: Raza Rehman <raza@phi.consulting>\nLet&#39;s meet June 12th",
    });
    expect(facts.people).toContain("Raza Rehman <raza@phi.consulting>");
    expect(facts.entities).toContain("Apollo Launch Review");
    expect(facts.dates).toContain("June 12th");
  });
});
