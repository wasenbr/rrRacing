import * as THREE from 'three';
import type { Track } from '../sim/track';
import { fbm, lavaTextures, rippleNormal, terrainNormal, tintedTexture } from './textures';
import type { Theme } from './themes';

/** Direção do sol (mesma usada pela luz direcional no jogo). */
export const SUN_DIR = new THREE.Vector3(40, 70, -30).normalize();

function skyMaterial(theme: Theme): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      horizon: { value: new THREE.Color(theme.skyHorizon) },
      sunColor: { value: new THREE.Color(theme.sun) },
      sunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float t = clamp(d.y * 2.2, 0.0, 1.0);
        vec3 col = mix(horizon, top, pow(t, 0.7));
        // halo e disco do sol
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 12.0) * 0.35 + pow(s, 600.0) * 6.0);
        // abaixo do horizonte escurece (reflexos do chão ficam mais realistas)
        col *= mix(0.35, 1.0, smoothstep(-0.25, 0.02, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Céu em gradiente com sol (cúpula) — barato e bonito também no celular. */
export function buildSky(theme: Theme): THREE.Mesh {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMaterial(theme));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return sky;
}

/**
 * Mapa de ambiente gerado a partir do próprio céu do planeta: pintura, metais e líquidos
 * refletem as cores e o sol daquele lugar.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer, theme: Theme): THREE.Texture {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(theme)));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  return env;
}

/** Terreno abaixo das pistas: pântano, oceano ou lava (líquidos refletivos) ou chão sólido. */
export function buildGround(track: Track, theme: Theme, shadows: boolean): { mesh: THREE.Mesh; update: (t: number) => void } {
  const b = track.bounds();
  const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 700;
  const tile = 48; // metros por repetição da textura
  const color = new THREE.Color(theme.ground);
  const variation = tintedTexture(fbm(256, 4, 5, 7), 256, color, 0.7, 1.3);
  variation.repeat.set(size / (tile * 3), size / (tile * 3));

  let mat: THREE.Material;
  let normal: THREE.Texture | null = null;
  let lavaMaps: { map: THREE.Texture; emissive: THREE.Texture } | null = null;
  if (theme.liquid) {
    normal = rippleNormal().clone();
    normal.repeat.set(size / 14, size / 14);
    const lava = theme.liquidEmissive > 0x400000;
    if (lava) {
      // lava: crosta escura com rachaduras que brilham
      const t = lavaTextures();
      t.map.repeat.set(size / 30, size / 30);
      t.emissive.repeat.copy(t.map.repeat);
      mat = new THREE.MeshStandardMaterial({
        map: t.map,
        emissiveMap: t.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 2.2,
        normalMap: normal,
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughness: 0.85,
      });
      lavaMaps = t;
    } else {
      mat = new THREE.MeshPhysicalMaterial({
        map: variation,
        normalMap: normal,
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughness: 0.05,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        emissive: theme.liquidEmissive,
        envMapIntensity: 1.3,
      });
    }
  } else {
    normal = terrainNormal().clone();
    normal.repeat.set(size / tile, size / tile);
    mat = new THREE.MeshStandardMaterial({ map: variation, normalMap: normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.96 });
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((b.minX + b.maxX) / 2, theme.groundLevel, (b.minZ + b.maxZ) / 2);
  mesh.receiveShadow = shadows;
  const base = normal.offset.clone();
  const update = (t: number) => {
    if (theme.liquid && normal) {
      // o líquido ondula devagar
      normal.offset.set(base.x + t * 0.006, base.y + t * 0.004);
      variation.offset.set(t * 0.0015, t * 0.001);
      if (lavaMaps) {
        lavaMaps.map.offset.set(t * 0.002, t * 0.001);
        lavaMaps.emissive.offset.copy(lavaMaps.map.offset);
      }
    }
  };
  return { mesh, update };
}
