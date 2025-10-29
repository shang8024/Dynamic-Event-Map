// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  safelist: [
    // add the ones you build dynamically:
    "btn-primary","btn-secondary","bg-green-500","bg-red-500",
    // or patterns:
    { pattern: /btn-(primary|secondary|ghost)/ },
    { pattern: /bg-(red|green|blue)-(100|500|700)/ },
  ],
  plugins: [require("daisyui")],
  daisyui: { themes: ["light"] } // set your default (see #2)
}
