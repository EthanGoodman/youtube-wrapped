// Chart colors. Validated with the dataviz palette checker against the card surface #181818.

export const surface = "#181818";
export const ink = "#f1f1f1";
export const sub = "#aaaaaa";
export const muted = "#717171";
export const grid = "#2a2a2a";
export const axis = "#3a3a3a";
export const empty = "#232323"; // a zero cell: neutral, so "none" never reads as "a little"

/** Single measure (one series): YouTube red. */
export const accent = "#ff3355";

/** Sequential YouTube-red ramp, dark (low) -> bright (high); lightness strictly increasing. */
export const redRamp = ["#3a171b", "#5e1a21", "#871b27", "#b0192c", "#d91533", "#ff3355", "#ff7a8c"];

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
