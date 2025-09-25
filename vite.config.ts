import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // make built asset URLs relative, so file:// works in Electron prod
  base: './',
})
