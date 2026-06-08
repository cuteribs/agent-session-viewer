/** @type {import('tailwindcss').Config} */
import clientConfig from '../client/tailwind.config.js'

export default {
  ...clientConfig,
  content: [
    './index.html',
    './src/**/*.{vue,ts,js}',
    '../client/src/**/*.{vue,ts,js}',
  ],
}
