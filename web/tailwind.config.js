/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe8ff",
          500: "#5b8def",
          600: "#3a6fe0",
          700: "#2c54b0",
          900: "#0f1f4a",
        },
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
          950: "#020617",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(91,141,239,0.4), 0 8px 30px -8px rgba(91,141,239,0.45)",
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 16px -6px rgba(15,23,42,0.08)",
      },
    },
  },
  plugins: [],
};
