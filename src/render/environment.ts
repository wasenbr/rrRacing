import * as THREE from 'three';
import { createRng } from '../sim/math';
import type { Track } from '../sim/track';
import { fbm, lavaTextures, normalMap, rippleNormal, terrainNormal } from './textures';
import type { Theme } from './themes';
import { canvas, tex } from './trackStyle';

/** Direção do sol (mesma usada pela luz direcional no jogo). */
export const SUN_DIR = new THREE.Vector3(40, 70, -30).normalize();

/**
 * Céu de espaço: preto no alto, com estrelas e um brilho da cor do planeta no horizonte
 * (as pistas do original flutuam num fundo escuro).
 */
function skyMaterial(top: number, horizon: number, sun: number, stars: number): THREE.ShaderMaterial {
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
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; uniform float stars; varying vec3 vDir;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y * 1.6, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(t, 0.55));
        // estrelas: pontos de hash numa grade fina de direções
        vec3 g = floor(d * 220.0);
        float h = hash(g);
        float star = step(0.9965, h) * smoothstep(0.0, 0.25, d.y) * stars;
        col += vec3(star) * (0.6 + 0.8 * hash(g + 7.0));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 40.0) * 0.25 + pow(s, 900.0) * 4.0);
        col *= mix(0.4, 1.0, smoothstep(-0.3, 0.02, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function buildSky(theme: Theme): THREE.Mesh {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMaterial(theme.skyTop, theme.skyHorizon, theme.sun, 1));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/**
 * Mapa de ambiente para os reflexos: mais claro que o céu visível (senão pintura e metais ficam
 * pretos num fundo escuro), com o chão do planeta embaixo e um sol forte.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, theme: Theme): THREE.Texture {
  const scene = new THREE.Scene();
  const top = new THREE.Color(theme.ambientSky).multiplyScalar(0.55);
  const horizon = new THREE.Color(theme.ambientSky).lerp(new THREE.Color(theme.ground), 0.5);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(top.getHex(), horizon.getHex(), theme.sun, 0)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return env;
}

/* ------------------------------------------------------------------ */
/* Terreno                                                              */
/* ------------------------------------------------------------------ */

const hexStr = (c: number) => `#${new THREE.Color(c).getHexString()}`;

/** Textura do chão de cada planeta (cor), desenhada por cima de ruído. */
function groundColor(theme: Theme): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture | null; metersPerTile: number } {
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
        // lodo químico ocre com marolas em meia-lua (como no mapa de Chem VI)
        for (let i = 0; i < 260; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 5 + rng() * 9;
          ctx.strokeStyle = `rgba(90,52,0,${0.35 + rng() * 0.3})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,220,120,0.25)';
          ctx.beginPath();
          ctx.arc(x, y + 2, r, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();
        }
        break;
      }
      case 'void': {
        // chão preto com grade tênue e crateras de borda roxa (Drakonis)
        ctx.strokeStyle = 'rgba(120,90,200,0.12)';
        ctx.lineWidth = 1;
        for (let k = 0; k <= S; k += 32) {
          ctx.beginPath();
          ctx.moveTo(k, 0);
          ctx.lineTo(k, S);
          ctx.moveTo(0, k);
          ctx.lineTo(S, k);
          ctx.stroke();
        }
        emissive = canvas(S, S, (e) => {
          e.fillStyle = '#000';
          e.fillRect(0, 0, S, S);
        });
        const ectx = emissive.getContext('2d')!;
        for (let i = 0; i < 22; i++) {
          const x = rng() * S;
          const y = rng() * S;
          const r = 10 + rng() * 22;
          for (const [cx, col, w] of [[ctx, 'rgba(150,90,230,0.8)', 3], [ectx, 'rgba(90,50,160,1)', 2]] as const) {
            cx.strokeStyle = col;
            cx.lineWidth = w;
            cx.beginPath();
            cx.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2);
            cx.stroke();
          }
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.beginPath();
          ctx.ellipse(x, y + 1, r * 0.8, r * 0.4, 0, 0, Math.PI * 2);
          ctx.fill();
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
        // neve com sombras azuladas e brilho
        for (let i = 0; i < 120; i++) {
          const x = rng() * S;
          const y = rng() * S;
          ctx.fillStyle = `rgba(120,160,230,${0.1 + rng() * 0.18})`;
          ctx.beginPath();
          ctx.ellipse(x, y, 10 + rng() * 30, 4 + rng() * 10, rng() * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 0; i < 700; i++) {
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(rng() * S, rng() * S, 1.5, 1.5);
        }
        break;
      }
      case 'lava':
        break;
    }
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

/** Terreno abaixo das pistas: lodo, vazio com crateras, oceano, deserto, neve ou lava. */
export function buildGround(track: Track, theme: Theme, shadows: boolean): { mesh: THREE.Mesh; update: (t: number) => void } {
  const b = track.bounds();
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 700;
  let mat: THREE.MeshStandardMaterial;
  let scroll: THREE.Texture[] = [];
  let normal: THREE.Texture;

  if (theme.groundStyle === 'lava') {
    const t = lavaTextures();
    t.map.repeat.set(size / 30, size / 30);
    t.emissive.repeat.copy(t.map.repeat);
    normal = rippleNormal().clone();
    normal.repeat.set(size / 14, size / 14);
    mat = new THREE.MeshStandardMaterial({
      map: t.map,
      emissiveMap: t.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 2.4,
      normalMap: normal,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughness: 0.8,
    });
    scroll = [t.map, t.emissive];
  } else {
    const gc = groundColor(theme);
    gc.map.repeat.set(size / gc.metersPerTile, size / gc.metersPerTile);
    const liquid = theme.groundStyle === 'ocean' || theme.groundStyle === 'sludge';
    normal = (liquid ? rippleNormal() : theme.groundStyle === 'snow' ? normalMap(fbm(256, 4, 4, 88, 0.5), 256, 3) : terrainNormal()).clone();
    normal.repeat.set(size / (liquid ? 16 : 30), size / (liquid ? 16 : 30));
    mat = new THREE.MeshStandardMaterial({
      map: gc.map,
      normalMap: normal,
      normalScale: new THREE.Vector2(liquid ? 0.7 : 1.2, liquid ? 0.7 : 1.2),
      roughness: theme.groundStyle === 'ocean' ? 0.12 : theme.groundStyle === 'sludge' ? 0.35 : theme.groundStyle === 'snow' ? 0.88 : 0.95,
      metalness: 0,
      envMapIntensity: liquid ? 1.4 : 0.6,
    });
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
