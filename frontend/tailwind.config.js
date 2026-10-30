/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Apple's dark-mode system colors: black canvas, elevated gray layers, hairline separators, system blue.
        canvas: '#000000',
        surface: '#1C1C1E',
        raised: '#2C2C2E',
        line: '#38383A',
        'line-strong': '#48484A',
        muted: '#98989F',
        brand: { DEFAULT: '#0A84FF', soft: '#64A8FF', deep: '#0071E3' },
        emerald: { 300: '#6EE08F', 400: '#30D158' },                       // systemGreen
        amber: { 100: '#FFEBC8', 200: '#FFD99A', 300: '#FFB840', 400: '#FF9F0A' }, // systemOrange
        rose: { 200: '#FFB8B3', 300: '#FF8A82', 400: '#FF453A', 500: '#FF3B30' }, // systemRed
        red: { 300: '#FF8A82', 400: '#FF453A', 500: '#FF3B30' },
        sky: { 100: '#E0F5FF', 300: '#8EDCFF', 400: '#64D2FF' },            // systemCyan
        violet: { 300: '#DA8FFF', 400: '#BF5AF2' },                         // systemPurple
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'SF Pro Display', 'system-ui', 'Helvetica Neue', 'sans-serif'],
        mono: ['SF Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'pop-in': { from: { opacity: 0, transform: 'scale(.96)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .3s cubic-bezier(.25,.1,.25,1) both',
        'slide-in': 'slide-in .35s cubic-bezier(.32,.72,0,1) both',
        'pop-in': 'pop-in .28s cubic-bezier(.32,.72,0,1) both',
      },
    },
  },
  plugins: [],
}
