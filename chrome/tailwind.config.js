/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,ts,js}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // Accent colour as a proper Tailwind token so focus rings / opacity
      // modifiers (ring-accent/30, bg-accent/5) work.
      colors: {
        accent: 'var(--accent-color)',
        error:  'var(--error-color)',
      },
    },
  },
  plugins: [],
}
