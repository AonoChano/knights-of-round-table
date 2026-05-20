import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f6f3ee",
        panel: "#fbfaf7",
        ink: "#171717",
        muted: "#6a6a67",
        line: "rgba(23,23,23,0.08)",
        accent: "#161616",
      },
      boxShadow: {
        card: "0 16px 40px rgba(31, 28, 24, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
