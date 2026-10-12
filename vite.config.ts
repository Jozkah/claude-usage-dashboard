import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, the web app runs on :5173 and talks to the API on :4777 by default.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    open: process.env.NO_OPEN !== '1',
    // changeOrigin must stay false: the API checks that Origin and Host match.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 4777}`, changeOrigin: false } },
  },
});
