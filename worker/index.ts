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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/turn') return new Response('Not found', { status: 404 });
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
