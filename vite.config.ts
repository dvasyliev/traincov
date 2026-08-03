import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS у dev потрібен для geolocation і Wake Lock на телефоні (задачі 04 і 07).
// Вмикається через `npm run dev:https` (HTTPS=true).
const useHttps = process.env.HTTPS === 'true';

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
