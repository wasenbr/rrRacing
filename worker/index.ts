/**
 * Worker do jogo: os arquivos estáticos saem direto de ./dist; aqui só passa /api/*.
 * /api/turn devolve servidores ICE com credenciais TURN temporárias da Cloudflare (Realtime),
 * para o jogo online funcionar mesmo atrás de NAT/CGNAT/4G, onde a conexão direta falha.
 * Segredos (uma vez): `npx wrangler secret put TURN_KEY_ID` e `npx wrangler secret put TURN_KEY_API_TOKEN`.
 */
interface Env {
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const TTL = 6 * 3600;
/** Limite simples por IP (por instância do worker): credenciais TURN custam banda. */
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; since: number }>();

/** Só o próprio site pede credenciais (outros sites não usam o nosso TURN). */
function sameSite(req: Request, url: URL): boolean {
  const origin = req.headers.get('Origin');
  if (origin) return origin === url.origin;
  // GET da mesma origem não manda Origin; o navegador manda Sec-Fetch-Site
  const site = req.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';
  const ref = req.headers.get('Referer');
  if (ref) {
    try {
      return new URL(ref).origin === url.origin;
    } catch {
      return false;
    }
  }
  return false;
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.since > RATE_WINDOW_MS) hits.delete(k);
  const h = hits.get(ip);
  if (!h || now - h.since > RATE_WINDOW_MS) {
    hits.set(ip, { n: 1, since: now });
    return false;
  }
  return ++h.n > RATE_MAX;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/turn') return new Response('Not found', { status: 404 });
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    if (!sameSite(req, url)) return Response.json({ error: 'origem não permitida' }, { status: 403 });
    if (rateLimited(req.headers.get('CF-Connecting-IP') ?? 'local')) {
      return Response.json({ error: 'muitas requisições' }, { status: 429, headers: { 'Retry-After': '60' } });
    }
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return Response.json({ error: 'turn não configurado' }, { status: 503 });

    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
    });
    if (!res.ok) return Response.json({ error: `turn ${res.status}` }, { status: 502 });

    const { iceServers } = (await res.json()) as { iceServers: IceServer[] };
    // a porta 53 é bloqueada pelos navegadores e só atrasa a negociação
    const clean = iceServers
      .map((s) => ({ ...s, urls: [s.urls].flat().filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    return Response.json({ iceServers: clean }, { headers: { 'Cache-Control': 'no-store' } });
  },
};
