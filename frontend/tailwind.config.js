/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        fintech: {
          navy: '#0B132B',
          slate: '#1C2541',
          accent: '#3A86FF',
          dark: '#070D1E',
          card: '#161F38',
          border: '#233054',
          muted: '#8A99AD'
        }
      }
    },
  },
  plugins: [],
}
