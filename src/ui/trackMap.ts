import type { Track } from '../sim/track';

export type MapTransform = (x: number, z: number) => [number, number];

/** Transforma coordenadas do mundo em pixels, girado 45° para bater com a vista aérea. */
export function trackTransform(track: Track, width: number, height: number, pad: number): MapTransform {
  const rot = (x: number, z: number): [number, number] => [(z - x) * Math.SQRT1_2, -(x + z) * Math.SQRT1_2];
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of track.sampleCenterline(2)) {
    const [u, v] = rot(p.x, p.z);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const scale = Math.min((width - pad * 2) / (maxU - minU), (height - pad * 2) / (maxV - minV));
  const offU = (width - (maxU - minU) * scale) / 2;
  const offV = (height - (maxV - minV) * scale) / 2;
  return (x, z) => {
    const [u, v] = rot(x, z);
    return [offU + (u - minU) * scale, offV + (v - minV) * scale];
  };
}

/** Desenha o traçado (com contorno), a linha de chegada e as rampas/saltos. */
export function drawTrack(ctx: CanvasRenderingContext2D, track: Track, map: MapTransform, width = 5): void {
  const pts = track.sampleCenterline(2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [w, c] of [[width + 4, 'rgba(0,0,0,0.6)'], [width, '#cfcfe0']] as const) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const [x, y] = map(p.x, p.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.stroke();
  }
  // saltos em amarelo
  ctx.fillStyle = '#ffd21a';
  for (const p of track.pieces) {
    if (p.code !== 'J') continue;
    const pt = track.pointOn(p, p.length * 0.7);
    const [x, y] = map(pt.x, pt.z);
    ctx.beginPath();
    ctx.arc(x, y, width * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const [sx, sy] = map(track.pieces[0].x0, track.pieces[0].z0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(sx - 4, sy - 4, 8, 8);
}
