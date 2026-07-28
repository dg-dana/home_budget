import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_PORT = process.env.PORT ?? '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the frontend runs on its own port and forwards API calls
    // to the Express server, so cookies stay same-origin.
    proxy: {
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
