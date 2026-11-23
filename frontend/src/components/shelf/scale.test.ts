import { describe, expect, it } from "vitest";
import { flatSpineHeight, hoursFontSize, nameFontSize, shortWait, spineSize, waitRank, yearBoxHeight } from "./scale";

const GLYPH = 0.42; // Bebas Neue's average advance, in em

describe("spineSize", () => {
  it("biggest app is 220 x 460, smallest about 56 wide", () => {
    expect(spineSize(4135, 4135)).toEqual({ w: 220, h: 460 });
    expect(spineSize(0, 4135)).toEqual({ w: 56, h: 400 });
    expect(spineSize(176, 4135).w).toBe(63);
  });
  it("caps the width on tablets and survives an empty max", () => {
    expect(spineSize(4135, 4135, 180).w).toBe(180);
    expect(spineSize(5, 0)).toEqual({ w: 220, h: 460 });
  });
});

describe("labels never leave the spine", () => {
  const names = ["YouTube", "Netflix", "Crunchyroll", "Prime Video", "Apple TV Plus"].filter((n) => n.length <= 12);
  for (const pct of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1]) {
    for (const name of [...names, "ABCDEFGHIJKL"]) {
      it(`${name} at ${pct * 100}%`, () => {
        const { w, h } = spineSize(pct * 1000, 1000);
        const size = nameFontSize(w, h, name);
        expect(size).toBeLessThanOrEqual(w * 0.6);                    // across: the spine's thickness
        expect(name.length * GLYPH * size).toBeLessThanOrEqual(h - 130); // along: leaves room top and bottom
      });
    }
  }
  it("hours fit across the spine", () => {
    for (const pct of [0.01, 0.5, 1]) {
      const { w } = spineSize(pct * 1000, 1000);
      expect("12,345 H".length * GLYPH * hoursFontSize(w)).toBeLessThanOrEqual(w + 1);
    }
  });
});

describe("other sizes", () => {
  it("year boxes and flat spines grow with hours", () => {
    expect(yearBoxHeight(1144, 1144)).toBe(250);
    expect(yearBoxHeight(0, 1144)).toBe(120);
    expect(flatSpineHeight(4135, 4135)).toBe(120);
    expect(flatSpineHeight(176, 4135)).toBe(59);
  });
});

describe("export wait", () => {
  it("ranks fastest first", () => {
    const waits = ["up to 30 days", "instant (quick) or a few days (full)", "minutes to hours", "a minute (unofficial)", "up to ~14 days"];
    expect([...waits].sort((a, b) => waitRank(a) - waitRank(b))).toEqual([
      "instant (quick) or a few days (full)", "a minute (unofficial)", "minutes to hours", "up to ~14 days", "up to 30 days"]);
    expect(waitRank("")).toBe(9);
  });
  it("shortens for a slot", () => {
    expect(shortWait("instant (quick) or a few days (full)")).toBe("instant");
    expect(shortWait("a few days (link expires after ~4 days)")).toBe("a few days");
    expect(shortWait("up to 30 days")).toBe("up to 30 days");
  });
});
