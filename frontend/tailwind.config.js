/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // YouTube dark theme
        bg: "#0f0f0f",
        card: "#181818",
        raised: "#212121",
        line: "#303030",
        ink: "#f1f1f1",
        sub: "#aaaaaa",
        muted: "#717171",
        yt: { DEFAULT: "#ff0033", dark: "#cc0029", soft: "#ff3355" },
        up: "#2ba640",
        down: "#ff4e45",
      },
      fontFamily: { sans: ["Roboto", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
      borderRadius: { card: "12px" },
    },
  },
  plugins: [],
};
