// Chart colors. Validated with the dataviz palette checker against the card surface #181818.

export let surface = "#181818";
export const ink = "#f1f1f1";
export const sub = "#aaaaaa";
export const muted = "#717171";
export const grid = "#2a2a2a";
export const axis = "#3a3a3a";
export let empty = "#232323"; // a zero cell: neutral, so "none" never reads as "a little"

/* Per-platform chart colors. Each ramp is one hue, dark (low) -> bright (high), lightness strictly
   increasing (checked with the dataviz validator), with the bright end >= 3:1 on that theme's card. */
interface ChartTheme { accent: string; accentHi: string; ramp: string[]; surface: string; empty: string }
const CHART_THEMES: Record<string, ChartTheme> = {
  youtube: {
    accent: "#ff3355", accentHi: "#ff7a8c", surface: "#181818", empty: "#232323",
    ramp: ["#3a171b", "#5e1a21", "#871b27", "#b0192c", "#d91533", "#ff3355", "#ff7a8c"],
  },
  netflix: {
    accent: "#e50914", accentHi: "#ff858b", surface: "#1c1c1c", empty: "#262626",
    ramp: ["#3b1416", "#5f1519", "#8a141c", "#b5111d", "#e50914", "#f6404a", "#ff858b"],
  },
  crunchyroll: {
    accent: "#ff640a", accentHi: "#ffa36b", surface: "#151515", empty: "#272727",
    ramp: ["#3d1a05", "#632707", "#8f3708", "#be4a08", "#ff640a", "#ff8a45", "#ffb98a"],
  },
};

/** Single measure (one series): the platform's accent. These are live bindings: setChartTheme() swaps them. */
export let accent = CHART_THEMES.youtube.accent;
export let accentHi = CHART_THEMES.youtube.accentHi;
/** Sequential ramp in the platform's accent hue. */
export let redRamp = CHART_THEMES.youtube.ramp;

/** Called when entering a platform, before its pages render. Unknown themes keep YouTube's colors. */
export function setChartTheme(theme: string) {
  const t = CHART_THEMES[theme] ?? CHART_THEMES.youtube;
  accent = t.accent;
  accentHi = t.accentHi;
  redRamp = t.ramp;
  surface = t.surface;
  empty = t.empty;
}

/** Categorical slots (fixed order, never cycled; 9th+ folds into Other). All checks pass on #181818. */
export const categorical = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767",
];
export const otherColor = "#5f5f5f";

export const tooltipStyle = {
  backgroundColor: "#282828",
  borderColor: "#3a3a3a",
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: ink, fontFamily: "Roboto, system-ui, sans-serif", fontSize: 12 },
  extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);",
};

export const axisLabel = { color: muted, fontSize: 11, fontFamily: "Roboto, system-ui, sans-serif" };
