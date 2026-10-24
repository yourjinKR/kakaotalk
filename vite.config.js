import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/socket.io': { target: 'http://127.0.0.1:4100', ws: true },
    },
  },
});
