import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer hospedagem estática (GitHub Pages, Netlify...).
  base: './',
  server: { host: true },
  test: { environment: 'node' },
});
