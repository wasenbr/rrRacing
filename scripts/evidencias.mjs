// Gera evidências para os avaliadores: capturas de tela, teste de jogo automático e gravações de som.
// Uso: node scripts/evidencias.mjs <pastaSaida> [tudo|telas|ui|celular|jogo|som|picote|desempenho]  (som inclui picote)  (telas inclui ui e celular) [url]
// Precisa do servidor de desenvolvimento rodando (npm run dev).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'evidencias';
const what = process.argv[3] ?? 'tudo';
const base = process.argv[4] ?? 'http://localhost:5173/';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-blink-features=AudioContextPlayoutStats'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// máquina carregada (render por software): capturas podem levar mais que os 30 s padrão
page.setDefaultTimeout(180000);
// sem o websocket do Vite: edições no código durante a gravação não recarregam a página
await page.routeWebSocket(/.*/, () => {});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
const wait = (ms) => page.waitForTimeout(ms);

async function freshPage() {
  await page.goto(base + '?autopilot&laps=3&q=alto', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.game, null, { timeout: 180000 });
  await wait(2500);
}
await freshPage();

/* ------------------------------------------------------------------ */
/* Telas                                                                */
/* ------------------------------------------------------------------ */
async function telas() {
  const dir = path.join(out, 'telas');
  fs.mkdirSync(dir, { recursive: true });
  /** Avança a simulação N segundos de jogo (o render sem GPU é lento demais para tempo real). */
  async function advance(seconds) {
    await page.evaluate((n) => {
      const g = window.game;
      for (let k = 0; k < n; k++) g.step(1 / 60);
    }, Math.round(seconds * 60));
    await wait(900);
  }
  await page.screenshot({ path: `${dir}/00_menu.png` });
  const races = [
    ['chem6-1', 'marauder', 'iso'],
    ['drakonis-2', 'havac', 'iso'],
    ['bogmire-1', 'battletrak', 'iso'],
    ['newmojave-1', 'airblade', 'chase'],
    ['nho-2', 'dirtdevil', 'iso'],
    ['inferno-2', 'havac', 'cockpit'],
  ];
  let i = 1;
  for (const [trackId, vehicleId, cam] of races) {
    await page.evaluate(([trackId, vehicleId, cam]) => {
      const a = window.game.menuActions();
      a.setCamera(cam);
      a.quickRace({ trackId, vehicleId, color: 0x2f7bff, difficulty: 'normal' });
    }, [trackId, vehicleId, cam]);
    await wait(1500);
    const n = String(i).padStart(2, '0');
    await page.screenshot({ path: `${dir}/${n}a_${trackId}_${cam}_largada.png` });
    await advance(12);
    await page.screenshot({ path: `${dir}/${n}b_${trackId}_${cam}_corrida.png` });
    await advance(9);
    await page.screenshot({ path: `${dir}/${n}c_${trackId}_${cam}_corrida.png` });
    i++;
  }
  // efeitos: explosão de carro perto do jogador e faíscas na mureta (API de depuração do jogo)
  /** Espera N quadros desenhados (cada um avança os efeitos em até 0,1 s de jogo). */
  const frames = (n) =>
    page.evaluate((n) => new Promise((res) => {
      let k = 0;
      const f = () => (++k >= n ? res() : requestAnimationFrame(f));
      requestAnimationFrame(f);
    }), n);
  for (const [trackId, tag] of [['chem6-1', 'chem6'], ['drakonis-2', 'drakonis']]) {
    await page.evaluate((trackId) => {
      const a = window.game.menuActions();
      a.setCamera('iso');
      a.quickRace({ trackId, vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
    }, trackId);
    await wait(1500);
    await advance(8);
    // o rival mais próximo vai para 7 m à frente do jogador e explode (blindagem zerada)
    await page.evaluate(() => {
      const g = window.game;
      const w = g.world;
      const me = w.racers[g.playerId];
      const d = (o) => Math.hypot(o.car.x - me.car.x, o.car.z - me.car.z);
      const r = w.racers.filter((o) => o.id !== g.playerId && o.alive).sort((a, b) => d(a) - d(b))[0];
      const q = w.track.query(me.car.x, me.car.z, me.car.pieceIndex);
      const p = w.track.pointAtDist(q.dist + 7);
      Object.assign(r.car, { x: p.x, z: p.z, y: p.h, vx: 0, vz: 0 });
      r.armor = 0;
      r.alive = false;
      r.respawnTimer = 2.5;
      g.onEvent({ type: 'explode', racer: r.id, by: -1, x: r.car.x, y: r.car.y, z: r.car.z, bounty: 0 });
    });
    await frames(2);
    await page.screenshot({ path: `${dir}/50_explosao_${tag}_a.png` });
    await frames(5);
    await page.screenshot({ path: `${dir}/50_explosao_${tag}_b.png` });
    await frames(14);
    await page.screenshot({ path: `${dir}/50_explosao_${tag}_c.png` });
  }
  // faíscas: o jogador é jogado contra a mureta mais próxima por alguns passos de simulação
  await page.evaluate(() => {
    const g = window.game;
    const w = g.world;
    const c = w.racers[g.playerId].car;
    for (let k = 0; k < 14; k++) {
      const q = w.track.query(c.x, c.z, c.pieceIndex);
      const side = Math.sign(q.lateral) || 1;
      const lx = Math.cos(q.heading) * side;
      const lz = -Math.sin(q.heading) * side;
      c.vx = lx * 14 + Math.sin(q.heading) * 18;
      c.vz = lz * 14 + Math.cos(q.heading) * 18;
      g.step(1 / 60);
    }
  });
  await frames(1);
  await page.screenshot({ path: `${dir}/51_faiscas_mureta.png` });

  // close dos carros: vitrine com os 5 modelos lado a lado (se o jogo expuser a função)
  const hasShowroom = await page.evaluate(() => typeof window.game.showroom === 'function');
  if (hasShowroom) {
    for (const [k, angle] of [['frente', 0.6], ['tras', 3.6]]) {
      await page.evaluate((a) => window.game.showroom(a), angle);
      await wait(1500);
      await page.screenshot({ path: `${dir}/20_vitrine_${k}.png` });
    }
  }
  await page.evaluate(() => window.game.menuActions().setCamera('iso'));
  await page.evaluate(() => window.game.menuActions().toMain());
}

/* ------------------------------------------------------------------ */
/* Interface: menus, garagem, loja, slots e o jogo em tela de celular   */
/* ------------------------------------------------------------------ */
async function ui() {
  const dir = path.join(out, 'telas');
  fs.mkdirSync(dir, { recursive: true });
  // clique disparado pela própria página: handlers pesados (montar a corrida no render por
  // software) passam dos 15 s de espera do page.click
  const click = async (sel) => {
    await page.waitForSelector(sel, { timeout: 60000 });
    await page.evaluate((q) => setTimeout(() => document.querySelector(q).click(), 0), sel);
    await wait(1500);
    await page.waitForFunction(() => true, null, { timeout: 180000 });
  };
  // espera as miniaturas dos carros (geradas aos poucos; no render por software levam ~2 s cada)
  const shot = async (name) => {
    await page.waitForFunction(() => !document.querySelector('img.car-img.loading'), null, { timeout: 90000 }).catch(() => {});
    await wait(300);
    await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
  };
  // tela alta para caber o cartão inteiro dos menus
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.evaluate(() => window.game.menuActions().toMain());
  await wait(1200);
  await shot('30_menu_principal');
  await click('button[data-act="new"]');
  await shot('31_nova_campanha_pilotos');
  // segredo do Olaf: 5 toques rápidos no Tarquinn
  await page.evaluate(() => {
    const t = document.querySelector('button[data-char="tarquinn"]');
    for (let k = 0; k < 5; k++) t.click();
  });
  await wait(600);
  await shot('32_olaf_liberado');
  await click('button[data-diff="hard"]');
  await click('button[data-act="new-start"]');
  await wait(1500);
  await shot('33_garagem');
  // garagem na altura de um notebook comum (item 60: sem rolagem longa)
  await page.setViewportSize({ width: 1280, height: 720 });
  await wait(800);
  await shot('33b_garagem_720');
  // viagem para o planeta seguinte (item 59): início, meio e fim da animação
  await page.evaluate(async () => {
    const { PLANETS } = await window.devModules();
    window.game.menus.showPlanetWarp({ from: PLANETS[0], to: PLANETS[1], planets: 6, vehicleId: 'marauder', color: 0xe02828 });
  });
  await wait(400);
  await page.screenshot({ path: `${dir}/33c_viagem_planeta_inicio.png` });
  await wait(900);
  await page.screenshot({ path: `${dir}/33d_viagem_planeta_meio.png` });
  await wait(3000);
  await page.screenshot({ path: `${dir}/33e_viagem_planeta_fim.png` });
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.evaluate(() => window.game.menuActions().warpDone());
  await wait(1500);
  await click('button[data-act="shop"]');
  await shot('34_loja_melhorias');
  await click('button[data-tab="weapons"]');
  await shot('35_loja_armas');
  await click('button[data-tab="cars"]');
  await shot('36_loja_carros');
  await click('button[data-act="hub"]');
  await click('button[data-act="save"]');
  await click('button[data-save="1"]');
  await shot('37_salvar_slots');
  await page.evaluate(() => window.game.menuActions().toMain());
  await wait(800);
  await click('button[data-act="load"]');
  await shot('38_carregar_slots');
  await click('button[data-act="slots-back"]');
  await click('button[data-act="quick"]');
  await shot('39_corrida_rapida');
  await page.evaluate(() => window.game.menuActions().toMain());
  await wait(500);
  await click('button[data-act="settings"]');
  await shot('40_opcoes');
  await page.evaluate(() => window.game.menuActions().toMain());
  await page.setViewportSize({ width: 1280, height: 720 });
  await wait(800);

}

/* ------------------------------------------------------------------ */
/* Celular: menu, corrida com controles de toque, pausa e aviso em pé    */
/* ------------------------------------------------------------------ */
async function celular() {
  const dir = path.join(out, 'telas');
  fs.mkdirSync(dir, { recursive: true });
  // celular deitado (tela de toque)
  // (escala 1: com 2x o render por software estoura o tempo de carga)
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const m = await ctx.newPage();
  m.setDefaultTimeout(180000);
  await m.routeWebSocket(/.*/, () => {});
  m.on('pageerror', (e) => errors.push('[celular] ' + String(e)));
  await m.goto(base + '?autopilot&laps=3&q=alto', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await m.waitForFunction(() => !!window.game, null, { timeout: 180000 });
  await m.waitForTimeout(2500);
  await m.screenshot({ path: `${dir}/41_celular_menu.png`, timeout: 120000 });
  await m.evaluate(() => window.game.menuActions().quickRace({ trackId: 'chem6-1', vehicleId: 'marauder', color: 0xe02828, difficulty: 'normal' }));
  await m.waitForTimeout(1200);
  await m.evaluate(() => {
    const g = window.game;
    for (let k = 0; k < 60 * 8; k++) g.step(1 / 60);
  });
  await m.waitForTimeout(900);
  await m.screenshot({ path: `${dir}/42_celular_corrida_controles.png`, timeout: 120000 });
  // aceleração automática: o polegar direito fica com FREIO e TIRO (virar e atirar ao mesmo tempo)
  await m.evaluate(() => { window.game.menuActions().setAutoThrottle(true); window.game.menus.hideAll(); });
  await m.waitForTimeout(500);
  await m.screenshot({ path: `${dir}/44_celular_acel_automatica.png`, timeout: 120000 });
  await m.evaluate(() => { window.game.menuActions().setAutoThrottle(false); window.game.menus.hideAll(); });
  await m.evaluate(() => window.game.togglePause());
  await m.waitForTimeout(700);
  await m.screenshot({ path: `${dir}/43_celular_pausa.png`, timeout: 120000 });
  await m.evaluate(() => window.game.togglePause());
  // celular em pé: aviso para girar (e a corrida pausa)
  await m.setViewportSize({ width: 390, height: 844 });
  await m.waitForTimeout(1200);
  await m.screenshot({ path: `${dir}/45_celular_retrato.png`, timeout: 120000 });
  await ctx.close();
}

/* ------------------------------------------------------------------ */
/* Jogo: corridas simuladas e medidas de dirigibilidade                 */
/* ------------------------------------------------------------------ */
async function jogo() {
  const result = await page.evaluate(async () => {
    const { TRACKS, VEHICLES, Track, createWorld, stepWorld, PRIZES, forwardSpeed } = await window.devModules();
    const dt = 1 / 60;
    const ids = Object.keys(VEHICLES);

    // 1) corrida completa em cada pista, 4 CPUs de habilidades diferentes, 4 voltas
    const races = [];
    for (const def of TRACKS) {
      const track = new Track(def);
      const profiles = [
        { skill: 0.95, aggression: 0.8, lane: 0.5 },
        { skill: 0.85, aggression: 0.6, lane: -1 },
        { skill: 0.75, aggression: 0.9, lane: 1.5 },
        { skill: 0.65, aggression: 0.4, lane: -2 },
      ];
      const car = ids[Math.min(ids.length - 1, Math.floor(TRACKS.indexOf(def) / 2.4))];
      const entries = profiles.map((ai, i) => ({ name: `CPU${i}`, color: 0xffffff, spec: VEHICLES[car], ai }));
      const w = createWorld(track, entries, 4, 1234, PRIZES);
      w.started = true;
      const stats = { fires: 0, hits: 0, explosions: 0, bumps: 0, pickups: 0, spins: 0, leadChanges: 0, placeChanges: 0, respawns: 0 };
      let leader = -1;
      const lastPlace = w.racers.map((r) => r.place);
      let t = 0;
      let wallTime = 0;
      let stuck = 0;
      const speeds = [];
      while (w.finishedCount < 4 && t < 600) {
        stepWorld(w, {}, dt);
        t += dt;
        for (const e of w.events) {
          if (e.type === 'fire') stats.fires++;
          if (e.type === 'hit') stats.hits++;
          if (e.type === 'explode') stats.explosions++;
          if (e.type === 'bump') stats.bumps++;
          if (e.type === 'pickup') stats.pickups++;
          if (e.type === 'spin') stats.spins++;
          if (e.type === 'respawn') stats.respawns++;
        }
        const ld = w.racers.find((r) => r.place === 1).id;
        if (ld !== leader) {
          if (leader !== -1) stats.leadChanges++;
          leader = ld;
        }
        w.racers.forEach((r, i) => {
          if (r.place !== lastPlace[i]) stats.placeChanges++;
          lastPlace[i] = r.place;
          if (r.car.wallImpact > 0) wallTime += dt;
          const s = Math.abs(forwardSpeed(r.car));
          if (w.started && r.alive && s < 2 && !r.finishPlace) stuck += dt;
          speeds.push(s / r.spec.maxSpeed);
        });
      }
      const finish = w.racers.map((r) => (r.finishPlace ? r.progress.finishTime : null));
      const done = finish.filter((x) => x !== null);
      races.push({
        track: def.id,
        car,
        finished: done.length,
        winnerTime: done.length ? Math.min(...done).toFixed(1) : null,
        spreadFirstLast: done.length > 1 ? (Math.max(...done) - Math.min(...done)).toFixed(1) : null,
        lapTimesLeader: w.racers.find((r) => r.finishPlace === 1)?.progress.lapTimes.map((x) => x.toFixed(1)) ?? [],
        ...stats,
        wallContactSecondsPerCar: (wallTime / 4).toFixed(1),
        stuckSecondsTotal: stuck.toFixed(1),
        avgSpeedRatio: (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(2),
      });
    }

    // 2) dirigibilidade de cada carro: um piloto simples segue a linha central com acelerador cheio,
    //    freando só em curvas fechadas. Mede arranque, velocidade, frenagem, volta solo e efeito das melhorias.
    const handling = [];
    const { buildSpec, newCarSetup } = await window.devModules();
    function drive(spec, seconds, stopAt) {
      const track = new Track(TRACKS[0]);
      const w = createWorld(track, [{ name: 'P', color: 0, spec, ai: null }], 99, 1, PRIZES);
      w.started = true;
      const r = w.racers[0];
      const out = { t60: null, t100: null, top: 0, lap: null, wall: 0, maxSlipDeg: 0, air: 0 };
      let t = 0;
      while (t < seconds) {
        const q = track.query(r.car.x, r.car.z, r.car.pieceIndex);
        const v = forwardSpeed(r.car);
        const p = track.pointAtDist(q.dist + 6 + Math.max(0, v) * 0.3);
        const want = Math.atan2(p.x - r.car.x, p.z - r.car.z);
        let d = want - r.car.heading;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const now = track.pointAtDist(q.dist).heading, later = track.pointAtDist(q.dist + 8 + v * 0.45).heading;
        let bend = later - now;
        while (bend > Math.PI) bend -= 2 * Math.PI;
        while (bend < -Math.PI) bend += 2 * Math.PI;
        const input = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -d * 2.5)), fire: false, drop: false, nitro: false };
        if (Math.abs(bend) > 0.9 && v > spec.maxSpeed * 0.7) { input.throttle = 0; input.brake = 0.6; }
        stepWorld(w, { 0: input }, dt);
        t += dt;
        const kmh = forwardSpeed(r.car) * 3.6;
        if (out.t60 === null && kmh >= 60) out.t60 = t;
        if (out.t100 === null && kmh >= 100) out.t100 = t;
        out.top = Math.max(out.top, kmh);
        if (r.car.wallImpact > 0) out.wall++;
        if (!r.car.grounded) out.air = Math.max(out.air, r.car.airTime);
        const sp = Math.hypot(r.car.vx, r.car.vz);
        if (sp > 8) {
          const slip = Math.abs(Math.atan2(r.car.vx * Math.cos(r.car.heading) - r.car.vz * Math.sin(r.car.heading), r.car.vx * Math.sin(r.car.heading) + r.car.vz * Math.cos(r.car.heading))) * 57.3;
          out.maxSlipDeg = Math.max(out.maxSlipDeg, slip);
        }
        if (out.lap === null && r.progress.lapTimes.length) out.lap = r.progress.lapTimes[0];
        if (stopAt && stopAt(r, t)) break;
      }
      return out;
    }
    for (const id of ids) {
      const spec = VEHICLES[id];
      const a = drive(spec, 40, (r) => r.progress.lapTimes.length >= 1);
      const full = newCarSetup(id);
      full.upgrades = { engine: 3, tires: 3, shocks: 3, armor: 3 };
      const b = drive(buildSpec(spec, full), 40, (r) => r.progress.lapTimes.length >= 1);
      // arranque e frenagem numa oval plana de teste (sem saltos, rampas nem vãos): acelera até
      // 100 km/h (ou 3 s) em linha reta e freia
      const flat = { ...TRACKS[0], id: 'teste-reta', name: 'Reta de teste', layout: 'F S S S S S S S S S S S S S R R S S S S S S S S S S S S S S R R', slime: 0 };
      let track;
      try { track = new Track(flat); } catch { track = new Track(TRACKS.find((d) => d.id === 'newmojave-1') ?? TRACKS[0]); }
      const w = createWorld(track, [{ name: 'P', color: 0, spec, ai: null }], 99, 1, PRIZES);
      w.started = true;
      const r = w.racers[0];
      let t = 0;
      let flat60 = null, flat100 = null;
      while (forwardSpeed(r.car) * 3.6 < 100 && t < 3) {
        stepWorld(w, { 0: { throttle: 1, brake: 0, steer: 0, fire: false, drop: false, nitro: false } }, dt);
        t += dt;
        if (flat60 === null && forwardSpeed(r.car) * 3.6 >= 60) flat60 = t;
      }
      if (forwardSpeed(r.car) * 3.6 >= 100) flat100 = t;
      const from = forwardSpeed(r.car) * 3.6;
      const x0 = r.car.x, z0 = r.car.z;
      let bt = 0;
      while (forwardSpeed(r.car) > 0.5 && bt < 5) { stepWorld(w, { 0: { throttle: 0, brake: 1, steer: 0, fire: false, drop: false, nitro: false } }, dt); bt += dt; }
      handling.push({
        car: id,
        maxSpeedKmh: +(spec.maxSpeed * 3.6).toFixed(0),
        zeroTo60s: flat60 === null ? null : +flat60.toFixed(2),
        zeroTo100s: flat100 === null ? null : +flat100.toFixed(2),
        brakeTrack: track.def?.id ?? '?',
        topReachedKmh: +a.top.toFixed(0),
        brakeFromKmh: +from.toFixed(0),
        brakeDistanceM: +Math.hypot(r.car.x - x0, r.car.z - z0).toFixed(1),
        soloLapS: a.lap === null ? null : +a.lap.toFixed(2),
        soloLapFullUpgradesS: b.lap === null ? null : +b.lap.toFixed(2),
        wallFramesInLap: a.wall,
        maxSlipDeg: +a.maxSlipDeg.toFixed(0),
        longestJumpS: +a.air.toFixed(2),
        steerRate: spec.steerRate,
        grip: spec.grip,
        armor: spec.armor,
        mass: spec.mass,
        front: spec.front,
        rear: spec.rear,
      });
    }
    return { races, handling };
  });
  fs.writeFileSync(path.join(out, 'jogo.json'), JSON.stringify(result, null, 2));
}

/* ------------------------------------------------------------------ */
/* Som: renderização offline de efeitos, motor, músicas e uma mixagem  */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Picote do som (itens 47/50): corrida real com CPU 4x mais lenta,     */
/* grava a saída do master e mede buracos/descontinuidades              */
/* ------------------------------------------------------------------ */
async function picote() {
  const dir = path.join(out, 'som');
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const SEG = +(process.env.PICOTE_S ?? 20) || 20;
  const casos = [
    { nome: 'normal_cpu4x', leve: false },
    { nome: 'leve_cpu4x', leve: true },
  ];
  const resultados = [];
  for (const caso of casos) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(`${base}?autopilot&laps=3&q=baixo`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => !!window.game, null, { timeout: 180000 });
    await wait(2500);
    await page.evaluate(async (leve) => {
      const m = await window.devModules();
      m.setAudioLite?.(leve);
      // tarefas longas da thread principal durante a medição
      window.__longtasks = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__longtasks.push(Math.round(e.duration));
        }).observe({ type: 'longtask', buffered: false });
      } catch {
        /* sem suporte */
      }
      window.game.menuActions().quickRace({ trackId: 'chem6-1', vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
    }, caso.leve);
    await page.waitForFunction(() => window.game.phase === 'racing', null, { timeout: 180000, polling: 250 });
    // grava a saída do master com um AudioWorklet (mono) e mede, a cada bloco de 128 amostras, o
    // atraso do render em relação ao relógio de parede: se a thread de áudio atrasa, o relógio do
    // áudio fica para trás de uma vez (salto do atraso) — é o buraco que se ouve como picote
    await page.evaluate(async () => {
      const m = await window.devModules();
      const a = m.audio();
      const master = m.audioOutputForTest();
      const src = `class Tap extends AudioWorkletProcessor {
        constructor() { super(); this.chunk = new Float32Array(sampleRate / 2); this.n = 0; this.w0 = -1; this.frames = 0; this.hi = -1e9; this.saltos = []; this.on = true;
          this.port.onmessage = () => { this.on = false; this.port.postMessage({ fim: true, saltos: this.saltos }); }; }
        process(inputs) {
          if (!this.on) return false;
          const now = Date.now();
          if (this.w0 < 0) this.w0 = now;
          const lag = (now - this.w0) - (this.frames / sampleRate) * 1000;
          if (this.frames > sampleRate && lag > this.hi + 2) this.saltos.push(+(lag - this.hi).toFixed(1));
          if (lag > this.hi) this.hi = lag;
          const ch = inputs[0] && inputs[0][0];
          const ch2 = inputs[0] && inputs[0][1];
          for (let i = 0; i < 128; i++) {
            this.chunk[this.n++] = ch ? (ch2 ? (ch[i] + ch2[i]) / 2 : ch[i]) : 0;
            if (this.n === this.chunk.length) { this.port.postMessage(this.chunk); this.chunk = new Float32Array(sampleRate / 2); this.n = 0; }
          }
          this.frames += 128;
          return true;
        }
      }
      registerProcessor('tap-picote', Tap);`;
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      await a.ctx.audioWorklet.addModule(url);
      const tap = new AudioWorkletNode(a.ctx, 'tap-picote', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      master.connect(tap);
      window.__tap = { node: tap, chunks: [], saltos: null };
      tap.port.onmessage = (e) => {
        if (e.data && e.data.fim) window.__tap.saltos = e.data.saltos;
        else window.__tap.chunks.push(e.data);
      };
      window.__playout0 = a.ctx.playoutStats ? { ...a.ctx.playoutStats.toJSON?.() } : null;
      window.__longtasks.length = 0;
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await wait(SEG * 1000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const r = await page.evaluate(async () => {
      const m = await window.devModules();
      const a = m.audio();
      const t = window.__tap;
      t.node.port.postMessage('fim');
      for (let k = 0; k < 50 && !t.saltos; k++) await new Promise((res) => setTimeout(res, 100));
      const sr = a.ctx.sampleRate;
      const n = t.chunks.reduce((s, c) => s + c.length, 0);
      const x = new Float32Array(n);
      let o = 0;
      for (const c of t.chunks) {
        x.set(c, o);
        o += c.length;
      }
      // buracos no sinal: trechos de silêncio digital (|x| < 1e-5) >= 2 ms com som dos dois lados
      const minRun = Math.round(sr * 0.002);
      const buracos = [];
      let run = 0;
      for (let i = 0; i < n; i++) {
        if (Math.abs(x[i]) < 1e-5) run++;
        else {
          if (run >= minRun && i - run > 0) {
            const antes = Math.abs(x[i - run - 1]);
            if (antes > 1e-3 || Math.abs(x[i]) > 1e-3) buracos.push(+((run / sr) * 1000).toFixed(1));
          }
          run = 0;
        }
      }
      // descontinuidades: salto de amostra muito maior que a variação local (estalo)
      let desc = 0;
      const W = 64;
      for (let i = W + 1; i < n - W; i += 1) {
        const d = Math.abs(x[i] - x[i - 1]);
        if (d < 0.15) continue;
        let s = 0;
        for (let j = i - W; j < i + W; j++) if (j !== i) s += Math.abs(x[j] - x[j - 1]);
        if (d > 8 * (s / (2 * W - 1))) {
          desc++;
          i += W;
        }
      }
      let pico = 0;
      for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(x[i]));
      // WAV 16 bits mono para ouvir
      const wav = new DataView(new ArrayBuffer(44 + n * 2));
      const ws = (p, s) => [...s].forEach((ch, i) => wav.setUint8(p + i, ch.charCodeAt(0)));
      ws(0, 'RIFF');
      wav.setUint32(4, 36 + n * 2, true);
      ws(8, 'WAVEfmt ');
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true);
      wav.setUint16(22, 1, true);
      wav.setUint32(24, sr, true);
      wav.setUint32(28, sr * 2, true);
      wav.setUint16(32, 2, true);
      wav.setUint16(34, 16, true);
      ws(36, 'data');
      wav.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
      const bytes = new Uint8Array(wav.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const lt = window.__longtasks;
      const ps = a.ctx.playoutStats?.toJSON?.() ?? null;
      const saltos = t.saltos ?? [];
      return {
        segundosGravados: +(n / sr).toFixed(1),
        sampleRate: sr,
        baseLatencyMs: +((a.ctx.baseLatency ?? 0) * 1000).toFixed(1),
        outputLatencyMs: +((a.ctx.outputLatency ?? 0) * 1000).toFixed(1),
        audioLeve: m.isAudioLite(),
        buracosSinalMaior2ms: buracos.length,
        buracosSinalMs: buracos.slice(0, 30),
        descontinuidades: desc,
        atrasosRenderMaior2ms: saltos.length,
        atrasosRenderMaior10ms: saltos.filter((s) => s > 10).length,
        atrasosRenderMs: saltos.slice(0, 30),
        picoDbfs: +(20 * Math.log10(pico || 1e-9)).toFixed(2),
        longtasks: { total: lt.length, maiorMs: lt.length ? Math.max(...lt) : 0, somaMs: lt.reduce((s, v) => s + v, 0) },
        playoutStats: ps,
        playoutInicio: window.__playout0,
        wav: btoa(bin),
      };
    });
    const { wav, ...met } = r;
    fs.writeFileSync(path.join(dir, `picote_${caso.nome}.wav`), Buffer.from(wav, 'base64'));
    const res = { caso: caso.nome, cpuLentidao: 4, ...met };
    console.log('picote', JSON.stringify(res));
    resultados.push(res);
  }
  fs.writeFileSync(
    path.join(dir, 'picote.json'),
    JSON.stringify(
      {
        observacao:
          'Corrida real (chem6-1, autopiloto, q=baixo) com CPU 4x mais lenta (CDP Emulation.setCPUThrottlingRate). A saída do master é gravada por um ' +
          'AudioWorklet. buracosSinal = silêncio digital >= 2 ms no meio do som; descontinuidades = saltos de amostra ~8x maiores que a variação local; ' +
          'atrasosRender = saltos (> 2 ms) do atraso do relógio de áudio em relação ao relógio de parede (a thread de áudio não entregou a tempo: buraco na saída); ' +
          'playoutStats = contadores do Chrome (fallbackFrames = amostras que o dispositivo tocou em silêncio), quando disponíveis.',
        casos: resultados,
      },
      null,
      2,
    ),
  );
  await freshPage();
}

async function som() {
  const dir = path.join(out, 'som');
  fs.mkdirSync(dir, { recursive: true });
  const clips = await page.evaluate(async () => {
    const m = await window.devModules();
    const ctxMod = m, sfx = m;
    const { EngineSound, SONGS, SynthRock } = m;
    const SR = 44100;

    async function render(seconds, setup, stepEvery = 0.025) {
      const c = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
      await ctxMod.useAudioContextForTest(c);
      const a = ctxMod.audio();
      const tick = await setup(c, a);
      if (tick) {
        for (let t = stepEvery; t < seconds; t += stepEvery) {
          c.suspend(t).then(() => {
            tick(t);
            c.resume();
          });
        }
      }
      const buf = await c.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const mono = new Float32Array(L.length);
      for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
      return { mono, L, R };
    }

    function analyse(name, { mono, L, R }) {
      let peak = 0, sum = 0, clipped = 0;
      for (let i = 0; i < L.length; i++) {
        const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        peak = Math.max(peak, p);
        if (p >= 0.999) clipped++;
        sum += mono[i] * mono[i];
      }
      const rms = Math.sqrt(sum / mono.length);
      const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
      // espectrograma (FFT 1024, eixo de frequência logarítmico 30 Hz..16 kHz)
      const N = 1024, hop = 512, cols = Math.max(1, Math.floor((mono.length - N) / hop));
      const W = Math.min(900, cols), H = 256;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H + 20;
      const g = cv.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H + 20);
      const img = g.createImageData(W, H);
      const re = new Float32Array(N), im = new Float32Array(N);
      let centroidSum = 0, centroidN = 0;
      for (let x = 0; x < W; x++) {
        const start = Math.floor((x / W) * cols) * hop;
        for (let i = 0; i < N; i++) {
          re[i] = (mono[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
          im[i] = 0;
        }
        // FFT radix-2
        for (let i = 1, j = 0; i < N; i++) {
          let bit = N >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
        }
        for (let len = 2; len <= N; len <<= 1) {
          const ang = (-2 * Math.PI) / len;
          for (let i = 0; i < N; i += len) {
            for (let k = 0; k < len / 2; k++) {
              const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
              const ur = re[i + k], ui = im[i + k];
              const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
              const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
              re[i + k] = ur + vr; im[i + k] = ui + vi;
              re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            }
          }
        }
        let num = 0, den = 0;
        for (let b = 1; b < N / 2; b++) {
          const m = Math.hypot(re[b], im[b]);
          num += m * (b * SR) / N; den += m;
        }
        if (den > 1e-3) { centroidSum += num / den; centroidN++; }
        for (let y = 0; y < H; y++) {
          const f = 30 * Math.pow(16000 / 30, 1 - y / H);
          const b = Math.min(N / 2 - 1, Math.round((f * N) / SR));
          const mag = Math.hypot(re[b], im[b]) / (N / 4);
          const v = Math.max(0, Math.min(1, (20 * Math.log10(mag + 1e-9) + 90) / 90));
          const o = (y * W + x) * 4;
          img.data[o] = Math.round(255 * Math.min(1, v * 1.8));
          img.data[o + 1] = Math.round(255 * Math.max(0, v * 1.6 - 0.5));
          img.data[o + 2] = Math.round(255 * Math.max(0, v * 2 - 1.3) + 60 * v);
          img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      g.fillStyle = '#fff'; g.font = '12px sans-serif';
      g.fillText(`${name} — ${(mono.length / SR).toFixed(1)} s — eixo vertical: 30 Hz (base) a 16 kHz (topo), log`, 4, H + 14);
      // waveform em WAV 16 bits estéreo
      const n = L.length;
      const bufW = new ArrayBuffer(44 + n * 4);
      const v = new DataView(bufW);
      const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SR, true);
      v.setUint32(28, SR * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) {
        v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
        v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
      }
      let bin = '';
      const bytes = new Uint8Array(bufW);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return {
        name,
        seconds: +(mono.length / SR).toFixed(2),
        peakDb: db(peak),
        rmsDb: db(rms),
        crestDb: (20 * Math.log10(peak / (rms || 1e-9))).toFixed(1),
        clippedSamples: clipped,
        spectralCentroidHz: centroidN ? Math.round(centroidSum / centroidN) : 0,
        png: cv.toDataURL('image/png'),
        wav: btoa(bin),
      };
    }

    const res = [];
    // efeitos isolados
    const one = {
      laser: () => sfx.sfxLaser(1),
      missil: () => sfx.sfxMissile(1),
      explosao_grande: () => sfx.sfxExplosion(1, true),
      explosao_pequena: () => sfx.sfxExplosion(1, false),
      impacto: () => sfx.sfxHit(1),
      mina_solta: () => sfx.sfxDrop(1, 'mine'),
      oleo_solto: () => sfx.sfxDrop(1, 'oil'),
      batida_mureta: () => sfx.sfxWall(1),
      pouso_salto: () => sfx.sfxLand(1),
      rodada_oleo: () => sfx.sfxSkid(1),
      contagem_bipe: () => sfx.sfxCountdown(false),
      contagem_vai: () => sfx.sfxCountdown(true),
      volta_final: () => sfx.sfxLap(true),
      dinheiro: () => sfx.sfxPickup('money'),
      blindagem: () => sfx.sfxPickup('armor'),
      batida: () => sfx.sfxBump(1),
      sundog: () => sfx.sfxSundog(1),
      scatterpack_solto: () => sfx.sfxDrop(1, 'scatter'),
      nitro: () => sfx.sfxAssist('nitro', 1),
      jump_jets: () => sfx.sfxAssist('jump', 1),
      queda_da_pista: () => sfx.sfxFall(1),
      lava: () => sfx.sfxBurn(1),
    };
    for (const [name, fn] of Object.entries(one)) {
      res.push(analyse(`efeito_${name}`, await render(2, async () => { fn(); })));
    }
    // motor: marcha lenta 1 s, acelera até o máximo em 4 s, nitro 1,5 s, solta 2 s derrapando no início
    const engineProfile = (t) =>
      t < 1 ? { s: 0, th: 0, b: false } : t < 5 ? { s: (t - 1) / 4, th: 1, b: false } : t < 6.5 ? { s: 1.15, th: 1, b: true } : { s: Math.max(0, 1.15 - (t - 6.5) * 0.4), th: 0, b: false };
    res.push(analyse('motor_aceleracao', await render(8.5, async () => {
      const e = new EngineSound();
      e.start();
      return (t) => { const p = engineProfile(t); e.update(p.s, p.th, p.b, t > 6.5 && t < 7.7 ? 0.8 : 0); };
    })));
    // locutor: falas montadas como no original (nome + frase), gravadas por TTS neural
    const ann = new m.Announcer();
    const loadAnn = async () => {
      ann.ensureLoaded();
      await ann.loading;
    };
    for (const [nome, key, who] of [['largada', 'start', null], ['viper_jams_into_first', 'jamsFirst', 'Viper Mackay'], ['snake_gets_hammered', 'hammered', 'snake'], ['butcher_about_to_blow', 'aboutToBlow', 'Butcher Icebone'], ['holy_toledo', 'holyToledo', null]]) {
      res.push(analyse(`locutor_${nome}`, await render(3.5, async () => {
        await loadAnn();
        ann.busyUntil = 0;
        ann.lastSpoke = -Infinity;
        ann.say(key, who, 3);
      })));
    }
    // músicas: 20 s de cada
    for (const song of SONGS) {
      res.push(analyse(`musica_${song.name.replace(/\W+/g, '_')}`, await render(20, async (c, a) => {
        const s = new SynthRock(c, a.music);
        s.play(song);
        return () => s.schedule();
      }, 0.05)));
    }
    // mixagem de corrida: música + motor + tiros/explosões/pickups, como numa corrida real
    res.push(analyse('mix_corrida', await render(12, async (c, a) => {
      const s = new SynthRock(c, a.music);
      a.music.gain.value = 0.7;
      s.play(SONGS[0]);
      const e = new EngineSound();
      e.start();
      const events = [[0.3, () => sfx.sfxCountdown(false)], [1.3, () => sfx.sfxCountdown(true)], [2, () => sfx.sfxLaser(1, -0.3)], [2.3, () => sfx.sfxLaser(1, -0.3)], [3.5, () => sfx.sfxMissile(1, 0.4)], [4.2, () => sfx.sfxExplosion(0.8, false, 0.5)],
        [5.5, () => sfx.sfxPickup('money')], [6.2, () => sfx.sfxLand(0.8)], [7, () => sfx.sfxBump(0.8, -0.5)], [7.6, () => sfx.sfxWall(0.7, 0.6)], [8.5, () => sfx.sfxExplosion(1, true, 0.2)], [10, () => sfx.sfxDrop(0.9, 'mine')], [10.8, () => sfx.sfxHit(0.9, -0.2)]];
      let next = 0;
      return (t) => {
        s.schedule();
        const p = engineProfile(Math.min(t, 6));
        e.update(p.s, p.th, p.b);
        while (next < events.length && events[next][0] <= t) events[next++][1]();
      };
    }, 0.025)));
    // mixagem de corrida com a música do jogador (pasta music/), nivelada como no jogo
    const files = m.bundledTracks();
    if (files.length) {
      const track = files.find((f) => !/peter/i.test(f.name)) ?? files[0];
      res.push(analyse('mix_corrida_musica_usuario', await render(12, async (c, a) => {
        const ab = await (await fetch(track.url)).arrayBuffer();
        const buf = await c.decodeAudioData(ab);
        // mesmo nivelamento do jogo: RMS-alvo 0.2 com ganho entre 0.4 e 4
        const d = buf.getChannelData(0), off = Math.floor(40 * buf.sampleRate);
        let sum = 0, n = 0;
        for (let i = off; i < Math.min(d.length, off + buf.sampleRate * 12); i++) { sum += d[i] * d[i]; n++; }
        const rms = Math.sqrt(sum / Math.max(1, n));
        const lvl = Math.min(4, Math.max(0.4, 0.2 / (rms || 0.2)));
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = lvl * 0.7 * 1; // volume do jogador 0.7, humor "corrida"
        src.connect(g);
        g.connect(a.music);
        src.start(0, 40);
        await loadAnn();
        const e = new EngineSound();
        e.start();
        const events = [[1.3, () => sfx.sfxCountdown(true)], [1.5, () => { ann.busyUntil = 0; ann.say('start', null, 3); }], [4, () => sfx.sfxLaser(1, -0.3)], [4.3, () => sfx.sfxLaser(1, -0.3)], [5.2, () => sfx.sfxMissile(1, 0.4)], [5.9, () => sfx.sfxExplosion(0.9, true, 0.3)], [7.4, () => { ann.busyUntil = 0; ann.say('lightsUp', 'snake', 3); }], [9.5, () => sfx.sfxAssist('nitro', 1)], [10.5, () => sfx.sfxBump(0.8, -0.5)]];
        let next = 0;
        return (t) => {
          const p = engineProfile(Math.min(t, 6));
          e.update(p.s, p.th, t > 9.5 && t < 11);
          while (next < events.length && events[next][0] <= t) events[next++][1]();
        };
      }, 0.025)));
    }
    return res;
  });
  const metrics = [];
  for (const c of clips) {
    fs.writeFileSync(path.join(dir, `${c.name}.wav`), Buffer.from(c.wav, 'base64'));
    fs.writeFileSync(path.join(dir, `${c.name}.png`), Buffer.from(c.png.split(',')[1], 'base64'));
    const { png, wav, ...m } = c;
    metrics.push(m);
  }
  fs.writeFileSync(path.join(dir, 'metricas.json'), JSON.stringify(metrics, null, 2));
}

/* ------------------------------------------------------------------ */
/* Desempenho: fps médio e p95 por nível de qualidade, escala final da   */
/* resolução dinâmica e quantos quadros a cena desenha atrás de menus    */
/* ------------------------------------------------------------------ */
async function desempenho() {
  const cdp = await page.context().newCDPSession(page);
  // AMOSTRAS=n (padrão 3): baixo/medio/alto medidos n vezes intercalados (a CPU da máquina oscila) e
  // resumidos pela mediana; os casos de CPU lenta rodam uma vez só
  const amostras = Math.max(1, +(process.env.AMOSTRAS ?? 3) || 1);
  const casos = [
    { nome: 'baixo_cpu4x', q: 'baixo', cpu: 4 },
    { nome: 'baixo_cpu4x_semlimite30', q: 'baixo', cpu: 4, extra: '&semlimite' },
  ];
  for (let k = 0; k < amostras; k++) for (const q of ['baixo', 'medio', 'alto']) casos.push({ nome: q, q, cpu: 1 });
  /** Conta as chamadas de desenho do jogo (game.render) por `ms` e mede o intervalo entre elas. */
  const medir = (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const g = window.game;
          const orig = g.render;
          const t = [];
          g.render = function (...a) {
            t.push(performance.now());
            return orig.apply(this, a);
          };
          setTimeout(() => {
            g.render = orig;
            const iv = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
            const seg = t.length > 1 ? (t[t.length - 1] - t[0]) / 1000 : ms / 1000;
            const p95 = iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] : 0;
            resolve({
              quadros: t.length,
              fpsMedio: +(Math.max(0, t.length - 1) / seg).toFixed(1),
              quadroP95ms: +p95.toFixed(1),
              fpsP95: p95 ? +(1000 / p95).toFixed(1) : 0,
            });
          }, ms);
        }),
      ms,
    );
  const niveis = [];
  // tela de celular deitado / notebook simples (a 1280x720 o render por software mal passa de 2 qps)
  await page.setViewportSize({ width: 960, height: 540 });
  for (const c of casos) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.goto(`${base}?autopilot&laps=3&q=${c.q}${c.extra ?? ''}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => !!window.game, null, { timeout: 180000 });
    await wait(2500);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
    const menu = await medir(4000);
    await page.evaluate(() => {
      const g = window.game;
      // a URL ?q= desliga a resolução dinâmica; aqui ela fica ligada para ver até onde desce
      g.dynRes.enabled = true;
      g.menuActions().quickRace({ trackId: 'chem6-1', vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
    });
    await page.waitForFunction(() => window.game.phase === 'racing', null, { timeout: 180000, polling: 250 });
    await wait(3000);
    const corrida = await medir(15000);
    const estado = await page.evaluate(() => {
      const g = window.game;
      return { escalaResolucao: +g.dynRes.scale.toFixed(2), pixelRatio: +g.renderer.getPixelRatio().toFixed(2), trava30: g.cap30 };
    });
    await page.evaluate(() => window.game.togglePause());
    await wait(2500);
    const pausa = await medir(4000);
    await page.evaluate(() => window.game.togglePause());
    const r = { nivel: c.nome, cpuLentidao: c.cpu, corrida, ...estado, menuQps: menu.fpsMedio, pausaQuadros: pausa.quadros };
    console.log('desempenho', JSON.stringify(r));
    niveis.push(r);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // limite dos menus: numa tela minúscula o render por software passa de 30 qps; compara os
  // quadros do navegador (rAF) com os que o jogo desenha atrás do menu principal
  await page.setViewportSize({ width: 320, height: 180 });
  await page.goto(`${base}?autopilot&q=baixo`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.game, null, { timeout: 180000 });
  await wait(3000);
  const rafMenu = page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => {
          n++;
          if (performance.now() - t0 < 4000) requestAnimationFrame(f);
          else resolve(+((n * 1000) / (performance.now() - t0)).toFixed(1));
        };
        requestAnimationFrame(f);
      }),
  );
  const desenhoMenu = await medir(4000);
  const limiteMenus = { tela: '320x180', navegadorQps: await rafMenu, desenhoQps: desenhoMenu.fpsMedio };
  console.log('limite dos menus', JSON.stringify(limiteMenus));
  await page.setViewportSize({ width: 1280, height: 720 });
  const json = {
    observacao:
      'Render por software (SwiftShader, sem GPU): valores absolutos são muito menores que num aparelho real; servem para comparar níveis. ' +
      'fpsP95 = qps do quadro no percentil 95 do tempo de quadro (os 5% mais lentos). menuQps = quadros desenhados por segundo atrás do menu principal (limite ~30). ' +
      'pausaQuadros = quadros desenhados em 4 s de pausa (esperado 0: imagem congelada). trava30 = nível baixo travou a corrida em 30 qps.',
    pista: 'chem6-1',
    tela: '960x540',
    amostras,
    mediana: Object.fromEntries(
      ['baixo', 'medio', 'alto'].map((q) => {
        const rs = niveis.filter((n) => n.nivel === q);
        const med = (f) => {
          const v = rs.map(f).sort((a, b) => a - b);
          return v.length ? v[Math.floor((v.length - 1) / 2)] : 0;
        };
        return [q, { fpsMedio: med((n) => n.corrida.fpsMedio), quadroP95ms: med((n) => n.corrida.quadroP95ms), menuQps: med((n) => n.menuQps), amostras: rs.map((n) => n.corrida.fpsMedio) }];
      }),
    ),
    niveis,
    limiteMenus,
  };
  fs.writeFileSync(path.join(out, 'desempenho.json'), JSON.stringify(json, null, 2));
  await freshPage();
}

// partes separadas por vírgula (ex.: "jogo,telas"); "tudo" = todas
const parts = new Set(what.split(',').map((w) => w.trim()));
const want = (...names) => parts.has('tudo') || names.some((n) => parts.has(n));
try {
  if (want('desempenho')) await desempenho();
  if (want('jogo')) await jogo();
  if (want('som', 'picote')) await picote();
  if (want('som')) await som();
  // a etapa de som troca o AudioContext da página por um OfflineAudioContext: recarregar antes das telas
  if (want('som', 'picote') && want('telas', 'ui', 'celular')) await freshPage();
  if (want('telas')) await telas();
  if (want('telas', 'ui')) await ui();
  if (want('telas', 'ui', 'celular')) await celular();
} finally {
  fs.writeFileSync(path.join(out, 'erros.txt'), errors.join('\n') || 'sem erros');
  console.log('evidências em', out, '| erros de página:', errors.length);
  await browser.close();
}
