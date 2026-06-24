/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./*.js"],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Exo 2"', 'system-ui', 'sans-serif'],
      },
      colors: {
        sporty: '#06b6d4',
        tech: '#0f1419',
        accent: '#f59e42',
        surface: {
          DEFAULT: '#161b22',
          light: '#1c2128',
          border: 'rgba(56, 189, 248, 0.12)',
        },
        glow: {
          cyan: '#22d3ee',
          blue: '#818cf8',
          DEFAULT: 'rgba(6, 182, 212, 0.15)',
        },
      },
      boxShadow: {
        'glow-sm': '0 0 8px rgba(6, 182, 212, 0.25)',
        'glow-md': '0 0 16px rgba(6, 182, 212, 0.3)',
        'glow-lg': '0 0 24px rgba(6, 182, 212, 0.35)',
        'glow-accent': '0 0 12px rgba(245, 158, 66, 0.3)',
        'inner-glow': 'inset 0 1px 1px rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-cta': 'linear-gradient(135deg, #06b6d4, #818cf8)',
        'gradient-bar': 'linear-gradient(90deg, #06b6d4, #22d3ee)',
        'gradient-bar-warm': 'linear-gradient(90deg, #f59e42, #fbbf24)',
        'gradient-bar-purple': 'linear-gradient(90deg, #a78bfa, #818cf8)',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out forwards',
        'slide-up': 'slideUp 0.5s ease-out forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(6, 182, 212, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(6, 182, 212, 0.4)' },
        },
      },
    },
  },
  plugins: [],
}
