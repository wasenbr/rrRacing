import * as THREE from 'three';
import { createRng } from '../sim/math';
import type { Track } from '../sim/track';
import { fbm, lavaTextures, normalMap, rippleNormal, terrainNormal } from './textures';
import type { Theme } from './themes';
import { canvas, tex } from './trackStyle';

/**
 * Direção do sol (mesma usada pela luz direcional no jogo). Muda por planeta em `buildSky`
 * (ex.: sol baixo em Nho, sombras longas).
 */
export const SUN_DIR = new THREE.Vector3(55, 40, -42).normalize();

/** Clima do céu: 0 estrelas; 1 Inferno (brasas, fumaça, lava no horizonte); 2 Nho (aurora); 3 Drakonis (nebulosa). */
type SkyMood = 0 | 1 | 2 | 3;

/**
 * Céu de espaço: preto no alto, com estrelas e um brilho da cor do planeta no horizonte
 * (as pistas do original flutuam num fundo escuro).
 */
function skyMaterial(top: number, horizon: number, sun: number, stars: number, mood: SkyMood = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      horizon: { value: new THREE.Color(horizon) },
      sunColor: { value: new THREE.Color(sun) },
      sunDir: { value: SUN_DIR.clone() },
      stars: { value: stars },
      mood: { value: mood },
      time: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; uniform float stars; uniform float mood; uniform float time; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm2(vec2 p){ float a = 0.5; float s = 0.0; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s / 0.9375; }
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y * 1.6, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(t, 0.55));
        vec2 sp = d.xz / max(d.y + 0.3, 0.06);
        float up = smoothstep(-0.02, 0.2, d.y);
        vec3 g = floor(d * 220.0);
        float h = hash(g);
        if (mood > 0.5 && mood < 1.5) {
          // Inferno: brilho de lava no horizonte, nuvens de fumaça iluminadas por baixo e brasas
          float hz = exp(-max(d.y + 0.02, 0.0) * 7.0);
          col += vec3(1.0, 0.26, 0.03) * hz * 0.85;
          float cl = fbm2(sp * 0.9 + vec2(time * 0.015, time * 0.004));
          float smoke = smoothstep(0.42, 0.78, cl) * smoothstep(-0.05, 0.3, d.y);
          col = mix(col, vec3(0.05, 0.018, 0.012), smoke * 0.85);
          col += vec3(0.55, 0.14, 0.02) * smoothstep(0.5, 0.85, cl) * hz * 1.2;
          vec3 ge = floor(d * 150.0);
          float he = hash(ge);
          float ember = step(0.9955, he) * up * (0.55 + 0.45 * sin(time * 3.0 + he * 60.0));
          col += vec3(1.0, 0.42, 0.06) * ember * (1.5 + 2.0 * hash(ge + 3.0));
        } else if (mood > 1.5 && mood < 2.5) {
          // Nho: cortinas de aurora (verde-água embaixo, azul em cima) e estrelas finas
          float az = atan(d.z, d.x);
          float bend = fbm2(vec2(az * 1.6, time * 0.03)) * 5.0;
          float wave = 0.5 + 0.5 * sin(az * 3.0 + bend);
          float curtain = smoothstep(0.04, 0.16, d.y) * smoothstep(0.7, 0.22, d.y) * wave;
          float streak = 0.55 + 0.45 * sin(az * 70.0 + bend * 4.0 + time * 0.4);
          vec3 aur = mix(vec3(0.15, 1.0, 0.65), vec3(0.35, 0.45, 1.0), smoothstep(0.12, 0.5, d.y));
          col += aur * curtain * streak * 0.6;
          col += vec3(step(0.9975, h) * up * stars) * (0.5 + 0.6 * hash(g + 7.0));
        } else {
          if (mood > 2.5) {
            // Drakonis: nebulosa magenta e ciano
            float n1 = fbm2(sp * 0.7 + 3.1);
            float n2 = fbm2(sp * 1.2 + vec2(9.0, 2.0));
            col += vec3(0.55, 0.06, 0.45) * smoothstep(0.5, 0.85, n1) * up * 0.7;
            col += vec3(0.04, 0.4, 0.55) * smoothstep(0.58, 0.88, n2) * up * 0.55;
          }
          // estrelas: pontos de hash numa grade fina de direções
          float star = step(0.9965, h) * smoothstep(0.0, 0.25, d.y) * stars;
          col += vec3(star) * (0.6 + 0.8 * hash(g + 7.0));
        }
        float s = max(dot(d, sunDir), 0.0);
        // sol: disco de borda suave e brilho em falloff exponencial (sem halo de borda dura); no céu
        // de dia (New Mojave, sem estrelas) o disco fica abaixo do limiar do bloom, que abria um
        // halo gigante recortado em volta dele
        float disc = smoothstep(0.99930, 0.99975, s) * (stars > 0.5 ? 4.0 : 1.3);
        col += sunColor * (exp((s - 1.0) * 70.0) * 0.3 + exp((s - 1.0) * 9.0) * (stars > 0.5 ? 0.05 : 0.08) + disc);
        // Nho: sol baixo, halo largo e quente no horizonte
        if (mood > 1.5 && mood < 2.5) col += sunColor * pow(s, 6.0) * 0.18 * exp(-max(d.y, 0.0) * 5.0);
        col *= mix(0.4, 1.0, smoothstep(-0.3, 0.02, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

const MOODS: Partial<Record<string, SkyMood>> = { lava: 1, snow: 2, void: 3 };

export function buildSky(theme: Theme): THREE.Mesh {
  SUN_DIR.set(...theme.light.sunDir).normalize();
  // New Mojave é de dia no original (deserto laranja): céu quente, sem estrelas
  const stars = theme.groundStyle === 'sand' ? 0 : 1;
  const mat = skyMaterial(theme.skyTop, theme.skyHorizon, theme.sun, stars, MOODS[theme.groundStyle] ?? 0);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  // tempo para as brasas piscarem e a fumaça/aurora andarem (só quando o céu aparece)
  sky.onBeforeRender = () => {
    mat.uniforms.time.value = performance.now() / 1000;
  };
  return sky;
}

/**
 * Mapa de ambiente para os reflexos: mais claro que o céu visível (senão pintura e metais ficam
 * pretos num fundo escuro), com o chão do planeta embaixo e um sol forte.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, theme: Theme): THREE.Texture {
  SUN_DIR.set(...theme.light.sunDir).normalize();
  const scene = new THREE.Scene();
  const top = new THREE.Color(theme.ambientSky).multiplyScalar(0.55);
  const horizon = new THREE.Color(theme.ambientSky).lerp(new THREE.Color(theme.ground), 0.5);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(top.getHex(), horizon.getHex(), theme.sun, 0));
  scene.add(sphere);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  sphere.geometry.dispose();
  (sphere.material as THREE.Material).dispose();
  // descartar a textura (troca de planeta) libera também o render target que a guarda
  const env = target.texture;
  env.addEventListener('dispose', () => target.dispose());
  return env;
}

/* ------------------------------------------------------------------ */
/* Terreno                                                              */
/* ------------------------------------------------------------------ */

const hexStr = (c: number) => `#${new THREE.Color(c).getHexString()}`;

/** Textura do chão de cada planeta (cor), desenhada por cima de ruído. */
const groundCache = new WeakMap<Theme, ReturnType<typeof groundColorRaw>>();
function groundColor(theme: Theme): ReturnType<typeof groundColorRaw> {
  let g = groundCache.get(theme);
  if (!g) groundCache.set(theme, (g = groundColorRaw(theme)));
  return g;
}

function groundColorRaw(theme: Theme): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture | null; metersPerTile: number } {
  const S = 512;
  const rng = createRng(3);
  const n = fbm(S / 2, 4, 5, 7);
  const noise = canvas(S / 2, S / 2, (ctx) => {
    const img = ctx.createImageData(S / 2, S / 2);
    for (let i = 0; i < n.length; i++) {
      const v = n[i] * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  let emissive: HTMLCanvasElement | null = null;
  const base = hexStr(theme.ground);
  const c = canvas(S, S, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(noise, 0, 0, S, S);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    switch (theme.groundStyle) {
      case 'sludge': {
        // lodo químico ocre: manchas grandes, bolhas e marolas em meia-lua de tamanhos, direções e
        // densidades variadas (aglomeradas pelo ruído, sem cara de papel de parede)
        for (let i = 0; i < 26; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 20 + rng() * 70;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          const dark = rng() > 0.45;
          g.addColorStop(0, dark ? `rgba(40,22,0,${0.25 + rng() * 0.3})` : `rgba(200,150,50,${0.12 + rng() * 0.15})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 420; i++) {
          const x = rng() * S;
          const y = rng() * S;
          // só onde o ruído deixa: marolas em grupos, com áreas lisas entre eles
          if (n[Math.floor(y / 2) * (S / 2) + Math.floor(x / 2)] < 0.5 + rng() * 0.12) continue;
          const r = 3 + rng() * rng() * 16;
          const a0 = Math.PI * (1 + (rng() - 0.5) * 0.7);
          const span = Math.PI * (0.35 + rng() * 0.6);
          ctx.strokeStyle = `rgba(90,52,0,${0.2 + rng() * 0.35})`;
          ctx.lineWidth = 1 + rng() * 2;
          ctx.beginPath();
          ctx.arc(x, y, r, a0, a0 + span);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,220,120,${0.08 + rng() * 0.18})`;
          ctx.beginPath();
          ctx.arc(x, y + 1.5, r, a0 + 0.1, a0 + span - 0.1);
          ctx.stroke();
        }
        for (let i = 0; i < 90; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 1 + rng() * 3.5;
          ctx.strokeStyle = 'rgba(255,230,150,0.3)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
      case 'void': {
        // Drakonis: basalto escuro rachado em placas, liquens roxos/ciano, cascalho e crateras de
        // borda roxa (a borda brilha de leve)
        for (let i = 0; i < 70; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 14 + rng() * 60;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          const k = rng();
          g.addColorStop(0, k < 0.4 ? `rgba(120,50,170,${0.18 + rng() * 0.2})` : k < 0.65 ? `rgba(30,120,150,${0.12 + rng() * 0.15})` : `rgba(0,0,0,${0.3 + rng() * 0.3})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        // rachaduras: linhas quebradas escuras com fio claro ao lado (relevo)
        for (let i = 0; i < 90; i++) {
          let x = rng() * S;
          let y = rng() * S;
          let a = rng() * Math.PI * 2;
          const pts: [number, number][] = [[x, y]];
          for (let k = 0; k < 4 + rng() * 6; k++) {
            a += (rng() - 0.5) * 1.2;
            x += Math.cos(a) * (6 + rng() * 14);
            y += Math.sin(a) * (6 + rng() * 14);
            pts.push([x, y]);
          }
          for (const [dx, col, w] of [[1, 'rgba(170,140,220,0.18)', 1], [0, `rgba(0,0,0,${0.5 + rng() * 0.3})`, 1.5 + rng() * 1.5]] as const) {
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.beginPath();
            pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + dx, py + dx) : ctx.moveTo(px + dx, py + dx)));
            ctx.stroke();
          }
        }
        emissive = canvas(S, S, (e) => {
          e.fillStyle = '#000';
          e.fillRect(0, 0, S, S);
        });
        const ectx = emissive.getContext('2d')!;
        for (let i = 0; i < 30; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 8 + rng() * 26;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.beginPath();
          ctx.ellipse(x, y + 1, r * 0.85, r * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          for (const [cx, col, w] of [[ctx, 'rgba(160,100,240,0.85)', 3], [ectx, i % 3 ? 'rgba(90,50,160,1)' : 'rgba(40,150,190,1)', 2]] as const) {
            cx.strokeStyle = col;
            cx.lineWidth = w;
            cx.beginPath();
            cx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
            cx.stroke();
          }
        }
        for (let i = 0; i < 1400; i++) {
          const v = rng();
          ctx.fillStyle = v > 0.5 ? `rgba(200,180,255,${(v - 0.5) * 0.35})` : `rgba(0,0,0,${(0.5 - v) * 0.8})`;
          ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
        }
        break;
      }
      case 'ocean': {
        // oceano azul-profundo com cristas de ondas claras
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = `rgba(${90 + rng() * 60},${130 + rng() * 60},255,${0.15 + rng() * 0.3})`;
          ctx.fillRect(rng() * S, rng() * S, 3 + rng() * 5, 1.5);
        }
        break;
      }
      case 'sand': {
        // deserto laranja: dunas, pedriscos e crateras escuras
        for (let i = 0; i < 160; i++) {
          const x = rng() * S;
          const y = rng() * S;
          ctx.strokeStyle = `rgba(120,50,0,${0.25 + rng() * 0.3})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 6 + rng() * 10, Math.PI * 0.1, Math.PI * 0.9);
          ctx.stroke();
        }
        for (let i = 0; i < 14; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 8 + rng() * 14;
          const g = ctx.createRadialGradient(x, y, 1, x, y, r);
          g.addColorStop(0, 'rgba(60,20,0,0.85)');
          g.addColorStop(0.7, 'rgba(120,50,10,0.6)');
          g.addColorStop(1, 'rgba(255,190,100,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 400; i++) {
          ctx.fillStyle = `rgba(${80 + rng() * 60},${40 + rng() * 30},20,0.8)`;
          ctx.fillRect(rng() * S, rng() * S, 2, 2);
        }
        break;
      }
      case 'snow': {
        // neve varrida pelo vento: sulcos (sastrugi) com sombra azul, montes, gelo exposto e brilho
        for (let i = 0; i < 140; i++) {
          const x = rng() * S;
          const y = rng() * S;
          ctx.fillStyle = rng() > 0.35 ? `rgba(90,130,220,${0.12 + rng() * 0.2})` : `rgba(255,255,255,${0.15 + rng() * 0.2})`;
          ctx.beginPath();
          ctx.ellipse(x, y, 10 + rng() * 40, 4 + rng() * 12, 0.5 + (rng() - 0.5) * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 700; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const len = 6 + rng() * 22;
          const a = 0.5 + (rng() - 0.5) * 0.25;
          const dx = Math.cos(a) * len;
          const dy = Math.sin(a) * len;
          ctx.lineWidth = 1 + rng() * 1.5;
          ctx.strokeStyle = `rgba(70,110,200,${0.18 + rng() * 0.25})`;
          ctx.beginPath();
          ctx.moveTo(x, y + 1.5);
          ctx.quadraticCurveTo(x + dx / 2, y + dy / 2 + 3, x + dx, y + dy + 1.5);
          ctx.stroke();
          ctx.strokeStyle = `rgba(255,255,255,${0.25 + rng() * 0.3})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.quadraticCurveTo(x + dx / 2, y + dy / 2 + 2, x + dx, y + dy);
          ctx.stroke();
        }
        // placas de gelo azul expostas
        for (let i = 0; i < 12; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 10 + rng() * 26;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, 'rgba(60,120,210,0.55)');
          g.addColorStop(1, 'rgba(60,120,210,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(x, y, r, r * 0.6, rng() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 900; i++) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(rng() * S, rng() * S, 1.5, 1.5);
        }
        break;
      }
      case 'lava':
        break;
    }
    // o terreno lá embaixo é coadjuvante (visual alvo: entorno escuro, pista é o mais claro):
    // tira ~40% da saturação (o escurecimento vai na cor do material, em espaço linear)
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = 'rgba(128,128,128,0.4)';
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
  });
  const metersPerTile = theme.groundStyle === 'void' ? 90 : theme.groundStyle === 'ocean' ? 60 : 70;
  return { map: tex(c), emissive: emissive ? tex(emissive) : null, metersPerTile };
}

let macroTex: THREE.CanvasTexture | null = null;
/** Ruído de baixa frequência, repetível, para variar o tom do terreno em escala grande. */
function macroNoise(): THREE.CanvasTexture {
  if (macroTex) return macroTex;
  const n = fbm(128, 3, 4, 91);
  const c = canvas(128, 128, (ctx) => {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < n.length; i++) {
      const v = n[i] * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  macroTex = new THREE.CanvasTexture(c);
  macroTex.wrapS = macroTex.wrapT = THREE.RepeatWrapping;
  return macroTex;
}

let snowN: THREE.Texture | null = null;
/** Relevo da neve: montes suaves e sulcos paralelos do vento (repete sem emenda). */
function snowNormal(): THREE.Texture {
  if (snowN) return snowN;
  const n = 256;
  const h = fbm(n, 4, 4, 88, 0.5);
  const w = fbm(n, 8, 2, 89, 0.5);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = ((x + y * 0.5) / n) * Math.PI * 2;
      h[y * n + x] += 0.035 * Math.sin(u * 18 + w[y * n + x] * 7);
    }
  snowN = normalMap(h, n, 4);
  return snowN;
}

let basaltN: THREE.Texture | null = null;
/** Relevo do chão de Drakonis: rocha granulada com degraus (placas quebradas). */
function basaltNormal(): THREE.Texture {
  if (basaltN) return basaltN;
  const n = 256;
  const h = fbm(n, 4, 5, 141, 0.6);
  const cells = fbm(n, 6, 2, 142, 0.4);
  for (let i = 0; i < h.length; i++) h[i] += Math.floor(cells[i] * 6) / 6 * 0.5;
  basaltN = normalMap(h, n, 7);
  return basaltN;
}

/** Fração do albedo do terreno (o chão claro — areia, neve — é o que mais competia com a pista). */
const GROUND_ALBEDO: Partial<Record<string, number>> = { void: 0.8, sand: 0.2, snow: 0.4, sludge: 0.32, ocean: 0.45 };

/**
 * Terreno abaixo das pistas: lodo, vazio com crateras, oceano, deserto, neve ou lava.
 * `lite` (qualidade média/baixa): material Lambert, sem reflexos PBR. O chão cobre a tela inteira
 * e era o material mais caro da cena (~40% da GPU no tablet), embora fique escuro ao fundo.
 */
export function buildGround(track: Track, theme: Theme, shadows: boolean, lite = false): { mesh: THREE.Mesh; update: (t: number) => void } {
  const b = track.bounds();
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 700;
  let mat: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
  // parâmetros de PBR só entram no material completo; no leve, líquidos ganham brilho Phong (barato)
  const make = (common: THREE.MeshLambertMaterialParameters, pbr: THREE.MeshStandardMaterialParameters, shiny = false) =>
    !lite
      ? new THREE.MeshStandardMaterial({ ...common, ...pbr } as THREE.MeshStandardMaterialParameters)
      : shiny
        ? new THREE.MeshPhongMaterial({ ...common, specular: 0x2a2a2a, shininess: 70 } as THREE.MeshPhongMaterialParameters)
        : new THREE.MeshLambertMaterial(common);
  let scroll: THREE.Texture[] = [];
  let normal: THREE.Texture;

  if (theme.groundStyle === 'lava') {
    const t = lavaTextures();
    t.map.repeat.set(size / 30, size / 30);
    t.emissive.repeat.copy(t.map.repeat);
    normal = rippleNormal().clone();
    normal.repeat.set(size / 14, size / 14);
    mat = make(
      { map: t.map, emissiveMap: t.emissive, emissive: 0xffffff, emissiveIntensity: 1.2, normalMap: normal, normalScale: new THREE.Vector2(1.2, 1.2) },
      // pouco reflexo do céu: em ângulo rasante (cockpit/perseguição) o Fresnel deixava a lava cinza-rosada
      { roughness: 0.8, envMapIntensity: 0.15 },
    );
    scroll = [t.map, t.emissive];
  } else {
    const gc = groundColor(theme);
    gc.map.repeat.set(size / gc.metersPerTile, size / gc.metersPerTile);
    const liquid = theme.groundStyle === 'ocean' || theme.groundStyle === 'sludge';
    normal = (liquid ? rippleNormal() : theme.groundStyle === 'snow' ? snowNormal() : theme.groundStyle === 'void' ? basaltNormal() : terrainNormal()).clone();
    normal.repeat.set(size / (liquid ? 16 : 30), size / (liquid ? 16 : 30));
    mat = make(
      {
        map: gc.map,
        normalMap: normal,
        normalScale: new THREE.Vector2(liquid ? 0.7 : 1.6, liquid ? 0.7 : 1.6),
        // albedo bem mais baixo que o da pista: o entorno fica escuro e a pista é o elemento mais claro
        color: new THREE.Color().setScalar(GROUND_ALBEDO[theme.groundStyle] ?? 0.4),
      },
      {
        roughness: theme.groundStyle === 'ocean' ? 0.12 : theme.groundStyle === 'sludge' ? 0.35 : theme.groundStyle === 'snow' ? 0.88 : 0.95,
        metalness: 0,
        envMapIntensity: liquid ? 0.35 : 0.3,
      },
      liquid,
    );
    if (gc.emissive) {
      gc.emissive.repeat.copy(gc.map.repeat);
      mat.emissiveMap = gc.emissive;
      mat.emissive = new THREE.Color(0xffffff);
      mat.emissiveIntensity = 0.8;
    }
    if (theme.liquidEmissive) mat.emissive = mat.emissive.getHex() ? mat.emissive : new THREE.Color(theme.liquidEmissive);
    // variação de tom em escala grande (~400 m): esconde a repetição da textura vista do alto
    const macro = macroNoise();
    const macroScale = (gc.metersPerTile / 400).toFixed(4);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.macroMap = { value: macro };
      sh.fragmentShader = 'uniform sampler2D macroMap;\n' + sh.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb *= mix(0.7, 1.2, texture2D(macroMap, vMapUv * ' + macroScale + ').r);',
      );
    };
    if (liquid) scroll = [gc.map];
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((b.minX + b.maxX) / 2, theme.groundLevel, (b.minZ + b.maxZ) / 2);
  mesh.receiveShadow = shadows;
  const base = normal.offset.clone();
  const moving = theme.liquid;
  const update = (t: number) => {
    if (!moving) return;
    normal.offset.set(base.x + t * 0.006, base.y + t * 0.004);
    for (const s of scroll) s.offset.set(t * 0.0015, t * 0.001);
  };
  return { mesh, update };
}
