import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// base = nombre del repositorio en GitHub (obligatorio para GitHub Pages).
export default defineConfig({
  base: '/tiempos-web/',
  plugins: [react()],
})
