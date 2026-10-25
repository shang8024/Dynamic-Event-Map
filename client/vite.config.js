import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from 'node:process';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {target:process.env.VITE_API_PROXY_TARGET||'http://127.0.0.1:5000',changeOrigin:true},
      '/socket.io': {target:process.env.VITE_API_PROXY_TARGET||'http://127.0.0.1:5000',ws:true,changeOrigin:true},
    },
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
});
