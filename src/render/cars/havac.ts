import * as THREE from 'three';
import { cockpitRig, Kit, sideProfile, wheel, type CarVisual } from './common';

function wedgeShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-2.2, 0.4);
  s.lineTo(-1.95, 0.4);
  s.absarc(-1.35, 0.5, 0.62, Math.PI, 0, true);
  s.lineTo(0.85, 0.4);
  s.absarc(1.4, 0.44, 0.52, Math.PI, 0, true);
  s.lineTo(2.3, 0.4);
  s.lineTo(2.35, 0.5); // bico de lâmina
  s.quadraticCurveTo(1.6, 0.72, 0.7, 0.88);
  s.lineTo(-1.5, 1.0);
  s.lineTo(-2.25, 1.05);
  s.lineTo(-2.25, 0.55);
  s.closePath();
  return s;
}

function canopyShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.9, 0.84);
  s.quadraticCurveTo(0.1, 1.28, -0.7, 1.26);
  s.quadraticCurveTo(-1.3, 1.2, -1.55, 0.98);
  s.closePath();
  return s;
}

/**
 * Havac: o topo de linha — cunha baixa e larga, cabine de caça, derivas duplas,
 * dois casulos de mísseis e faixas de luz néon.
 */
export function createHavac(color: number, shadows: boolean): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = new Kit(color, shadows, body);

  k.add(sideProfile(wedgeShape(), 2.1, 0.1), k.paint, 0, 0, 0);
  const canopy = k.add(sideProfile(canopyShape(), 1.25, 0.12), k.glass, 0, 0, 0);

  // faixas néon nas laterais
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x40e0ff).multiplyScalar(2.2) });
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.03, 0.04, 2.4), neon, sx * 1.07, 0.62, 0.1);

  // entradas de ar laterais
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.1, 0.22, 0.7), k.trim, sx * 1.02, 0.72, -0.6);

  // derivas duplas e aerofólio
  for (const sx of [-0.8, 0.8]) {
    const fin = k.add(new THREE.BoxGeometry(0.06, 0.7, 0.8), k.paintDark, sx, 1.35, -1.85);
    fin.rotation.x = -0.35;
    fin.rotation.z = sx * 0.15;
  }
  k.add(new THREE.BoxGeometry(1.9, 0.05, 0.45), k.paintDark, 0, 1.55, -2.05);

  // casulos de mísseis (dois de cada lado)
  for (const sx of [-1, 1]) {
    const pod = k.add(new THREE.BoxGeometry(0.4, 0.3, 1.3), k.gunMetal, sx * 0.72, 1.0, 0.75);
    for (const dx of [-0.09, 0.09])
      for (const dy of [-0.06, 0.07]) {
        const tip = k.add(new THREE.ConeGeometry(0.06, 0.2, 8), k.tail, dx, dy, 0.72, pod);
        tip.rotation.x = Math.PI / 2;
      }
  }
  // dispensador de minas
  k.add(new THREE.BoxGeometry(0.8, 0.18, 0.25), k.gunMetal, 0, 0.6, -2.3);

  k.lights([[0.75, 0.58, 2.25]], [[0.6, 0.95, -2.27]], 0.5);
  const flames = k.flames([[-0.4, 0.65, -3.0], [0.4, 0.65, -3.0]], 0.9);

  // rodas traseiras maiores
  const wheels = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({ sz, ...wheel(k, { radius: sz > 0 ? 0.46 : 0.54, width: sz > 0 ? 0.42 : 0.55, spokes: 6 }, sx * 1.02, sz > 0 ? 0.46 : 0.54, sz > 0 ? 1.4 : -1.35) })),
  );

  const eye = new THREE.Vector3(0, 1.26, -0.35);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.62, roofY: 1.6, frontZ: 0.75 });

  return {
    root,
    body,
    cabin: [canopy],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      for (const w of wheels) {
        w.spin.rotation.x = a.spin;
        if (w.sz > 0) w.pivot.rotation.y = -a.steer * 0.42;
      }
    },
  };
}
