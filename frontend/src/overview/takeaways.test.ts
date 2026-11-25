import { describe, expect, it } from "vitest";
import {
  changeLine, clockFacts, clockLine, comparison, hourLabel, hoursShort, oneIn, periodTitle, periodYear, rankMove,
  HEAT, calendarWeeks, groupReigns, heatColor, longestReign, rankingFilters, weekendLine, spanLabel, topHeadline, weekdayFacts, yearlyHours, yearsToShow,
} from "./takeaways";

describe("comparison", () => {
  it("compares this year with the same dates last year", () => {
    expect(comparison({ range: "this_year" }, "2026-11-24"))
      .toEqual({ label: "this time last year", start: "2025-01-01", end: "2025-11-24" });
    expect(comparison({ range: "this_year" }, "2028-02-29")?.end).toBe("2027-02-28");
  });
  it("names the previous year or period otherwise", () => {
    expect(comparison({ range: "2025" }, "2026-11-24")).toEqual({ label: "2024" });
    expect(comparison({ range: "4w" }, "2026-11-24")).toEqual({ label: "the 4 weeks before" });
    expect(comparison({ range: "all" }, "2026-11-24")).toBeNull();
  });
});

describe("changeLine", () => {
  it("says more or less than the comparison", () => {
    expect(changeLine(227, 516, "this time last year")).toBe("56% less than this time last year.");
    expect(changeLine(125, 100, "2024")).toBe("25% more than 2024.");
    expect(changeLine(100.2, 100, "2024")).toBe("About the same as 2024.");
  });
  it("has nothing to say without a comparison", () => {
    expect(changeLine(10, 0, "2024")).toBeNull();
    expect(changeLine(10, undefined, "2024")).toBeNull();
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
  it("finds the busiest weekday", () => {
    const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, () => (d === 5 ? 3 : 1)));
    expect(weekdayFacts(grid)).toEqual({ totals: [24, 24, 24, 24, 24, 72, 24], busiest: "Saturday" });
    expect(weekdayFacts(grid.map((r) => r.map(() => 0)))).toBeNull();
  });
  it("labels hours", () => {
    expect([0, 9, 12, 21].map(hourLabel)).toEqual(["12 AM", "9 AM", "12 PM", "9 PM"]);
    expect(oneIn(0.24)).toBe("1 in 4");
  });
});

describe("top channels", () => {
  it("shows one kind of badge: places moved since the comparison", () => {
    expect(rankMove(2, 12)).toEqual({ text: "↑ 10", tone: "up" });
    expect(rankMove(5, 3)).toEqual({ text: "↓ 2", tone: "down" });
    expect(rankMove(1, 1)).toEqual({ text: "same spot", tone: "same" });
    expect(rankMove(4, null)).toEqual({ text: "new", tone: "new" });
    expect(rankMove(4, undefined)).toBeNull();
  });
  it("writes the card headline", () => {
    expect(topHeadline("JomezPro", 1)).toBe("JomezPro, again");
    expect(topHeadline("Yes Theory", 4)).toBe("Yes Theory, your #1");
  });
  it("formats hours so the order reads right", () => {
    expect(hoursShort(35324)).toBe("9.8 h");
    expect(hoursShort(40389)).toBe("11 h");
    expect(hoursShort(3600 * 2)).toBe("2 h");
  });
});

describe("rankingFilters", () => {
  const base = { range: "this_year", bg: true, metric: "count" as const };
  it("ranks by long videos and music, unless only Shorts are picked", () => {
    expect(rankingFilters({ ...base, buckets: ["long", "short", "music", "unknown"] }).buckets).toEqual(["long", "music"]);
    expect(rankingFilters({ ...base, buckets: ["short"] }).buckets).toEqual(["short"]);
  });
});

describe("#1 channel each year", () => {
  it("only shows for Lifetime or ranges of 4+ years", () => {
    expect(yearsToShow({ range: "all" }, "2018-11-30", "2026-11-25")).toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(yearsToShow({ range: "custom", start: "2022-06-28", end: "2026-11-25" }, null, "2026-11-25")).toEqual([2022, 2023, 2024, 2025, 2026]);
    expect(yearsToShow({ range: "custom", start: "2024-01-01", end: "2026-11-25" }, null, "2026-11-25")).toBeNull();
    expect(yearsToShow({ range: "this_year" }, "2018-11-30", "2026-11-25")).toBeNull();
    expect(yearsToShow({ range: "2025" }, "2018-11-30", "2026-11-25")).toBeNull();
  });
  it("merges runs of the same #1 into reigns", () => {
    const row = (year: number, channel_id: string, h: number) => ({ year, channel_id, time_s: h * 3600 });
    const reigns = groupReigns([row(2019, "S", 17), row(2020, "I", 93), row(2021, "I", 88), row(2022, "I", 38),
                                row(2023, "W", 32), row(2025, "J", 50), row(2026, "J", 20)]);
    expect(reigns.map((r) => [r.from, r.to, r.years.length, r.total_s / 3600])).toEqual([
      [2019, 2019, 1, 17], [2020, 2022, 3, 219], [2023, 2023, 1, 32], [2025, 2026, 2, 70],
    ]);
    // a gap year breaks a run even for the same channel
    expect(groupReigns([row(2020, "A", 1), row(2022, "A", 1)])).toHaveLength(2);
  });
  it("finds the longest run of the same #1", () => {
    const tops = [
      { year: 2019, title: "SquishyMuffinz" }, { year: 2020, title: "IMPAULSIVE" }, { year: 2021, title: "IMPAULSIVE" },
      { year: 2022, title: "IMPAULSIVE" }, { year: 2025, title: "JomezPro" }, { year: 2026, title: "JomezPro" },
    ];
    expect(longestReign(tops)).toEqual({ title: "IMPAULSIVE", years: 3 });
    expect(longestReign([{ year: 2020, title: "A" }, { year: 2022, title: "A" }])).toEqual({ title: "A", years: 1 });
    expect(longestReign([])).toBeNull();
  });
});

describe("patterns helpers", () => {
  it("maps values to a ramp that only gets darker", () => {
    expect(heatColor(0, 10)).toBe(HEAT[0]);
    expect(heatColor(10, 10)).toBe(HEAT[HEAT.length - 1]);
    expect(heatColor(1, 10)).toBe(HEAT[1]);
  });
  it("compares weekdays and weekends in one line", () => {
    expect(weekendLine(1, 2.1)).toBe("2.1× as much on a weekend day as on a weekday.");
    expect(weekendLine(2, 1)).toBe("2× as much on a weekday as on a weekend day.");
    expect(weekendLine(1, 1.05)).toBe("About the same on weekdays and weekends.");
  });
  it("lays days out in Monday-first week columns", () => {
    // 2026-11-25 is a Wednesday: two empty cells first
    const weeks = calendarWeeks([{ date: "2026-11-25" }, { date: "2026-11-26" }, { date: "2026-11-27" },
                                 { date: "2026-11-28" }, { date: "2026-11-29" }, { date: "2026-11-30" }]);
    expect(weeks[0].slice(0, 3)).toEqual([null, null, { date: "2026-11-25" }]);
    expect(weeks[1][0]).toEqual({ date: "2026-11-30" });
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
