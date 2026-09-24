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
const shots = [['iso', 0], ['frente', 1], ['tras', 2], ['perto', 3]];
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
    const ids = ['dirtdevil', 'marauder', 'airblade', 'battletrak', 'havac'];
    const colors = [0xe02828, 0x2f7bff, 0xf2c318, 0x2fc840, 0xb040e0];
    ids.forEach((id, i) => {
      const v = cars.createCarMesh(id, colors[i], true);
      v.root.position.set((i - 2) * 5.2, 0, 0);
      v.root.rotation.y = mode === 2 ? Math.PI + 0.5 : 0.5;
      v.animate({ spin: 0.3, steer: 0.3, speed: 0, time: 1, grounded: true });
      s.add(v.root);
    });
    let cam;
    if (mode === 0) {
      const a = 800 / 1400;
      cam = new THREE.OrthographicCamera(-14, 14, 14 * a, -14 * a, 1, 400);
      cam.position.set(-60, 60 * Math.SQRT2 * Math.tan(Math.PI / 6), -60);
      cam.position.set(-60, 49, -60);
      cam.lookAt(0, 0, 0);
    } else if (mode === 3) {
      cam = new THREE.PerspectiveCamera(35, 1400 / 800, 0.1, 200);
      cam.position.set(-3, 3.5, 7);
      cam.lookAt(-5.2, 0.8, 0);
    } else {
      cam = new THREE.PerspectiveCamera(35, 1400 / 800, 0.1, 200);
      cam.position.set(0, 9, 22);
      cam.lookAt(0, 0.8, 0);
    }
    r.render(s, cam);
    return r.domElement.toDataURL('image/png');
  }, { threeUrl, mode });
  fs.writeFileSync(`${out}/vitrine_${name}.png`, Buffer.from(url.split(',')[1], 'base64'));
}
await b.close();
