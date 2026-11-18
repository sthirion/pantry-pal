import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `/api` is proxied to WireMock (stubs in ./wiremock) unless API_PROXY_TARGET points at the real API.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
