/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        up: { DEFAULT: '#0f9d58', dark: '#34d399' },
        down: { DEFAULT: '#d93025', dark: '#f87171' },
        inc: { DEFAULT: '#1d6fd1', dark: '#60a5fa' },
        dec: { DEFAULT: '#d9730d', dark: '#fb923c' },
      },
    },
  },
  plugins: [],
};
