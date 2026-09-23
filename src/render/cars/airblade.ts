import * as THREE from 'three';
import { cockpitRig, Kit, sideProfile, type CarVisual } from './common';

function hullShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-2.1, 0.55);
  s.lineTo(1.7, 0.55);
  s.quadraticCurveTo(2.35, 0.6, 2.2, 0.8); // bico arredondado
  s.quadraticCurveTo(1.4, 0.98, 0.6, 1.0);
  s.lineTo(-1.6, 1.05);
  s.quadraticCurveTo(-2.1, 1.02, -2.15, 0.85);
  s.closePath();
  return s;
}

/**
 * Air Blade: hovercraft — flutua sobre uma saia de borracha, empurrado por dois
 * ventiladores traseiros. Rápido e escorregadio. Míssil + óleo.
 */
export function createAirBlade(color: number, shadows: boolean): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // tudo que flutua fica em "hull", que balança sozinho
  const hull = new THREE.Group();
  body.add(hull);
  const k = new Kit(color, shadows, hull);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // saia de borracha (elipse achatada)
  const skirt = k.add(new THREE.CylinderGeometry(1, 1.06, 0.42, 36), k.rubber, 0, 0.38, 0);
  skirt.scale.set(1.12, 1, 2.2);
  // brilho do colchão de ar por baixo
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40c0ff).multiplyScalar(2.5), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(Math.PI / 2), glowMat);
  glow.position.y = 0.12;
  glow.scale.set(1.0, 1, 2.0);
  hull.add(glow);

  // casco e convés
  k.add(sideProfile(hullShape(), 2.0, 0.12), k.paint, 0, 0, 0);
  k.add(new THREE.BoxGeometry(2.1, 0.1, 3.9), k.paintDark, 0, 0.58, -0.05);
  // faixas laterais
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.04, 0.08, 3.2), k.chrome, sx * 1.02, 0.85, -0.1);

  // cabine em bolha
  const canopy = k.add(new THREE.SphereGeometry(0.75, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), k.glass, 0, 0.98, -0.1);
  canopy.scale.set(1, 0.72, 1.55);
  const frame = k.add(new THREE.TorusGeometry(0.75, 0.035, 6, 32, Math.PI), k.paintDark, 0, 0.98, -0.1);
  frame.scale.set(1, 0.72, 1);

  // dois ventiladores traseiros em dutos
  const fans: THREE.Group[] = [];
  for (const sx of [-0.62, 0.62]) {
    const duct = k.add(new THREE.TorusGeometry(0.55, 0.1, 10, 28), k.paintDark, sx, 1.45, -1.75);
    duct.rotation.y = 0;
    k.tube(V(sx, 0.95, -1.6), V(sx, 1.0, -1.75), 0.08, k.gunMetal);
    k.add(new THREE.BoxGeometry(0.08, 0.5, 0.08), k.gunMetal, sx, 1.0, -1.75);
    const fan = new THREE.Group();
    fan.position.set(sx, 1.45, -1.75);
    for (let i = 0; i < 5; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.03), k.gunMetal);
      blade.position.y = 0.24;
      const arm = new THREE.Group();
      arm.rotation.z = (i / 5) * Math.PI * 2;
      blade.rotation.y = 0.5;
      arm.add(blade);
      fan.add(arm);
    }
    fan.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), k.chrome));
    hull.add(fan);
    fans.push(fan);
    // leme atrás de cada ventilador
    k.add(new THREE.BoxGeometry(0.05, 0.9, 0.4), k.paint, sx, 1.45, -2.05);
  }

  // lançadores de míssil nas laterais e tanque de óleo
  for (const sx of [-1, 1]) {
    const pod = k.add(new THREE.CylinderGeometry(0.16, 0.16, 1.1, 12), k.gunMetal, sx * 0.85, 1.12, 0.6);
    pod.rotation.x = Math.PI / 2;
    k.add(new THREE.ConeGeometry(0.16, 0.3, 12), k.tail, sx * 0.85, 1.12, 1.3).rotation.x = Math.PI / 2;
  }
  k.add(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 12), k.gunMetal, 0, 0.95, -1.35).rotation.z = Math.PI / 2;

  k.lights([[0.55, 0.82, 2.18]], [[0.7, 0.9, -2.12]], 0.35);
  const flames = k.flames([[-0.62, 1.45, -2.4], [0.62, 1.45, -2.4]], 0.9);

  const eye = new THREE.Vector3(0, 1.46, -0.2);
  // o cockpit fica preso à carroceria (não ao casco que balança), alinhado com a câmera
  const { cockpit, steeringWheel } = cockpitRig(new Kit(color, shadows, body), { eye, halfWidth: 0.7, roofY: 1.75, frontZ: 0.9 });

  let fanAngle = 0;
  let lastT = 0;
  return {
    root,
    body,
    cabin: [canopy, frame],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      const dt = Math.min(0.1, Math.max(0, a.time - lastT));
      lastT = a.time;
      fanAngle += dt * (8 + Math.abs(a.speed) * 1.2);
      for (const f of fans) f.rotation.z = fanAngle;
      // flutua e inclina com a direção
      hull.position.y = 0.08 + Math.sin(a.time * 5.3) * 0.04;
      hull.rotation.z = -a.steer * 0.08;
      glowMat.opacity = 0.4 + Math.sin(a.time * 23) * 0.1;
    },
  };
}
