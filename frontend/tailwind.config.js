/** A theme color: `rgb(var(--c-x) / alpha)`, so opacity modifiers like bg-yt/15 still work. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Colors come from CSS variables (see index.css) so each platform has its own theme.
      // `yt` is the theme's accent color (YouTube red on YouTube).
      colors: {
        bg: v("bg"),
        card: v("card"),
        raised: v("raised"),
        line: v("line"),
        ink: v("ink"),
        sub: v("sub"),
        muted: v("muted"),
        yt: { DEFAULT: v("accent"), dark: v("accent-dark"), soft: v("accent-soft") },
        up: v("up"),
        down: v("down"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { card: "var(--radius-card, 12px)" },
    },
  },
  plugins: [],
};
