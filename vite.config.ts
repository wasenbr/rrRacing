import { defineConfig } from 'vite';
// @ts-expect-error módulo JS sem tipos (plugin local do service worker)
import { pwaPlugin } from './scripts/pwa-plugin.mjs';

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer hospedagem estática (GitHub Pages, Netlify...).
  base: './',
  server: { host: true },
  plugins: [pwaPlugin()],
  test: { environment: 'node' },
});
