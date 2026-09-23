import * as THREE from 'three';
import { cockpitRig, Kit, polyShape, sideProfile, wheel, type CarVisual } from './common';

/**
 * Dirt Devil: buggy de terra barato — chassi tubular aberto, gaiola de proteção,
 * motor exposto atrás e pneus grandes com cravos.
 */
export function createDirtDevil(color: number, shadows: boolean): CarVisual {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const k = new Kit(color, shadows, body);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // assoalho e bico em cunha
  k.add(new THREE.BoxGeometry(1.3, 0.14, 3.2), k.trim, 0, 0.55, -0.1);
  const nose = polyShape([
    [0.2, 0.5],
    [1.95, 0.55],
    [2.05, 0.72],
    [1.4, 0.95],
    [0.2, 1.0],
  ]);
  k.add(sideProfile(nose, 1.35, 0.06), k.paint, 0, 0, 0);
  // laterais baixas (portas de tubo cobertas por painéis)
  for (const sx of [-1, 1]) k.add(new THREE.BoxGeometry(0.08, 0.35, 1.5), k.paint, sx * 0.68, 0.78, -0.4);
  // banco
  k.add(new THREE.BoxGeometry(0.6, 0.12, 0.55), k.dash, 0, 0.72, -0.6);
  k.add(new THREE.BoxGeometry(0.6, 0.6, 0.12), k.dash, 0, 1.0, -0.9).rotation.x = -0.15;

  // motor exposto e escapamentos subindo
  k.add(new THREE.BoxGeometry(0.9, 0.5, 0.8), k.gunMetal, 0, 0.85, -1.5);
  for (let i = 0; i < 4; i++) k.add(new THREE.BoxGeometry(0.95, 0.04, 0.05), k.chrome, 0, 1.12, -1.25 - i * 0.15);
  for (const sx of [-0.25, 0.25]) {
    k.tube(V(sx, 0.9, -1.85), V(sx * 1.4, 1.5, -2.1), 0.06, k.chrome);
  }

  // gaiola de proteção
  const cage = k.paintDark;
  const hoop = (z: number, top: number) => {
    k.tube(V(-0.66, 0.62, z), V(-0.5, top, z), 0.05, cage);
    k.tube(V(0.66, 0.62, z), V(0.5, top, z), 0.05, cage);
    k.tube(V(-0.5, top, z), V(0.5, top, z), 0.05, cage);
  };
  hoop(-1.0, 1.75);
  hoop(0.15, 1.65);
  for (const sx of [-0.5, 0.5]) k.tube(V(sx, 1.75, -1.0), V(sx, 1.65, 0.15), 0.05, cage);
  for (const sx of [-0.66, 0.66]) k.tube(V(sx * 0.9, 0.62, 0.9), V(sx * 0.76, 1.65, 0.15), 0.045, cage);
  // teto de tela (escondido no cockpit)
  const roof = k.add(new THREE.BoxGeometry(1.0, 0.03, 1.15), k.trim, 0, 1.72, -0.42);
  roof.rotation.x = 0.08;

  // emissor de laser no topo da gaiola (escondido no cockpit: fica colado no olho do piloto)
  const roofGear: THREE.Object3D[] = [];
  roofGear.push(k.add(new THREE.BoxGeometry(0.22, 0.18, 0.6), k.gunMetal, 0, 1.85, 0.05));
  const emitter = k.add(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 8), k.gunMetal, 0, 1.85, 0.55);
  emitter.rotation.x = Math.PI / 2;
  roofGear.push(emitter);
  // lata de óleo traseira
  k.add(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), k.gunMetal, 0, 0.72, -2.05).rotation.z = Math.PI / 2;

  // para-choque de tubo e faróis de milha
  k.tube(V(-0.75, 0.55, 2.1), V(0.75, 0.55, 2.1), 0.05, k.chrome);
  for (const sx of [-0.35, 0.35]) {
    const lamp = k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 14), k.head, sx, 1.83, 0.2);
    lamp.rotation.x = Math.PI / 2;
    roofGear.push(lamp);
  }
  k.lights([], [[0.45, 0.8, -1.92]], 0.2);
  const flames = k.flames([[-0.35, 1.55, -2.25], [0.35, 1.55, -2.25]], 0.7);

  // rodas grandes com cravos, pouco cobertas
  const wheels = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => ({ sz, ...wheel(k, { radius: sz > 0 ? 0.52 : 0.6, width: 0.5, spokes: 4, knobby: true }, sx * 1.02, sz > 0 ? 0.52 : 0.6, sz * 1.4) })),
  );
  // suspensão: braços até as rodas
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.tube(V(sx * 0.6, 0.6, sz * 1.3), V(sx * 0.85, sz > 0 ? 0.52 : 0.6, sz * 1.4), 0.04, k.gunMetal);

  const eye = new THREE.Vector3(0, 1.35, -0.55);
  const { cockpit, steeringWheel } = cockpitRig(k, { eye, halfWidth: 0.62, roofY: null, frontZ: 0.6 });

  return {
    root,
    body,
    cabin: [roof, ...roofGear],
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
