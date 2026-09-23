// Publica o jogo no Cloudflare (Workers com arquivos estáticos; configuração em wrangler.jsonc).
// Uso: `npm run deploy` (produção) ou `npm run deploy:preview` (link de teste, não mexe na produção).
// Primeira vez: `npx wrangler login` (abre o navegador) ou defina CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID.
import { execSync } from 'node:child_process';

const preview = process.argv.includes('--preview');
// comandos fixos (sem nada vindo de fora), então passar pelo shell é seguro e funciona no Windows
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

// 1) conta conectada?
try {
  execSync('npx wrangler whoami', { stdio: 'ignore' });
} catch {
  console.error('Não há conta Cloudflare conectada. Rode `npx wrangler login` e tente de novo.');
  process.exit(1);
}

// 2) testes + build
run('npm test');
run('npm run build');

// 3) envia a pasta dist (a prévia sobe uma versão sem ativar e mostra o link dela)
run(preview ? 'npx wrangler versions upload --preview-alias preview' : 'npx wrangler deploy');
