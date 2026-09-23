import * as THREE from 'three';
import { Kit, sideProfile, wheel, type CarVisual } from './common';

function bodyShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-2.15, 0.42);
  s.lineTo(-1.95, 0.42);
  s.absarc(-1.35, 0.46, 0.6, Math.PI, 0, true); // caixa de roda traseira
  s.lineTo(0.75, 0.42);
  s.absarc(1.35, 0.46, 0.6, Math.PI, 0, true); // caixa de roda dianteira
  s.lineTo(2.1, 0.42);
  s.quadraticCurveTo(2.3, 0.5, 2.25, 0.66); // para-choque
  s.lineTo(1.95, 0.84);
  s.quadraticCurveTo(1.2, 0.92, 0.55, 0.97); // capô
  s.lineTo(-1.7, 1.02);
  s.quadraticCurveTo(-2.15, 1.02, -2.2, 0.92); // traseira
  s.lineTo(-2.2, 0.5);
  s.closePath();
  return s;
}

function cabinShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0.6, 0.95);
  s.quadraticCurveTo(0.1, 1.3, -0.25, 1.42); // para-brisa
  s.lineTo(-1.15, 1.42);
  s.quadraticCurveTo(-1.5, 1.3, -1.8, 1.0); // vidro traseiro
  s.closePath();
  return s;
}

/** Marauder: muscle car de combate com canhões duplos no capô. */
export function createMarauder(color: number, shadows: boolean): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = new Kit(color, shadows, body);

  k.add(sideProfile(bodyShape(), 2.0, 0.08), k.paint, 0, 0, 0);
  const cabin = k.add(sideProfile(cabinShape(), 1.62, 0.06), k.glass, 0, 0, 0);
  const roof = k.add(new THREE.BoxGeometry(1.5, 0.06, 0.95), k.paint, 0, 1.44, -0.7);

  // saias laterais, para-choques, grade e tomada de ar
  k.add(new THREE.BoxGeometry(0.12, 0.2, 1.3), k.trim, 1.02, 0.5, 0);
  k.add(new THREE.BoxGeometry(0.12, 0.2, 1.3), k.trim, -1.02, 0.5, 0);
  k.add(new THREE.BoxGeometry(1.9, 0.22, 0.25), k.trim, 0, 0.5, 2.2);
  k.add(new THREE.BoxGeometry(1.9, 0.25, 0.2), k.trim, 0, 0.55, -2.22);
  k.add(new THREE.BoxGeometry(1.0, 0.14, 0.05), k.gunMetal, 0, 0.66, 2.24).rotation.x = -0.4;
  k.add(new THREE.BoxGeometry(0.6, 0.12, 0.8), k.trim, 0, 1.0, 1.1);

  // aerofólio
  k.add(new THREE.BoxGeometry(2.0, 0.06, 0.5), k.paint, 0, 1.38, -1.95).rotation.x = 0.12;
  for (const sx of [-0.75, 0.75]) k.add(new THREE.BoxGeometry(0.08, 0.38, 0.35), k.trim, sx, 1.18, -1.95);

  // canhões dianteiros (laser) e escapamentos
  for (const sx of [-0.62, 0.62]) {
    k.add(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 10), k.gunMetal, sx, 1.02, 1.35).rotation.x = Math.PI / 2;
    k.add(new THREE.BoxGeometry(0.26, 0.16, 0.5), k.gunMetal, sx, 1.0, 0.8);
  }
  for (const sx of [-0.55, 0.55]) k.add(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 10), k.gunMetal, sx, 0.5, -2.3).rotation.x = Math.PI / 2;

  k.lights([[0.68, 0.72, 2.2]], [[0.68, 0.82, -2.21]], 0.4);
  const flames = k.flames([[0, 0.5, -3.0]]);

  const wheels = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ sz, ...wheel(k, { radius: 0.5, width: 0.44 }, sx * 1.02, 0.5, sz * 1.35) })));

  const eye = new THREE.Vector3(0, 1.3, -0.75);
  const { cockpit, steeringWheel } = buildMarauderCockpit(k);

  return {
    root,
    body,
    cabin: [cabin, roof],
    cockpit,
    steeringWheel,
    flames,
    eye,
    animate(a) {
      for (const w of wheels) {
        w.spin.rotation.x = a.spin;
        if (w.sz > 0) w.pivot.rotation.y = -a.steer * 0.45;
      }
    },
  };
}

function buildMarauderCockpit(k: Kit) {
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  k.body.add(cockpit);
  k.add(new THREE.BoxGeometry(1.6, 0.16, 0.5), k.dash, 0, 1.0, 0.1, cockpit).rotation.x = 0.15;
  k.add(new THREE.BoxGeometry(0.5, 0.12, 0.12), k.dash, 0, 1.1, -0.1, cockpit);
  const gaugeGeo = new THREE.CircleGeometry(0.045, 20);
  k.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0x3aff7a }), -0.1, 1.11, -0.17, cockpit).rotation.y = Math.PI;
  k.add(gaugeGeo, new THREE.MeshBasicMaterial({ color: 0xff8a3a }), 0.1, 1.11, -0.17, cockpit).rotation.y = Math.PI;
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, 1.06, -0.3);
  steeringWheel.rotation.x = -0.45;
  cockpit.add(steeringWheel);
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 28), k.trim));
  steeringWheel.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.02), k.trim));
  steeringWheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 12).rotateX(Math.PI / 2), k.trim));
  // colunas A e moldura do teto (mais altas que a cabine externa para não tapar a visão)
  for (const sx of [-1, 1]) {
    k.tube(new THREE.Vector3(sx * 0.8, 1.0, 0.55), new THREE.Vector3(sx * 0.74, 1.7, -0.2), 0.035, k.trim, cockpit);
    k.add(new THREE.BoxGeometry(0.12, 0.28, 1.9), k.dash, sx * 0.86, 1.06, -0.45, cockpit);
  }
  k.add(new THREE.BoxGeometry(1.5, 0.06, 0.1), k.trim, 0, 1.7, -0.2, cockpit);
  k.add(new THREE.BoxGeometry(1.6, 0.06, 1.6), k.dash, 0, 1.05, -0.6, cockpit);
  return { cockpit, steeringWheel };
}
