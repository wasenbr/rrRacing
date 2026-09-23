import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCarMesh } from './cars';
import { Kit, wheel } from './cars/common';

/**
 * Miniaturas dos carros (loja, garagem, seleção): cada carro renderizado em 3/4, bem iluminado,
 * com fundo transparente, virando uma imagem PNG (data URL). Um único renderizador fora da tela
 * é compartilhado e o resultado fica em cache por carro, cor e tamanho.
 */
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let envTex: THREE.Texture | null = null;
const cache = new Map<string, string>();

function setup(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } {
  if (!renderer || !scene || !camera) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.setClearColor(0x000000, 0);
    scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = envTex;
    scene.environmentIntensity = 0.35;
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(4, 7, 5);
    const rim = new THREE.DirectionalLight(0xa8c8ff, 1.6);
    rim.position.set(-5, 3, -6);
    scene.add(key, rim, new THREE.HemisphereLight(0xdde8ff, 0x201c24, 0.6));
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  }
  return { renderer, scene, camera };
}

/**
 * Libera geometrias e materiais. As texturas NÃO: algumas são compartilhadas com os carros da
 * corrida (desgaste da pintura, esteira), e descartá-las forçaria o jogo a reenviá-las à GPU.
 */
function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}

/**
 * Enquadra `obj` projetando seus vértices: ocupa `fill` do quadro, centralizado, visto de `dir`.
 */
function frame(obj: THREE.Object3D, camera: THREE.PerspectiveCamera, dir: THREE.Vector3, fill: number): void {
  obj.updateMatrixWorld(true);
  // caixa só do que aparece (chamas do nitro e cockpit ficam escondidos)
  const box = new THREE.Box3();
  const pts: THREE.Vector3[] = [];
  obj.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m.material as THREE.Material).transparent) return;
    const pos = m.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      pts.push(v);
      box.expandByPoint(v);
    }
  });
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  dir.normalize();
  const target = center.clone();
  let dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.8;
  for (let pass = 0; pass < 3; pass++) {
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.near = dist / 20;
    camera.far = dist * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of pts) {
      const p = c.clone().project(camera);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    // recentra: desloca o alvo no plano da câmera pelo centro projetado
    const off = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, 0.5).unproject(camera).sub(new THREE.Vector3(0, 0, 0.5).unproject(camera));
    target.add(off);
    dist *= Math.max(x1 - x0, y1 - y0) / 2 / fill;
  }
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = dist / 20;
  camera.far = dist * 4;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}

/**
 * Imagem PNG (data URL) do carro em vista 3/4, com fundo transparente.
 * `size` é o lado do quadrado em pixels (padrão 256). Retorna '' se não houver WebGL.
 */
export function carThumbnail(vehicleId: string, color: number, size = 256): string {
  const key = `${vehicleId}|${color}|${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const { renderer, scene, camera } = setup();
    renderer.setSize(size, size, false);
    const car = createCarMesh(vehicleId, color, false);
    car.animate({ spin: 0.6, steer: -0.35, speed: 0, time: 0.4, grounded: true });
    // flutuação/brilhos no ponto de repouso
    for (const f of car.flames) f.visible = false;
    car.root.rotation.y = -0.2; // frente virada para a câmera, em 3/4
    scene.add(car.root);
    frame(car.root, camera, new THREE.Vector3(0.9, 0.7, 1), 0.84);
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL('image/png');
    scene.remove(car.root);
    disposeTree(car.root);
  } catch {
    url = '';
  }
  cache.set(key, url);
  return url;
}

/** Itens da loja com miniatura 3D: armas do original e as quatro melhorias. */
export type ShopItem =
  | 'laser' | 'missile' | 'sundog' | 'oil' | 'mine' | 'scatter' | 'nitro' | 'jump'
  | 'engine' | 'tires' | 'shocks' | 'armor';

/** Monta a peça da loja com as mesmas peças que aparecem nos carros (Kit). */
function buildItem(item: ShopItem): THREE.Group {
  const g = new THREE.Group();
  const k = new Kit(0xe0342a, false, g);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c });
  switch (item) {
    case 'laser':
      k.plasmaRifle(-0.2, 0, 0, 1.3);
      k.plasmaRifle(0.2, 0, 0, 1.3);
      k.add(new THREE.BoxGeometry(0.7, 0.1, 0.5), k.trim, 0, -0.12, -0.2);
      break;
    case 'missile':
      k.missilePod(0, 0, 0, 1.2);
      // um míssil saindo do casulo
      k.add(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 12).rotateX(Math.PI / 2), k.steel, 0.35, 0.25, 0.6);
      k.add(new THREE.ConeGeometry(0.07, 0.2, 12).rotateX(Math.PI / 2), k.tail, 0.35, 0.25, 1.05);
      for (const r of [0, Math.PI / 2]) k.add(new THREE.BoxGeometry(0.28, 0.02, 0.14), k.warn, 0.35, 0.25, 0.3).rotation.z = r;
      break;
    case 'sundog':
      k.sundogEmitter(0, 0, 0, 0.45);
      break;
    case 'oil':
      k.slipsauceTank(0, 0.3, 0, 1.0);
      k.add(new THREE.CylinderGeometry(0.7, 0.8, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.05, metalness: 0.4 }), 0, -0.05, -0.5);
      break;
    case 'mine': {
      k.add(new THREE.CylinderGeometry(0.4, 0.45, 0.2, 16), k.gunMetal, 0, 0, 0);
      k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), k.tail, 0, 0.13, 0);
      const claw = new THREE.ConeGeometry(0.06, 0.3, 6);
      for (let i = 0; i < 8; i++) {
        const r = (i / 8) * Math.PI * 2;
        const m = k.add(claw, k.chrome, Math.cos(r) * 0.5, 0.02, Math.sin(r) * 0.5);
        m.quaternion.setFromUnitVectors(V(0, 1, 0), V(Math.cos(r), 0.3, Math.sin(r)).normalize());
      }
      break;
    }
    case 'scatter':
      k.scatterpack(0, 0, 0);
      for (let i = 0; i < 3; i++) k.add(new THREE.SphereGeometry(0.1, 10, 8), k.tail, -0.4 + i * 0.4, -0.05, -0.7 - (i % 2) * 0.2);
      break;
    case 'nitro':
      for (const x of [-0.18, 0.18]) {
        k.add(new THREE.CylinderGeometry(0.16, 0.16, 1.0, 16).rotateX(Math.PI / 2), k.accent, x, 0, 0);
        k.add(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16).rotateX(Math.PI / 2), k.warn, x, 0, 0.2);
        k.add(new THREE.CylinderGeometry(0.08, 0.12, 0.2, 12).rotateX(Math.PI / 2), k.chrome, x, 0, -0.58);
      }
      k.add(new THREE.ConeGeometry(0.16, 0.9, 12).rotateX(-Math.PI / 2), glow(0x7ad8ff), 0, 0, -1.1);
      break;
    case 'jump':
      for (const x of [-0.3, 0.3]) {
        k.jumpJet(x, 0, 0);
        k.add(new THREE.ConeGeometry(0.14, 0.6, 12).rotateX(Math.PI), glow(0xffa040), x, -0.5, 0);
      }
      k.add(new THREE.BoxGeometry(1.0, 0.08, 0.5), k.trim, 0, 0.18, 0);
      break;
    case 'engine':
      k.add(new THREE.BoxGeometry(0.8, 0.5, 1.0), k.gunMetal, 0, 0, 0);
      for (const x of [-0.26, 0.26]) {
        k.add(new THREE.BoxGeometry(0.22, 0.14, 0.9), k.accent, x, 0.32, 0);
        for (let i = 0; i < 4; i++) k.tube(V(x * 1.6, 0.05, -0.33 + i * 0.22), V(x * 2.4, -0.15, -0.33 + i * 0.22), 0.04, k.chrome);
      }
      k.add(new THREE.BoxGeometry(0.46, 0.3, 0.46), k.chrome, 0, 0.5, 0.1);
      k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 12), k.trim, 0, 0.72, 0.1);
      break;
    case 'tires':
      wheel(k, { radius: 0.6, width: 0.5, spokes: 6, knobby: true }, 0, 0, 0).pivot.rotation.y = 0.5;
      break;
    case 'shocks': {
      k.add(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 10), k.chrome, 0, 0, 0);
      k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12), k.gunMetal, 0, -0.35, 0);
      const coil = new THREE.TorusGeometry(0.2, 0.035, 6, 16);
      for (let i = 0; i < 7; i++) k.add(coil, k.warn, 0, -0.25 + i * 0.1, 0).rotation.x = Math.PI / 2 + 0.12;
      for (const y of [-0.72, 0.72]) k.add(new THREE.TorusGeometry(0.1, 0.04, 8, 14), k.steel, 0, y, 0);
      break;
    }
    case 'armor':
      k.plate(1.0, 1.2, 0, 0, 0, 0.9, 0);
      k.plate(0.8, 1.0, 0.1, -0.1, -0.25, 0.9, 0.2);
      k.add(new THREE.BoxGeometry(0.9, 0.08, 1.1), k.accent, -0.05, 0.08, 0.08).rotation.x = 0.9;
      break;
  }
  return g;
}

/** Miniatura 3D (PNG, fundo transparente) de uma arma ou melhoria da loja. Em cache por item e tamanho. */
export function itemThumbnail(item: ShopItem, size = 96): string {
  const key = `item|${item}|${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const { renderer, scene, camera } = setup();
    renderer.setSize(size, size, false);
    const obj = buildItem(item);
    obj.rotation.y = -0.6;
    scene.add(obj);
    frame(obj, camera, new THREE.Vector3(0.9, 0.8, 1), 0.86);
    renderer.render(scene, camera);
    url = renderer.domElement.toDataURL('image/png');
    scene.remove(obj);
    disposeTree(obj);
  } catch {
    url = '';
  }
  cache.set(key, url);
  return url;
}

/** Descarta o renderizador fora da tela e o cache de imagens. */
export function disposeThumbnails(): void {
  cache.clear();
  envTex?.dispose();
  envTex = null;
  renderer?.dispose();
  renderer?.forceContextLoss();
  renderer = null;
  scene = null;
  camera = null;
}
