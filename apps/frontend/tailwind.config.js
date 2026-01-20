/** @type {import('tailwindcss').Config} */
export default {
  // Web app should not scan overlay sources (and especially overlay/node_modules) for class usage.
  // Overlay has its own Tailwind config under overlay/tailwind.config.js.
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#111827',
          surface: '#1f2937',
          text: '#f9fafb',
          border: '#374151',
        },
        primary: {
          DEFAULT: 'var(--primary-color)',
        },
        secondary: {
          DEFAULT: 'var(--secondary-color)',
        },
        accent: {
          DEFAULT: 'var(--accent-color)',
        },
      },
    },
  },
  plugins: [],
};


