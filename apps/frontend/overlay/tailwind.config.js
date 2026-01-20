/** @type {import('tailwindcss').Config} */
export default {
  // Keep globs tight to avoid accidentally scanning overlay/node_modules (slow builds on Windows).
  content: ['./index.html', './**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: 'var(--primary-color)' },
        secondary: { DEFAULT: 'var(--secondary-color)' },
        accent: { DEFAULT: 'var(--accent-color)' },
      },
    },
  },
  plugins: [],
};


