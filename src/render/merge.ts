import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Junta as malhas paradas de um modelo em poucas malhas (uma por material), para cortar chamadas
 * de desenho — o maior custo de CPU da renderização no celular/tablet.
 *
 * Quem se mexe é descoberto na prática: cada `probe` roda a animação do modelo num estado diferente
 * e todo nó cuja transformação ou visibilidade mudou fica de fora (junto com `keep`, as partes que o
 * jogo mexe diretamente, com tudo abaixo delas; `anchors` só marca o próprio nó como móvel).
 * Cada malha parada é assada no espaço do "âncora" — o ancestral mais
 * próximo que se mexe (ou a raiz) — e agrupada por âncora, material e sombras. `cell` (m) separa
 * o agrupamento também por posição no mundo, mantendo o descarte por câmera no cenário.
 */
export function mergeStatic(root: THREE.Object3D, opts: { keep?: THREE.Object3D[]; anchors?: THREE.Object3D[]; probe?: (() => void)[]; cell?: number } = {}): Set<THREE.Object3D> {
  const snap = new Map<THREE.Object3D, { m: number[]; v: boolean }>();
  const read = () => root.traverse((o) => {
    const s = snap.get(o);
    const m = [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()];
    if (!s) snap.set(o, { m, v: o.visible });
    else if (s.v !== o.visible || m.some((x, k) => Math.abs(x - s.m[k]) > 1e-9)) moving.add(o);
  });
  const moving = new Set<THREE.Object3D>([root]);
  read();
  for (const p of opts.probe ?? []) {
    p();
    read();
  }
  for (const k of opts.keep ?? []) k.traverse((o) => moving.add(o));
  for (const a of opts.anchors ?? []) moving.add(a);

  root.updateMatrixWorld(true);
  const groups = new Map<string, { anchor: THREE.Object3D; mat: THREE.Material; parts: { mesh: THREE.Mesh; rel: THREE.Matrix4 }[] }>();
  const inv = new THREE.Matrix4();
  const wp = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (moving.has(mesh) || mesh.children.length || Array.isArray(mesh.material) || !mesh.visible) return;
    if (mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender || mesh.geometry.morphAttributes.position) return;
    // âncora: ancestral mais próximo que se mexe (a cadeia até ele é toda parada)
    let anchor = mesh.parent!;
    let hidden = false;
    while (!moving.has(anchor) && anchor.parent && anchor !== root) {
      hidden ||= !anchor.visible;
      anchor = anchor.parent;
    }
    if (hidden || (!moving.has(anchor) && anchor !== root)) return;
    const geo = mesh.geometry;
    const attrs = Object.keys(geo.attributes).sort().join(',');
    let key = `${anchor.id}|${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}|${mesh.frustumCulled}|${!!geo.index}|${attrs}`;
    if (opts.cell) {
      mesh.getWorldPosition(wp);
      key += `|${Math.floor(wp.x / opts.cell)},${Math.floor(wp.z / opts.cell)}`;
    }
    inv.copy(anchor.matrixWorld).invert();
    const rel = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { anchor, mat: mesh.material, parts: [] }));
    g.parts.push({ mesh, rel });
  });

  for (const g of groups.values()) {
    if (g.parts.length < 2) continue;
    const geos = g.parts.map(({ mesh, rel }) => {
      const c = mesh.geometry.clone().applyMatrix4(rel);
      // espelhamento (escala negativa) inverte o sentido dos triângulos
      if (rel.determinant() < 0 && c.index) {
        const ix = c.index.array;
        for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
      }
      for (const k of Object.keys(c.attributes)) if (c.attributes[k] instanceof THREE.InterleavedBufferAttribute) c.setAttribute(k, (c.attributes[k] as THREE.InterleavedBufferAttribute).clone());
      return c;
    });
    const merged = mergeGeometries(geos, false);
    for (const c of geos) c.dispose();
    if (!merged) continue;
    const first = g.parts[0].mesh;
    const out = new THREE.Mesh(merged, g.mat);
    out.castShadow = first.castShadow;
    out.receiveShadow = first.receiveShadow;
    out.renderOrder = first.renderOrder;
    out.frustumCulled = first.frustumCulled;
    out.name = 'merged';
    g.anchor.add(out);
    for (const { mesh } of g.parts) mesh.removeFromParent();
  }
  // grupos que ficaram vazios saem da árvore (menos nós para atualizar a cada quadro)
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && !moving.has(o) && o.type === 'Group' && o.children.length === 0) empty.push(o);
  });
  for (const o of empty) o.removeFromParent();
  return moving;
}

/** Congela a matriz local dos nós parados (o three deixa de recompô-la a cada quadro). */
export function freezeStatic(root: THREE.Object3D, moving: Set<THREE.Object3D> = new Set()): void {
  root.traverse((o) => {
    if (moving.has(o)) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}
