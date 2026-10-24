/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: '#0A0E17',
        surface: '#101523',
        raised: '#161C2D',
        line: '#1F2740',
        'line-strong': '#2B3556',
        muted: '#8B94AB',
        brand: { DEFAULT: '#6D7CFF', soft: '#8B97FF', deep: '#4F5DE0' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'pop-in': { from: { opacity: 0, transform: 'scale(.96)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out both',
        'slide-in': 'slide-in .25s cubic-bezier(.2,.8,.2,1) both',
        'pop-in': 'pop-in .18s ease-out both',
      },
    },
  },
  plugins: [],
}
