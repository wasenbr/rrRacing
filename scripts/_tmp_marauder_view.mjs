// Vitrine dos 5 carros (4 ângulos) renderizada fora do jogo. Uso: node scripts/vitrine-carros.mjs <pasta> (npm run dev rodando)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2];
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
p.on('pageerror', (e) => console.log('ERR', String(e)));
await p.goto('http://localhost:5173/referencias/README.md');
const src = await (await fetch('http://localhost:5173/src/render/cars/kit.ts')).text();
const threeUrl = src.match(/from "([^"]*three[^"]*)"/)[1];
const shots = [['lado', 10], ['cima', 11], ['tresq', 12]];
for (const [name, mode] of shots) {
  const url = await p.evaluate(async ({ threeUrl, mode }) => {
    const THREE = await import(threeUrl);
    const cars = await import('/src/render/cars/index.ts');
    document.body.innerHTML = '';
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setSize(1400, 800);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    document.body.appendChild(r.domElement);
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x87a8c8);
    const pm = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.HemisphereLight(0xbcd8ff, 0x6a5040, 3));
    s.environment = pm.fromScene(envScene).texture;
    s.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.2));
    const sun = new THREE.DirectionalLight(0xfff0d8, 3);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
    sun.shadow.camera.right = sun.shadow.camera.top = 30;
    s.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    const ids = ['marauder'];
    const colors = [0xe02828, 0x2f7bff, 0xf2c318, 0x2fc840, 0xb040e0];
    ids.forEach((id, i) => {
      const v = cars.createCarMesh(id, 0x2f7bff, true);
      v.root.scale.setScalar(1);
      v.root.position.set(0, 0, 0);
      v.root.rotation.y = mode === 10 ? Math.PI / 2 : mode === 11 ? 0.9 : -0.7;
      v.animate({ spin: 0.3, steer: 0.3, speed: 0, time: 1, grounded: true });
      s.add(v.root);
    });
    let cam = new THREE.PerspectiveCamera(30, 1400 / 800, 0.1, 200);
    if (mode === 10) cam.position.set(0, 1.6, 13); else if (mode === 11) { cam.position.set(-7, 13, -7); } else cam.position.set(6, 3.2, 8);
    cam.lookAt(0, 1.3, 0);
    r.render(s, cam);
    return r.domElement.toDataURL('image/png');
  }, { threeUrl, mode });
  fs.writeFileSync(`${out}/vitrine_${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await b.close();
