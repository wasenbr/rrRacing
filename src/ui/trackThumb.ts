import { Track, type TrackDef } from '../sim/track';
import { trackTransform } from './trackMap';

/** Cores de cada planeta para as miniaturas (fundo, pista, borda). */
const PALETTE: Record<string, { bg: [string, string]; road: string; edge: string; glow: string }> = {
  chem6: { bg: ['#3a1a14', '#0c0606'], road: '#3a363e', edge: '#e0302a', glow: '#ff8a2a' },
  drakonis: { bg: ['#2a1244', '#07030e'], road: '#3a2a5a', edge: '#a050e0', glow: '#6aff40' },
  bogmire: { bg: ['#10304a', '#03080e'], road: '#6a4a2c', edge: '#b08a50', glow: '#80c0ff' },
  newmojave: { bg: ['#6a3a1a', '#140a04'], road: '#6a5a4a', edge: '#f0f0f0', glow: '#ffd070' },
  nho: { bg: ['#1a3040', '#03070c'], road: '#c8dce8', edge: '#40a0c0', glow: '#40e0ff' },
  inferno: { bg: ['#6a1a06', '#120302'], road: '#3a2a26', edge: '#ff5010', glow: '#ff5010' },
};

const cache = new Map<string, string>();

/**
 * Miniatura de uma pista (traçado em vista aérea com as cores do planeta).
 * @returns data URL PNG
 */
export function trackThumbnail(def: TrackDef, width = 200, height = 130): string {
  const key = `${def.id}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pal = PALETTE[def.theme] ?? PALETTE.chem6;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(width / 2, height * 0.4, 4, width / 2, height / 2, width * 0.75);
  g.addColorStop(0, pal.bg[0]);
  g.addColorStop(1, pal.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  // estrelas de fundo (determinísticas)
  let seed = def.id.length * 977 + def.id.charCodeAt(0);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 26; i++) ctx.fillRect(rnd() * width, rnd() * height, 1, 1);

  let track: Track;
  try {
    track = new Track(def);
  } catch {
    cache.set(key, c.toDataURL());
    return c.toDataURL();
  }
  const pad = Math.round(Math.min(width, height) * 0.12);
  const map = trackTransform(track, width, height, pad);
  const pts = track.sampleCenterline(2);
  const w = Math.max(5, Math.min(width, height) * 0.07);
  const path = () => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = map(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // "bloco" elevado: sombra deslocada para baixo, como as pistas flutuantes do original
  ctx.save();
  ctx.translate(0, w * 0.7);
  path();
  ctx.lineWidth = w + 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.stroke();
  ctx.restore();
  path();
  ctx.lineWidth = w + 5;
  ctx.shadowColor = pal.glow;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = pal.edge;
  ctx.stroke();
  ctx.shadowBlur = 0;
  path();
  ctx.lineWidth = w;
  ctx.strokeStyle = pal.road;
  ctx.stroke();
  path();
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.stroke();
  ctx.setLineDash([]);
  // rampas e saltos
  for (const p of track.pieces) {
    if (p.code !== 'J' && p.code !== 'U' && p.code !== 'B') continue;
    const pt = track.pointOn(p, p.length * 0.6);
    const [x, y] = map(pt.x, pt.z);
    ctx.fillStyle = p.code === 'J' ? '#ffd21a' : p.code === 'B' ? '#ff7a2a' : '#8adfff';
    ctx.beginPath();
    ctx.arc(x, y, w * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }
  // largada quadriculada
  const [sx, sy] = map(track.pieces[0].x0, track.pieces[0].z0);
  const s = Math.max(3, w * 0.35);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = (i + Math.floor(i / 2)) % 2 ? '#111' : '#fff';
    ctx.fillRect(sx - s + (i % 2) * s, sy - s + Math.floor(i / 2) * s, s, s);
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
