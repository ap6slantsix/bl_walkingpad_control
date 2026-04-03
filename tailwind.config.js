/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./*.js"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        sporty: '#0ea5e9',
        tech: '#1e293b',
        accent: '#f59e42',
      },
    },
  },
  plugins: [],
}
