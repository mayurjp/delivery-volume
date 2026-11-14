/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Text tokens. Light values meet WCAG AA (>= 4.5:1) on white and on slate-50/100 cards; the previous
      // #0f9d58 / #d9730d measured 3.5 / 3.3 and were the only axe colour-contrast failures. Chart series keep
      // their brighter colours (charts/theme.ts): contrast rules apply to text, not to lines.
      colors: {
        up: { DEFAULT: '#0a7c42', dark: '#34d399' },
        down: { DEFAULT: '#d93025', dark: '#f87171' },
        inc: { DEFAULT: '#1d6fd1', dark: '#60a5fa' },
        dec: { DEFAULT: '#b45309', dark: '#fb923c' },
      },
    },
  },
  plugins: [],
};
