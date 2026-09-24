import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
// @ts-expect-error módulo JS sem tipos (plugin local do service worker)
import { pwaPlugin } from './scripts/pwa-plugin.mjs';

/**
 * Versão calculada no build (o deploy sempre faz o build): major.minor do package.json + número de
 * commits como patch, hash curto do commit, "+" se havia alterações não commitadas, e a data.
 * Ex.: "0.1.10 · 3c3fc97+ · 24/09/2026".
 */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  const [major, minor] = pkg.version.split('.');
  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const date = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  try {
    const dirty = git('status --porcelain') ? '+' : '';
    return `${major}.${minor}.${git('rev-list --count HEAD')} · ${git('rev-parse --short HEAD')}${dirty} · ${date}`;
  } catch {
    return `${pkg.version} · ${date}`;
  }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  // Caminhos relativos: o build funciona em qualquer hospedagem estática (GitHub Pages, Netlify...).
  base: './',
  server: { host: true },
  plugins: [pwaPlugin()],
  test: { environment: 'node' },
});
