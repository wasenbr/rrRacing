import * as THREE from 'three';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const ORDINAL = ['', '1º', '2º', '3º', '4º', '5º', '6º'];

/** Cor de uma esfera de blindagem conforme quanto resta (verde → amarelo → vermelho). */
export function armorColor(ratio: number): string {
  if (ratio > 0.6) return '#3cff4a';
  if (ratio > 0.3) return '#ffd21a';
  return '#ff3a1a';
}

/** Retângulos do HUD na tela (atualizados no máximo 2x por segundo). */
let hudRects: DOMRect[] = [];
let hudRectsAt = -1;
function hudBlocks(): DOMRect[] {
  const now = performance.now();
  if (now - hudRectsAt > 500) {
    hudRectsAt = now;
    hudRects = Array.from(document.querySelectorAll('.rh-left, .rh-right')).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
  }
  return hudRects;
}
const NDC = new THREE.Vector3();
const VIEW = new THREE.Vector3();
const UP1 = new THREE.Vector3();

/** tamanho da etiqueta no mundo (largura x altura) */
const TAG_W = 4.6;
const TAG_H = 2.01;
/** perto da câmera ela não cresce mais que o tamanho que teria a esta distância (m) */
const TAG_NEAR = 16;
/** abaixo disto (m) some: taparia a visão */
const TAG_HIDE = 4;

/**
 * Etiquetas já desenhadas neste quadro (centro e meia-extensão em NDC), para empurrar as
 * sobrepostas para cima. Vetor fixo reaproveitado: zera quando muda o quadro/câmera.
 */
const placed: { x: number; y: number; hx: number; hy: number }[] = Array.from({ length: 8 }, () => ({ x: 0, y: 0, hx: 0, hy: 0 }));
let placedN = 0;
let placedKey = -1;

/**
 * Etiqueta flutuante sobre cada rival, como no original: colocação em itálico na cor do carro
 * ("2º", "3º"), o nome pequeno e a blindagem em esferas. Só redesenha quando algo muda.
 */
export class RivalTag {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private key = '';

  constructor(
    private name: string,
    private color: number,
  ) {
    this.canvas.width = 256;
    this.canvas.height = 112;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, depthTest: false, transparent: true }));
    this.sprite.scale.set(TAG_W, TAG_H, 1);
    this.sprite.renderOrder = 10;
    // etiqueta que cai sob o minimapa/armas/posição fica quase transparente (não suja o HUD)
    this.sprite.onBeforeRender = (renderer, _scene, camera) => {
      const sp = this.sprite;
      // distância à câmera: perto, a escala é limitada (não vira um cartaz na tela) e, colada, some
      const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
      VIEW.setFromMatrixPosition(sp.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      // na vista aérea (ortográfica) a escala na tela não depende da distância
      const depth = persp ? -VIEW.z : 1;
      if (persp && depth < TAG_HIDE) {
        sp.material.opacity = 0;
        return;
      }
      const k = persp ? Math.min(1, depth / TAG_NEAR) : 1;
      sp.scale.set(TAG_W * k, TAG_H * k, 1);
      // separa etiquetas sobrepostas: as de trás são desenhadas antes; a da frente sobe
      const key = renderer.info.render.frame * 64 + (camera.id % 64);
      if (key !== placedKey) {
        placedKey = key;
        placedN = 0;
      }
      const pm = camera.projectionMatrix.elements;
      const hx = ((TAG_W * k) / 2) * pm[0] / depth;
      const hy = ((TAG_H * k) / 2) * pm[5] / depth;
      // quanto 1 m de altura anda na tela (NDC), para converter o deslocamento de volta ao mundo
      UP1.setFromMatrixPosition(sp.matrixWorld);
      UP1.y += 1;
      UP1.project(camera);
      NDC.setFromMatrixPosition(sp.matrixWorld).project(camera);
      const perMeter = UP1.y - NDC.y;
      let lift = 0;
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let i = 0; i < placedN; i++) {
          const o = placed[i];
          const dy = NDC.y + lift - o.y;
          if (Math.abs(NDC.x - o.x) < (hx + o.hx) * 0.8 && Math.abs(dy) < (hy + o.hy) * 0.8) {
            lift += (hy + o.hy) * 0.8 - dy;
            moved = true;
          }
        }
        if (!moved) break;
      }
      if (lift > 0 && perMeter > 1e-4) {
        sp.position.y += lift / perMeter;
        sp.updateMatrixWorld();
        NDC.y += lift;
      } else sp.updateMatrixWorld();
      if (placedN < placed.length) {
        const o = placed[placedN++];
        o.x = NDC.x;
        o.y = NDC.y;
        o.hx = hx;
        o.hy = hy;
      }
      const el = renderer.domElement.getBoundingClientRect();
      const x = el.left + ((NDC.x + 1) / 2) * el.width;
      const y = el.top + ((1 - NDC.y) / 2) * el.height;
      const pad = 40;
      const under = hudBlocks().some((r) => x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad);
      this.sprite.material.opacity = under ? 0.12 : 1;
    };
  }

  /** `note`: aviso no lugar do nome (online: "fora da tela"). */
  update(armorRatio: number, place: number, note = ''): void {
    const dots = 6;
    const lit = Math.max(0, Math.ceil(armorRatio * dots - 0.01));
    const key = `${lit}|${place}|${note}`;
    if (key === this.key) return;
    this.key = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 256, 112);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // colocação grande, em itálico, como os "2ND"/"3RD" do SNES
    ctx.font = 'italic 900 40px "Arial Black", Impact, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    const ord = ORDINAL[place] ?? `${place}`;
    ctx.strokeText(ord, 128, 26);
    const grad = ctx.createLinearGradient(0, 8, 0, 44);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.45, hex(this.color));
    grad.addColorStop(1, hex(this.color));
    ctx.fillStyle = grad;
    ctx.fillText(ord, 128, 26);
    // nome
    ctx.font = 'bold 20px "Trebuchet MS", sans-serif';
    ctx.lineWidth = 5;
    const label = note || this.name;
    ctx.strokeText(label, 128, 60);
    ctx.fillStyle = note ? '#ffd21a' : '#f0f0f0';
    ctx.fillText(label, 128, 60);
    // blindagem em esferas
    const col = armorColor(armorRatio);
    const r = 8;
    const gap = 22;
    const x0 = 128 - ((dots - 1) * gap) / 2;
    for (let k = 0; k < dots; k++) {
      const x = x0 + k * gap;
      const y = 92;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fill();
      const on = k < lit;
      const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, r);
      g.addColorStop(0, on ? '#ffffff' : '#555');
      g.addColorStop(0.35, on ? col : '#2a2a2e');
      g.addColorStop(1, on ? '#000' : '#111');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}
