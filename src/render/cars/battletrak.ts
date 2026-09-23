import * as THREE from 'three';
import { cockpitRig, Kit, polyShape, sideProfile, treadTexture, type CarVisual } from './common';

/** Contorno da esteira (estádio: retângulo com pontas redondas). */
function trackShape(len: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const h = len / 2 - r;
  s.moveTo(-h, 0);
  s.lineTo(h, 0);
  s.absarc(h, r, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-h, r * 2);
  s.absarc(-h, r, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  return s;
}

/**
 * Battle Trak: blindado sobre esteiras — pesado, lento e muito resistente,
 * com torre de mísseis e dispensador de minas.
 */
export function createBattleTrak(color: number, shadows: boolean): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = new Kit(color, shadows, body);

  // esteiras: borracha com textura que rola + rodas de apoio visíveis
  const tread = treadTexture();
  tread.repeat.set(1, 3);
  const treadMat = new THREE.MeshStandardMaterial({ map: tread, roughness: 0.9 });
  const roadWheels: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const geo = sideProfile(trackShape(4.3, 0.45), 0.55, 0.04, 20);
    // UV simples ao longo do comprimento para a textura rolar
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getZ(i) / 4.3 + pos.getY(i) * 0.3);
    uv.needsUpdate = true;
    k.add(geo, treadMat, sx * 0.98, 0.02, 0);
    for (let i = 0; i < 5; i++) {
      const w = k.add(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 14).rotateZ(Math.PI / 2), k.gunMetal, sx * 1.27, 0.45, -1.6 + i * 0.8);
      w.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.08), k.chrome));
      roadWheels.push(w);
    }
    // para-lama sobre a esteira
    k.add(new THREE.BoxGeometry(0.62, 0.06, 4.4), k.paintDark, sx * 0.98, 0.98, 0);
  }

  // casco blindado com rampa frontal
  const hull = polyShape([
    [-2.1, 0.45],
    [1.7, 0.45],
    [2.25, 0.75],
    [1.5, 1.35],
    [-1.8, 1.35],
    [-2.15, 1.05],
  ]);
  k.add(sideProfile(hull, 1.45, 0.06), k.paint, 0, 0, 0);
  // placas de blindagem e rebites
  for (const z of [-1.2, -0.2, 0.8]) k.add(new THREE.BoxGeometry(1.5, 0.04, 0.05), k.trim, 0, 1.36, z);
  // visor do motorista (fenda)
  const visor = k.add(new THREE.BoxGeometry(0.9, 0.12, 0.05), k.glass, 0, 1.2, 1.63);
  visor.rotation.x = -0.9;

  // torre giratória com lançador de mísseis
  const turret = new THREE.Group();
  turret.position.set(0, 1.35, -0.5);
  body.add(turret);
  k.add(new THREE.CylinderGeometry(0.6, 0.7, 0.35, 16), k.paint, 0, 0.18, 0, turret);
  const rack = k.add(new THREE.BoxGeometry(0.9, 0.4, 0.8), k.gunMetal, 0, 0.5, 0.35, turret);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) {
      const tube = k.add(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10), k.trim, -0.28 + i * 0.28, 0.4 + j * 0.2, 0.36, rack);
      tube.rotation.x = Math.PI / 2;
    }
  k.add(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), k.gunMetal, 0.45, 0.8, -0.2, turret); // antena

  // dispensador de minas e escapamento
  k.add(new THREE.BoxGeometry(0.7, 0.3, 0.3), k.gunMetal, 0, 0.75, -2.2);
  k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.6, 10), k.gunMetal, 0.5, 1.5, -1.8);

  k.lights([[0.5, 1.0, 2.0]], [[0.55, 1.0, -2.17]], 0.3);
  const flames = k.flames([[0, 0.8, -2.9]], 1.1);

  const eye = new THREE.Vector3(0, 1.74, 0.25);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.65, roofY: 2.08, frontZ: 1.3 });

  let lastT = 0;
  let turretAim = 0;
  return {
    root,
    body,
    cabin: [turret],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      const dt = Math.min(0.1, Math.max(0, a.time - lastT));
      lastT = a.time;
      tread.offset.y = -a.spin * 0.08;
      for (const w of roadWheels) w.rotation.x = a.spin * 1.6;
      // a torre acompanha um pouco a direção
      turretAim += (-a.steer * 0.35 - turretAim) * Math.min(1, dt * 3);
      turret.rotation.y = turretAim;
    },
  };
}
