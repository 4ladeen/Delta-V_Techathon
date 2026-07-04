/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Light theme backgrounds & surfaces
        void: "#F0F4F8",          // page background — pale blue-grey
        surface: "#E8EDF2",       // subtle alternate bg
        panel: "#FFFFFF",         // card / panel background
        panelHover: "#F7FAFC",    // card hover state
        line: "#CBD5E1",          // borders & dividers
        mist: "#64748B",          // secondary / muted text
        fog: "#1E293B",           // primary body text (dark on light)
        // Accent colours — unchanged, vibrant on white
        signal: "#D97706",        // amber (slightly deepened for contrast)
        pulse: "#0D9488",         // teal (deepened for WCAG AA on white)
        pulseDeep: "#0F766E",
        alarm: "#DC2626",         // red
        caution: "#EA580C",       // orange
        success: "#16A34A",       // green
        highlight: "#6366F1",     // indigo
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px 4px rgba(217,119,6,0.2)",
        pulseGlow: "0 0 20px 4px rgba(13,148,136,0.2)",
        alarmGlow: "0 0 20px 4px rgba(220,38,38,0.2)",
        card: "0 2px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06)",
        cardHover: "0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)",
      },
      backgroundImage: {
        "grid-pattern": "linear-gradient(rgba(203,213,225,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(203,213,225,0.6) 1px, transparent 1px)",
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      backgroundSize: {
        "grid": "32px 32px",
      },
      keyframes: {
        spin: { to: { transform: "rotate(360deg)" } },
        flicker: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
        "slide-in": { "0%": { transform: "translateX(100%)", opacity: "0" }, "100%": { transform: "translateX(0)", opacity: "1" } },
        "slide-down": { "0%": { transform: "translateY(-12px)", opacity: "0" }, "100%": { transform: "translateY(0)", opacity: "1" } },
        "fade-in": { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        "scale-in": { "0%": { transform: "scale(0.95)", opacity: "0" }, "100%": { transform: "scale(1)", opacity: "1" } },
        "pulse-ring": {
          "0%": { transform: "scale(0.8)", opacity: "1" },
          "100%": { transform: "scale(2)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fan-spin": "spin 0.8s linear infinite",
        "fan-spin-slow": "spin 2.2s linear infinite",
        flicker: "flicker 2s ease-in-out infinite",
        "slide-in": "slide-in 0.35s cubic-bezier(0.16,1,0.3,1)",
        "slide-down": "slide-down 0.3s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
        "scale-in": "scale-in 0.3s cubic-bezier(0.16,1,0.3,1)",
        "pulse-ring": "pulse-ring 1.5s cubic-bezier(0.215,0.61,0.355,1) infinite",
        shimmer: "shimmer 2s infinite linear",
      },
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
