import { describe, expect, it } from "vitest";
import type { RankedItem } from "../api";
import {
  changeLine, channelBadge, clockFacts, clockLine, hourLabel, oneIn, periodTitle, periodYear, rankingFilters, spanLabel, topHeadline, yearlyHours,
} from "./takeaways";

const item = (o: Partial<RankedItem>): RankedItem => ({
  key: "k", count: 1, time_s: 0, share: 0, rank: 3, prev_rank: null, rank_change: null, comparable: true, is_new: false, ...o,
});

describe("changeLine", () => {
  it("names the previous year for a year range", () => {
    expect(changeLine(-0.616, "2026", 365)).toBe("62% less than 2025.");
  });
  it("uses the period length otherwise", () => {
    expect(changeLine(0.25, "this_year", 328)).toBe("25% more than the 328 days before.");
    expect(changeLine(-0.1, "4w", 28)).toBe("10% less than the 4 weeks before.");
  });
  it("has nothing to say for lifetime or missing data", () => {
    expect(changeLine(0.5, "all", 3000)).toBeNull();
    expect(changeLine(null, "this_year", 300)).toBeNull();
  });
  it("rounds tiny changes to about the same", () => {
    expect(changeLine(0.002, "2025", 365)).toBe("About the same as before.");
  });
});

describe("clock", () => {
  const clock = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 0 ? 50 : hour < 5 ? 0 : 10, time_s: 0 }));
  it("finds the peak and the night share", () => {
    const f = clockFacts(clock)!;
    expect(f.peak).toBe(0);
    expect(f.night).toBeCloseTo(50 / 240);
    expect(clockLine(f)).toBe("is your busiest hour. About 1 in 5 videos started after midnight.");
  });
  it("is null with no watches", () => {
    expect(clockFacts(clock.map((h) => ({ ...h, count: 0 })))).toBeNull();
  });
  it("labels hours", () => {
    expect([0, 9, 12, 21].map(hourLabel)).toEqual(["12 AM", "9 AM", "12 PM", "9 PM"]);
    expect(oneIn(0.24)).toBe("1 in 4");
  });
});

describe("channel badges", () => {
  it("prefers a repeat #1, then new, then climbing, then when found", () => {
    expect(channelBadge(item({ rank: 1, prev_rank: 1 }), 2026)).toBe("#1 before too");
    expect(channelBadge(item({ is_new: true, rank_change: 4 }), 2026)).toBe("new");
    expect(channelBadge(item({ rank_change: 11 }), 2026)).toBe("↑ 11 places");
    expect(channelBadge(item({ rank_change: 1 }), 2026)).toBe("↑ 1 place");
    expect(channelBadge(item({ rank_change: -2, first_watched: "2025-07-17" }), 2026)).toBe("found in 2025");
    expect(channelBadge(item({ first_watched: "2020-04-13" }), 2026)).toBe("since 2020");
    expect(channelBadge(item({}), 2026)).toBeNull();
  });
  it("writes the card headline", () => {
    expect(topHeadline(item({ rank: 1, prev_rank: 1, title: "JomezPro" }))).toBe("JomezPro, again");
    expect(topHeadline(item({ rank: 1, prev_rank: 4, title: "Yes Theory" }))).toBe("Yes Theory, your #1");
  });
});

describe("rankingFilters", () => {
  const base = { range: "this_year", bg: true, metric: "count" as const };
  it("ranks by long videos and music, unless only Shorts are picked", () => {
    expect(rankingFilters({ ...base, buckets: ["long", "short", "music", "unknown"] }).buckets).toEqual(["long", "music"]);
    expect(rankingFilters({ ...base, buckets: ["short"] }).buckets).toEqual(["short"]);
  });
});

describe("years and dates", () => {
  it("sums months into years and skips empty leading years", () => {
    const months = [
      { month: "2017-12", count: 0, time_s: 0 },
      { month: "2018-11", count: 1, time_s: 1800 },
      { month: "2018-12", count: 1, time_s: 5400 },
      { month: "2019-01", count: 1, time_s: 0 },
    ];
    expect(yearlyHours(months)).toEqual([{ year: 2018, hours: 2 }, { year: 2019, hours: 0 }]);
  });
  it("formats spans and period years", () => {
    expect(spanLabel("2026-09-24", "2026-10-15")).toBe("Sep 24 to Oct 15");
    expect(spanLabel("2026-03-16", "2026-03-16")).toBe("Mar 16");
    expect(periodYear("2024", "2026-11-24")).toBe(2024);
    expect(periodYear("this_year", "2026-11-24")).toBe(2026);
    expect(periodYear("4w", "2026-11-24")).toBeNull();
    expect(periodTitle({ range: "this_year" }, "2026-11-24")).toBe("2026 so far");
    expect(periodTitle({ range: "all" }, "2026-11-24")).toBe("Lifetime");
    expect(periodTitle({ range: "custom", start: "2026-01-01", end: "2026-02-01" }, undefined)).toBe("2026-01-01 to 2026-02-01");
  });
});
