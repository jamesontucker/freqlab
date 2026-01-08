/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      colors: {
        'bg-primary': '#1a1a1a',
        'bg-secondary': '#242424',
        'bg-tertiary': '#2e2e2e',
        'bg-elevated': '#383838',
        'text-primary': '#ffffff',
        'text-secondary': '#a0a0a0',
        'text-muted': '#6b7280',
        'accent': '#2DA86E',
        'accent-hover': '#34B87A',
        'accent-subtle': 'rgba(76, 219, 153, 0.15)',
        'success': '#22c55e',
        'warning': '#f59e0b',
        'error': '#ef4444',
        'error-subtle': 'rgba(239, 68, 68, 0.1)',
        'border': '#3a3a3a',
      },
    },
  },
  plugins: [],
}
