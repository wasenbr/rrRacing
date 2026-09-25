// Gera evidências para os avaliadores: capturas de tela, teste de jogo automático e gravações de som.
// Uso: node scripts/evidencias.mjs <pastaSaida> [partes] [url]  — partes separadas por vírgula (ex.: jogo,telas): tudo|telas|ui|celular|jogo|som|picote|desempenho  (som inclui picote; telas inclui ui e celular)
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
    // a largada só vale depois do preparo da GPU (shaders do planeta/câmera novos); antes disso a
    // tela ainda não foi desenhada pela contagem (no render por software isso passa de 1,5 s)
    await page.waitForFunction(() => !window.game.preparing, null, { timeout: 60000 }).catch(() => {});
    const n = String(i).padStart(2, '0');
    await page.screenshot({ path: `${dir}/${n}a_${trackId}_${cam}_largada.png` });
    await advance(12);
    await page.screenshot({ path: `${dir}/${n}b_${trackId}_${cam}_corrida.png` });
    await advance(9);
    await page.screenshot({ path: `${dir}/${n}c_${trackId}_${cam}_corrida.png` });
    i++;
  }
  // elementos de pista do mapa original (saltos, vãos, setas de warp, poças): o piloto automático
  // corre até a casa pedida e a tela é tirada ali
  const features = [
    ['nho-3', 7, 'chase', 'saltos'],
    ['newmojave-3', 18, 'iso', 'seta_salto'],
    ['inferno-5', 12, 'iso', 'warps_lava'],
    ['bogmire-1', 6, 'iso', 'poca'],
    ['inferno-1', 7, 'chase', 'salto'],
    // cruzamento no mesmo nível (placa X xadrez, sem mureta atravessando), viaduto e desvios (placa em T)
    ['nho-2', 13, 'iso', 'cruzamento_x'],
    ['bogmire-5', 8, 'iso', 'viaduto'],
    ['bogmire-2', 16, 'iso', 'desvio_laco'],
    ['inferno-4', 18, 'iso', 'desvio_atalho'],
  ];
  // saltos (itens 22 e 35; rodada 12): o carro corre de verdade até a rampa J e a tela é tirada,
  // com a prova congelada, na decolagem, no ápice e no pouso (vista iso acompanhando). Altura e distância de cada salto vão para
  // 40_saltos.json. As pistas com "Gv" pousam um nível abaixo da decolagem.
  const jumps = [
    ['nho-3', 7],
    ['newmojave-3', 19],
    ['inferno-1', 7],
    ['nho-7', 28],
    ['inferno-7', 31],
  ];
  const saltos = [];
  for (const [trackId, j] of jumps) {
    await page.evaluate((trackId) => {
      const a = window.game.menuActions();
      a.setCamera('iso');
      a.quickRace({ trackId, vehicleId: 'havac', color: 0x2f7bff, difficulty: 'normal' });
    }, trackId);
    await wait(1500);
    await page.waitForFunction(() => !window.game.preparing, null, { timeout: 60000 }).catch(() => {});
    // corrida de verdade: a contagem corre até o "VAI!" e o piloto automático (?autopilot) leva o
    // carro pela pista até a casa antes da rampa J, embalado (sem teletransporte nem carro parado)
    const pronto = await page.evaluate((j) => {
      const g = window.game;
      const w = g.world;
      const tr = w.track;
      const n = tr.loop ?? tr.pieces.length;
      const c = w.racers[g.playerId].car;
      for (let k = 0; k < 60 * 12 && g.phase !== 'racing'; k++) g.step(1 / 60);
      // a partir da 2ª volta (já embalado desde a largada, mesmo quando o J fica logo depois dela)
      const me = w.racers[g.playerId];
      for (let k = 0; k < 60 * 240; k++) {
        g.step(1 / 60);
        if (me.progress.lap >= 2 && c.pieceIndex === (j - 1 + n) % n && c.grounded) return { ok: true, v: Math.hypot(c.vx, c.vz) };
      }
      return { ok: false };
    }, j);
    if (!pronto.ok) errors.push(`salto ${trackId}: o carro não chegou à rampa ${j}`);
    const res = { pista: trackId, casaJ: j, ok: false };
    for (const fase of ['decolagem', 'apice', 'pouso']) {
      // avança até o momento pedido e congela a prova (fase 'paused' sem o menu de pausa)
      const r = await page.evaluate(([j, fase, prev]) => {
        const g = window.game;
        const w = g.world;
        const tr = w.track;
        const n = tr.loop ?? tr.pieces.length;
        const c = w.racers[g.playerId].car;
        g.phase = 'racing';
        w.started = true;
        let gEnd = (j + 1) % n;
        while (tr.pieces[(gEnd + 1) % n].code === 'G') gEnd = (gEnd + 1) % n;
        const gapStart = tr.pieces[(j + 1) % n].startDist;
        const gapEnd = tr.pieces[gEnd].startDist + tr.pieces[gEnd].length;
        const info = prev ?? {};
        let ok = false;
        for (let k = 0; k < 60 * 10; k++) {
          const wasAir = !c.grounded;
          const J = tr.pieces[j];
          const onJ = c.pieceIndex === j;
          g.step(1 / 60);
          if (c.fell) return { ...info, erro: `caiu no vão (${fase})` };
          if (fase === 'decolagem') {
            if (onJ && !c.grounded) {
              Object.assign(info, { x0: c.x, z0: c.z, hRampa: tr.heightOn(J, J.length * 0.97), yMax: c.y, velocidade: Math.hypot(c.vx, c.vz) });
              ok = true;
            }
          } else {
            if (!c.grounded) info.yMax = Math.max(info.yMax ?? c.y, c.y);
            if (fase === 'apice') {
              // ápice: a velocidade vertical passa de subindo para descendo, ainda no ar
              if (!c.grounded && c.vy <= 0) ok = true;
            } else if (wasAir && c.grounded) {
              const land = tr.query(c.x, c.z, c.pieceIndex);
              Object.assign(info, { x1: c.x, z1: c.z, hPouso: land.height, casaPouso: land.pieceIndex, depoisDoVaoM: land.dist - gapEnd });
              ok = true;
            }
          }
          if (ok) break;
        }
        if (!ok) return { ...info, erro: `momento não alcançado: ${fase}` };
        g.phase = 'paused';
        g.hud.clearMessage(); // sem "VAI!"/contagem na tela
        g.rig.snap();
        g.redraw = true;
        return info;
      }, [j, fase, res.dados ?? null]);
      res.dados = r;
      if (r.erro) {
        // sem PNG de um momento que não aconteceu (a captura mostraria outra coisa)
        res.erro = r.erro;
        errors.push(`salto ${trackId} casa ${j}: ${r.erro}`);
        break;
      }
      await wait(900);
      await page.screenshot({ path: `${dir}/40_${trackId}_salto_${fase}_iso.png` });
    }
    const d = res.dados ?? {};
    if (!res.erro && d.x1 !== undefined) {
      res.ok = true;
      res.distanciaM = +Math.hypot(d.x1 - d.x0, d.z1 - d.z0).toFixed(1);
      res.alturaMaxSobreRampaM = +(d.yMax - d.hRampa).toFixed(2);
      res.quedaNoPousoM = +(d.hRampa - d.hPouso).toFixed(2);
      res.pousoDepoisDoVaoM = +d.depoisDoVaoM.toFixed(1);
      res.velocidadeDecolagemMs = +d.velocidade.toFixed(1);
      res.casaPouso = d.casaPouso;
    }
    delete res.dados;
    saltos.push(res);
    await page.evaluate(() => { window.game.phase = 'racing'; });
  }
  fs.writeFileSync(`${dir}/40_saltos.json`, JSON.stringify(saltos, null, 2));
  for (const [trackId, piece, cam, tag] of features) {
    await page.evaluate(([trackId, cam]) => {
      const a = window.game.menuActions();
      a.setCamera(cam);
      a.quickRace({ trackId, vehicleId: 'havac', color: 0x2f7bff, difficulty: 'normal' });
    }, [trackId, cam]);
    await wait(1500);
    await page.waitForFunction(() => !window.game.preparing, null, { timeout: 60000 }).catch(() => {});
    const ok = await page.evaluate((piece) => {
      const g = window.game;
      const me = g.world.racers[g.playerId];
      for (let k = 0; k < 60 * 90; k++) {
        g.step(1 / 60);
        if (k > 60 * 5 && me.car.pieceIndex === piece) return true;
      }
      return false;
    }, piece);
    await wait(900);
    await page.screenshot({ path: `${dir}/40_${trackId}_${tag}_${cam}.png` });
    if (!ok) console.log('elemento de pista não alcançado:', trackId, piece);
  }
  await page.evaluate(() => window.game.menuActions().setCamera('iso'));

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

  // chegada (item 62): o 1º colocado (CPU) cruza, freia e estaciona escurecido na beira; a tela é
  // tirada quando ele está parado até 25 m à frente da câmera (que segue o jogador, piloto automático
  // um pouco mais lento de propósito). O laço não para quando o jogador cruza: a vaga do 1º fica a 42 m
  // da linha, e o jogador passa por ela depois de terminar (rodada 10: a captura falhava por isso).
  // As vagas são medidas antes de congelar o jogador; toasts, avisos e efeitos (fumaça, explosões,
  // marcas) são limpos antes da captura. Repetida em três pistas (Chem VI, Nho e Bogmire).
  for (const [trackId, tag] of [['chem6-1', '52'], ['nho-3', '52b'], ['bogmire-5', '52c']]) {
    const base52 = tag === '52' ? '52_chegada' : `${tag}_chegada_${trackId.replace('-', '')}`;
    await page.evaluate((id) => {
      const a = window.game.menuActions();
      a.setCamera('iso');
      a.quickRace({ trackId: id, vehicleId: 'marauder', color: 0x2f7bff, difficulty: 'normal' });
    }, trackId);
    await wait(1500);
    await page.waitForFunction(() => !window.game.preparing, null, { timeout: 60000 }).catch(() => {});
    const chegada = await page.evaluate(() => {
      const g = window.game;
      const w = g.world;
      const me = w.racers[g.playerId];
      me.spec = { ...me.spec, maxSpeed: me.spec.maxSpeed * 0.85 };
      let k = 0;
      for (; k < 60 * 400 && !w.racers.some((r) => r.finishPlace); k++) g.step(1 / 60);
      const first = w.racers.find((r) => r.finishPlace === 1);
      if (!first || first.id === g.playerId) return { ok: false, motivo: 'jogador venceu ou ninguém cruzou' };
      const T = w.track.totalLength;
      const vagas = () =>
        w.racers
          .filter((r) => r.finishPlace)
          .sort((a, b) => a.finishPlace - b.finishPlace)
          .map((r) => {
            const q = w.track.query(r.car.x, r.car.z, r.car.pieceIndex);
            return { lugar: r.finishPlace, jogador: r.id === g.playerId, parado: Math.hypot(r.car.vx, r.car.vz) < 0.3, lateral: +q.lateral.toFixed(2), meiaLargura: w.track.halfWidth, beira: +(w.track.halfWidth - Math.abs(q.lateral)).toFixed(2) };
          });
      // espera o 1º parar e ficar à frente do jogador (câmera), mesmo depois de o jogador cruzar
      let menor = Infinity;
      for (let j = 0; j < 60 * 60; j++) {
        g.step(1 / 60);
        const parado = Math.hypot(first.car.vx, first.car.vz) < 0.3;
        const df = w.track.query(first.car.x, first.car.z, first.car.pieceIndex).dist;
        const dm = w.track.query(me.car.x, me.car.z, me.car.pieceIndex).dist;
        let gap = (((df - dm) % T) + T) % T;
        if (gap > T / 2) gap -= T;
        if (parado) menor = Math.min(menor, Math.abs(gap));
        // (entre 3 e 15 m: longe da borda da tela, bem dentro dos 25 m pedidos)
        if (parado && gap > 3 && gap < 15) {
          // vagas medidas antes de congelar o jogador (senão ele aparecia "parado" sem ter estacionado)
          const terminados = vagas();
          // congela o jogador ali (o render por software é lento: a tela sai alguns quadros depois)
          me.car.vx = me.car.vz = 0;
          me.spec = { ...me.spec, accel: 0, maxSpeed: 0.01, nitroAccel: 0 };
          return { ok: true, distanciaJogador: +gap.toFixed(1), jogadorTerminou: !!me.finishPlace, terminados };
        }
      }
      return { ok: false, motivo: `o 1º não ficou parado até 25 m à frente da câmera (mais perto: ${menor.toFixed(1)} m)`, terminados: vagas() };
    });
    chegada.pista = trackId;
    fs.writeFileSync(`${dir}/${base52}.json`, JSON.stringify(chegada, null, 2));
    const png = `${dir}/${tag === '52' ? '52_chegada_iso' : base52}.png`;
    if (chegada.ok) {
      await wait(900);
      // sem toasts/avisos por cima e sem fumaça/explosões/marcas de corridas anteriores
      await page.evaluate(() => {
        const g = window.game;
        g.hud.clearMessage?.();
        for (const el of [g.hud.toast, g.hud.note]) el?.classList.remove('show');
        g.hud.toastTimer = 0;
        g.hud.noteTimer = 0;
        g.effects.reset?.();
        g.redraw = true;
      });
      await frames(2);
      await page.screenshot({ path: png });
    } else {
      // sem a cena certa não salva a imagem (uma tela errada passaria por evidência)
      fs.rmSync(png, { force: true });
      errors.push(`captura da chegada (${tag}, ${trackId}): ${chegada.motivo}`);
      console.log('captura da chegada:', trackId, chegada.motivo);
    }
  }

  // close dos carros: vitrine com os 5 modelos lado a lado (se o jogo expuser a função)
  const hasShowroom = await page.evaluate(() => typeof window.game.showroom === 'function');
  if (hasShowroom) {
    for (const [k, angle] of [['frente', 0.6], ['tras', 3.6]]) {
      await page.evaluate((a) => window.game.showroom(a), angle);
      await wait(1500);
      await page.screenshot({ path: `${dir}/20_vitrine_${k}.png` });
    }
    // cada carro sozinho, em 3/4 de frente como nas referências: o Air Blade pelo lado direito
    // (referencias/modernizados/air-blade.png), os outros pelo esquerdo (tank.webp)
    for (const id of ['dirtdevil', 'marauder', 'airblade', 'battletrak', 'havac']) {
      await page.evaluate(([a, c]) => window.game.showroom(a, c), [id === 'airblade' ? -0.8 : 0.8, id]);
      await wait(1500);
      await page.screenshot({ path: `${dir}/21_carro_${id}.png` });
    }
    // nitro aceso (22): cada carro sozinho na vitrine em 3/4 de trás, com as chamas do turbo
    for (const id of ['dirtdevil', 'marauder', 'airblade', 'battletrak', 'havac']) {
      await page.evaluate(([a, c]) => window.game.showroom(a, c, true), [id === 'airblade' ? -2.5 : 2.5, id]);
      await wait(1500);
      await page.screenshot({ path: `${dir}/22_nitro_${id}_vitrine.png` });
    }
  }
  // nitro na corrida (22): cada carro como jogador na vista iso, com nitroTime > 0 na hora da tela
  const nitro = [];
  for (const id of ['dirtdevil', 'marauder', 'airblade', 'battletrak', 'havac']) {
    await page.evaluate((id) => {
      const a = window.game.menuActions();
      a.setCamera('iso');
      a.quickRace({ trackId: 'chem6-1', vehicleId: id, color: 0x2f7bff, difficulty: 'normal' });
    }, id);
    await wait(1500);
    await page.waitForFunction(() => !window.game.preparing, null, { timeout: 60000 }).catch(() => {});
    await advance(6);
    const r = await page.evaluate(() => {
      const g = window.game;
      const c = g.world.racers[g.playerId].car;
      c.nitroTime = 5;
      g.step(1 / 60);
      return { nitroTime: +c.nitroTime.toFixed(2) };
    });
    await wait(900);
    const t = await page.evaluate(() => +window.game.world.racers[window.game.playerId].car.nitroTime.toFixed(2));
    await page.screenshot({ path: `${dir}/22_nitro_${id}_iso.png` });
    nitro.push({ carro: id, nitroTimeAntes: r.nitroTime, nitroTimeNaTela: t });
  }
  fs.writeFileSync(`${dir}/22_nitro.json`, JSON.stringify(nitro, null, 2));
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
    await page.waitForFunction(() => !document.querySelector('img.car-img.loading, img.planet-img.loading'), null, { timeout: 90000 }).catch(() => {});
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
  // animações CSS congeladas em tempos fixos (ms): as capturas saem iguais em qualquer máquina
  const freezeAt = async (ms) => {
    await page.evaluate((t) => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t; }), ms);
    await wait(300);
  };
  const waitImgs = () => page.waitForFunction(() => !document.querySelector('img.loading[data-thumb]'), null, { timeout: 90000 }).catch(() => {});
  // campanha simulada no Difícil até o título (compras gananciosas, quase sempre no pódio, vence os
  // duelos): o final, os resultados e as garagens abaixo saem com números reais. A campanha recém-criada
  // fica guardada e volta antes da loja.
  await page.evaluate(async () => {
    const m = await window.devModules();
    const g = window.game;
    const c0 = g.campaign;
    window.__camp0 = c0;
    const s = m.newCampaign(c0.characterId, c0.color, 'hard');
    const order = ['dirtdevil', 'marauder', 'airblade', 'battletrak', 'havac'];
    const parts = ['engine', 'tires', 'shocks', 'armor'];
    const places = [1, 2, 1, 1, 3, 1];
    const snaps = {};
    for (let i = 0; !s.champion && i < 600; i++) {
      for (;;) {
        const next = order[order.indexOf(s.car.vehicleId) + 1];
        if (next && m.carsForSale(s).includes(next)) {
          const cost = m.carSwapCost(s.car, next);
          if (cost > s.money) break;
          s.money -= cost;
          s.car = m.newCarSetup(next);
          continue;
        }
        const k = parts.find((k) => {
          const p = s.car.upgrades[k] < m.shopLevel(s) ? m.upgradePrice(s.car, k) : null;
          return p !== null && p <= s.money;
        });
        if (!k) break;
        s.money -= m.upgradePrice(s.car, k);
        s.car.upgrades[k]++;
      }
      const kind = m.raceKind(s);
      const before = structuredClone(s);
      const place = kind === 'normal' ? places[i % places.length] : 1;
      const pista = Math.round(4000 * m.moneyScale(s));
      const kills = 1 + (i % 3);
      const r = m.applyRaceResult(s, place, m.prizesFor(before)[place - 1] + pista, kills);
      const snap = { before, after: structuredClone(s), r, place, pista, kills };
      if (r.outcome === 'promoted' && before.planet === 1 && before.division === 0) snaps.promoted = snap;
      if (kind === 'boss' && before.planet === 2) snaps.boss = snap;
      if (kind === 'boss' && before.planet === 4) snaps.nho = before;
      if (kind === 'boss' && before.planet === 5) snaps.inferno = before;
    }
    delete s.finalePending;
    window.__camp = s;
    window.__snaps = snaps;
  });
  // viagem para o planeta seguinte (item 59): início, carro voando e chegada com as novidades
  await page.evaluate(async () => {
    const m = await window.devModules();
    const c0 = window.__camp0;
    const at = { ...m.newCampaign(c0.characterId, c0.color, 'hard'), planet: 2 };
    at.car = m.newCarSetup('airblade');
    window.game.menus.showPlanetWarp({ from: m.PLANETS[1], to: m.PLANETS[2], planets: 6, vehicleId: 'airblade', color: c0.color, news: m.planetNews(at, m.VEHICLES) });
    document.getAnimations().forEach((a) => a.pause());
  });
  await waitImgs();
  for (const [name, ms] of [['33c_viagem_planeta_inicio', 450], ['33d_viagem_planeta_meio', 1350], ['33e_viagem_planeta_fim', 4200]]) {
    await freezeAt(ms);
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  // final da campanha (item 58): holofotes e troféu, pódio (chefe final no 2, Rip e Shred no 3), rota
  // acendendo e créditos. Pausa já na abertura: as miniaturas demoram mais que os créditos no render
  // por software
  await page.evaluate(() => {
    window.game.campaign = window.__camp;
    window.game.menus.showChampion(window.game.hubData());
    document.getAnimations().forEach((a) => a.pause());
  });
  await waitImgs();
  for (const [name, ms] of [['33f_campeao_inicio', 1100], ['33f_campeao_meio', 3600], ['33f_campeao_fim', 9000]]) {
    await freezeAt(ms);
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  // toque pula para o resumo (estatísticas e nova campanha na próxima dificuldade)
  // (os créditos no fim da animação já podem ter aberto o resumo sozinhos)
  await page.evaluate(() => document.querySelector('.finale')?.click());
  await wait(600);
  await shot('33f_campeao_resumo');
  // resultados da campanha simulada: PROMOVIDO (Drakonis B → A), chefe derrotado com promoção
  // (Bogmire) e repescagem (duelo perdido em Nho A com os pontos faltando). Cada tela sai de uma
  // corrida real simulada (o mundo headless, 3 voltas, com os rivais e o carro do jogador daquele
  // ponto da campanha): tempos, voltas, abates e dinheiro coerentes. A habilidade do piloto
  // automático do jogador varia até ele terminar na colocação pedida.
  const results = async (name, key) => {
    const info = await page.evaluate(async (k) => {
      const m = await window.devModules();
      const c0 = window.__camp0;
      let before = structuredClone(k === 'playoff' ? window.__snaps.nho : window.__snaps[k].before);
      let want = k === 'playoff' ? 2 : window.__snaps[k].place;
      if (k === 'playoff') before.points = m.promoteGoal(before) - 400;
      const me = m.CHARACTERS.find((ch) => ch.id === c0.characterId);
      const track = new m.Track(m.trackById(m.currentTrackId(before)));
      const opp = m.opponentsFor(before, m.VEHICLES);
      const spec = m.playerSpec(before, m.VEHICLES);
      const skills = want === 1 ? [0.97, 0.95, 0.92] : want === 2 ? [0.8, 0.85, 0.75, 0.9] : [0.7, 0.65, 0.75, 0.6];
      let w = null;
      let tries = 0;
      for (let seed = 1; seed <= 6 && !w; seed++) {
        for (const skill of skills) {
          tries++;
          const entries = [...opp.map((o) => ({ name: o.name, color: o.color, spec: o.spec, ai: o.ai })), { name: me.name, color: before.color, spec, ai: { skill, aggression: 0.8, lane: 0.5 } }];
          const world = m.createWorld(track, entries, 3, seed, m.prizesFor(before), m.difficultyOf(before), m.moneyScale(before));
          world.started = true;
          for (let i = 0; i < 60 * 900 && world.racers.some((r) => !r.finishPlace); i++) m.stepWorld(world, {}, 1 / 60);
          const pl = world.racers[entries.length - 1];
          if (pl.finishPlace === want) {
            w = world;
            break;
          }
        }
      }
      if (!w) return { ok: false, motivo: `o jogador não terminou em ${want}º em ${tries} corridas simuladas` };
      const pid = w.racers.length - 1;
      const p = w.racers[pid];
      const after = structuredClone(before);
      // como na chegada do jogo (settleFinish): colocação, dinheiro da corrida (prêmio + pista) e abates
      const r = m.applyRaceResult(after, p.finishPlace, p.money, p.kills);
      const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;
      const rows = w.racers.map((x) => ({
        place: x.finishPlace || x.place, name: x.id === pid ? me.name : x.name, color: hex(x.color), time: x.finishPlace ? x.progress.finishTime : null,
        kills: x.kills, prize: w.prizes[(x.finishPlace || x.place) - 1] ?? 0, money: x.money, me: x.id === pid, pilot: x.id === pid ? me.id : x.name, vehicleId: x.spec.id,
      }));
      const report = {
        outcome: r.outcome, kind: r.kind, pointsEarned: r.pointsEarned, points: after.points, promote: m.promoteGoal(before),
        label: `${m.PLANETS[after.planet].name} — Divisão ${m.DIVISIONS[after.division]}`, boss: m.PLANETS[before.planet].local, bonus: r.bonus,
        playoffLeft: r.playoffLeft, planets: m.planetCount(after), moneyCapped: m.moneyCapped(after),
      };
      window.game.menus.showResults(rows, p.progress.lapTimes, report, false);
      return { ok: true, pista: m.currentTrackId(before), tentativas: tries, lugar: p.finishPlace, tempos: rows.map((x) => [x.name, x.time && +x.time.toFixed(2)]), voltas: p.progress.lapTimes.map((t) => +t.toFixed(2)), dinheiro: p.money, abates: p.kills, bonus: r.bonus, desfecho: r.outcome };
    }, key);
    fs.writeFileSync(`${dir}/${name}.json`, JSON.stringify(info, null, 2));
    if (info.ok) await shot(name);
    else {
      fs.rmSync(`${dir}/${name}.png`, { force: true });
      errors.push(`resultado ${name}: ${info.motivo}`);
    }
  };
  await results('33g_resultado_promovido', 'promoted');
  await results('33h_resultado_chefe_derrotado', 'boss');
  await results('33i_resultado_repescagem', 'playoff');
  // garagens com o selo CHEFE (duelo final da Divisão A) em Nho A e no Inferno A, e em repescagem
  const hubAt = async (name, make) => {
    await page.evaluate(async (k) => {
      const m = await window.devModules();
      let st = structuredClone(k === 'inferno' ? window.__snaps.inferno : window.__snaps.nho);
      if (k === 'playoff') {
        st.points = m.promoteGoal(st) - 400;
        m.applyRaceResult(st, 2, 0, 0);
      }
      window.game.campaign = st;
      window.game.menuActions().backToHub();
    }, make);
    await wait(2500);
    await shot(name);
  };
  await hubAt('33j_garagem_nho_a_chefe', 'nho');
  await hubAt('33k_garagem_inferno_a_chefe', 'inferno');
  await hubAt('33l_garagem_repescagem', 'playoff');
  await page.evaluate(() => { window.game.campaign = window.__camp0; });
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
  // item 60 no celular: corrida rápida, garagem e loja em 844x390, com a medida de rolagem do menu
  const medidas = {};
  const mclick = async (sel) => {
    await m.waitForSelector(sel, { timeout: 60000 });
    await m.evaluate((q) => setTimeout(() => document.querySelector(q).click(), 0), sel);
    await m.waitForTimeout(1500);
  };
  const mshot = async (name) => {
    await m.waitForFunction(() => !document.querySelector('img.loading[data-thumb]'), null, { timeout: 90000 }).catch(() => {});
    await m.waitForTimeout(300);
    medidas[name] = await m.evaluate(() => {
      const o = document.querySelector('.overlay');
      if (!o) return null;
      const res = { scrollHeight: o.scrollHeight, clientHeight: o.clientHeight, rola: o.scrollHeight > o.clientHeight };
      // loja: o 1º item (melhoria ou arma) aparece inteiro na 1ª tela
      const item = document.querySelector('.shop-body > .shop-row, .weapon-card');
      if (item) res.item1Fundo = Math.round(item.getBoundingClientRect().bottom);
      // loja: tamanho do carro ao lado das barras (≤ 72 px no celular deitado)
      const shopCar = document.querySelector('.shop-car-img .car-img');
      if (shopCar) res.lojaCarro = Math.round(shopCar.getBoundingClientRect().width);
      // corrida rápida: colunas da grade de carros e linhas da faixa de pilotos
      const cars = [...document.querySelectorAll('.quick .cars .car')].map((e) => e.getBoundingClientRect());
      if (cars.length) {
        res.carrosColunas = cars.filter((c) => Math.round(c.top) === Math.round(cars[0].top)).length;
        res.carroAltura = Math.round(cars[0].height);
      }
      const chars = [...document.querySelectorAll('.quick .char-pick .char')].map((e) => Math.round(e.getBoundingClientRect().top));
      if (chars.length) res.pilotosLinhas = new Set(chars).size;
      // miniaturas de planeta sem imagem nem fundo (círculo vazio)
      res.planetasVazios = [...document.querySelectorAll('img.planet-img')].filter((e) => !e.style.background && e.src.startsWith('data:image/gif')).length;
      // vão entre o painel e o botão flutuante de tela cheia
      const fs = document.querySelector('.fs-float');
      const card = document.querySelector('.overlay .card');
      if (fs && card && fs.offsetParent) res.vaoTelaCheia = Math.round(fs.getBoundingClientRect().left - card.getBoundingClientRect().right);
      // corrida rápida: nomes dos pilotos inteiros (sem reticências) e o escolhido por extenso
      const plates = [...document.querySelectorAll('.quick .char .nameplate span')];
      if (plates.length) {
        res.pilotosVisiveis = plates.length;
        res.nomesCortados = plates.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
        const nm = document.querySelector('.quick .cf-name');
        res.nomeEscolhido = nm && nm.getBoundingClientRect().height > 0 ? nm.textContent : null;
      }
      return res;
    });
    await m.screenshot({ path: `${dir}/${name}.png`, timeout: 120000 });
  };
  await mclick('button[data-act="quick"]');
  await mshot('46_celular_corrida_rapida');
  const qr = medidas['46_celular_corrida_rapida'];
  if (qr?.nomesCortados?.length) errors.push(`[celular] corrida rápida com nomes cortados: ${qr.nomesCortados.join(', ')}`);
  await m.evaluate(() => window.game.menuActions().toMain());
  await m.waitForTimeout(800);
  await mclick('button[data-act="new"]');
  await mclick('button[data-act="new-start"]');
  await mshot('47_celular_garagem');
  // a garagem cabe inteira no celular deitado: nem 1 px de rolagem
  const gar = medidas['47_celular_garagem'];
  if (gar && gar.scrollHeight > gar.clientHeight) errors.push(`[celular] garagem rola: ${gar.scrollHeight} > ${gar.clientHeight}`);
  await mclick('button[data-act="shop"]');
  await mshot('48_celular_loja_melhorias');
  if ((medidas['48_celular_loja_melhorias']?.item1Fundo ?? 0) > 390) errors.push('[celular] loja: 1º item fora da 1ª tela');
  await mclick('button[data-tab="weapons"]');
  await mshot('49_celular_loja_armas');
  await m.evaluate(() => window.game.menuActions().toMain());
  await m.waitForTimeout(800);
  // item 55: vão entre o volante e a fileira de armas, e tamanhos dos controles (px CSS)
  const medeToque = () =>
    m.evaluate(() => {
      const r = (q) => document.querySelector(q)?.getBoundingClientRect();
      const steer = r('.touch .steer');
      const acts = [...document.querySelectorAll('.touch-actions button')].map((b) => b.getBoundingClientRect());
      if (!steer || !acts.length) return null;
      const fire2 = r('.touch-right .fire2');
      const gas = r('.touch-right .gas');
      return {
        tela: `${innerWidth}x${innerHeight}`,
        vaoVolanteArmas: Math.round(steer.top - Math.max(...acts.map((a) => a.bottom))),
        // vão real: descontando a área de toque invisível do volante (::before) que sobe acima do desenho
        vaoRealToque: Math.round(steer.top + Math.min(0, parseFloat(getComputedStyle(document.querySelector('.touch .steer'), '::before').top) || 0) - Math.max(...acts.map((a) => a.bottom))),
        botaoTelaCheia: document.querySelector('.touch .fs-help') ? 'passo a passo iOS' : document.querySelector('.touch [data-ui="fullscreen"]') ? 'tela cheia' : 'nenhum',
        volante: `${Math.round(steer.width)}x${Math.round(steer.height)}`,
        tiro: Math.round(r('.touch-actions .fire').width),
        tiroDireita: fire2 ? Math.round(fire2.width) : 0,
        vaoTiroAcel: fire2 && gas ? Math.round(gas.top - fire2.bottom) : null,
      };
    });
  await m.evaluate(() => window.game.menuActions().quickRace({ trackId: 'chem6-1', vehicleId: 'marauder', color: 0xe02828, difficulty: 'normal' }));
  await m.waitForTimeout(1200);
  await m.evaluate(() => {
    const g = window.game;
    for (let k = 0; k < 60 * 8; k++) g.step(1 / 60);
  });
  await m.waitForTimeout(900);
  await m.screenshot({ path: `${dir}/42_celular_corrida_controles.png`, timeout: 120000 });
  medidas.toque844 = await medeToque();
  if ((medidas.toque844?.vaoRealToque ?? 99) < 32) errors.push(`[celular] área de toque do volante a ${medidas.toque844.vaoRealToque} px das armas (mínimo 32)`);
  if ((medidas.toque844?.vaoTiroAcel ?? 99) < 16) errors.push(`[celular] TIRO–ACEL a ${medidas.toque844.vaoTiroAcel} px (mínimo 16)`);
  // iPhone SE / 8 deitado
  await m.setViewportSize({ width: 667, height: 375 });
  await m.waitForTimeout(900);
  medidas.toque667 = await medeToque();
  if ((medidas.toque667?.vaoTiroAcel ?? 99) < 16) errors.push(`[celular] 667: TIRO–ACEL a ${medidas.toque667.vaoTiroAcel} px (mínimo 16)`);
  await m.screenshot({ path: `${dir}/42b_celular_667_controles.png`, timeout: 120000 });
  await m.setViewportSize({ width: 844, height: 390 });
  await m.waitForTimeout(600);
  fs.writeFileSync(`${dir}/celular_medidas.json`, JSON.stringify(medidas, null, 2));
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
    const { TRACKS, VEHICLES, Track, createWorld, stepWorld, PRIZES, forwardSpeed, referenceInput, raceDistance } = await window.devModules();
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
      // o carro gira por pista (índice % 5): todos os modelos em todos os planetas (rodada 10)
      const car = ids[TRACKS.indexOf(def) % ids.length];
      const entries = profiles.map((ai, i) => ({ name: `CPU${i}`, color: 0xffffff, spec: VEHICLES[car], ai }));
      const w = createWorld(track, entries, 4, 1234, PRIZES);
      w.started = true;
      // leadChanges: só trocas em que o novo líder fica na frente por 2 s ou mais (leadChangesRaw: todas)
      const stats = { fires: 0, hits: 0, explosions: 0, bumps: 0, pickups: 0, spins: 0, leadChanges: 0, leadChangesRaw: 0, placeChanges: 0, respawns: 0, hitsByKind: {}, firesByKind: {}, dropsByKind: {}, mineTargeted: 0, mineTargetedHits: 0 };
      let leader = -1;
      let rawLeader = -1;
      let cand = -1;
      let candSince = 0;
      // minas: o perseguidor visado (o mais próximo atrás, até 25 m) levou a mina nos 3 s seguintes?
      const mineWatch = [];
      const lastPlace = w.racers.map((r) => r.place);
      let t = 0;
      let wallTime = 0;
      let stuck = 0;
      const speeds = [];
      while (w.finishedCount < 4 && t < 600) {
        const before = new Set(w.hazards.map((h) => h.id));
        stepWorld(w, {}, dt);
        t += dt;
        for (const e of w.events) {
          if (e.type === 'drop' && e.kind === 'mine') {
            const me = w.racers[e.racer];
            const dm = raceDistance(w, me);
            let f = -1;
            let best = 25;
            for (const o of w.racers) {
              if (o === me || o.finishPlace) continue;
              const g = dm - raceDistance(w, o);
              if (g > 0 && g < best) { best = g; f = o.id; }
            }
            const h = w.hazards.find((x) => !before.has(x.id) && x.kind === 'mine');
            if (f >= 0 && h) { stats.mineTargeted++; mineWatch.push({ hid: h.id, f, t, owner: e.racer }); }
          }
          if (e.type === 'hit' && e.kind === 'mine') {
            const k = mineWatch.findIndex((x) => x.f === e.target && x.owner === e.by && t - x.t < 3);
            if (k >= 0) { stats.mineTargetedHits++; mineWatch.splice(k, 1); }
          }
          if (e.type === 'fire') {
            stats.fires++;
            stats.firesByKind[e.kind] = (stats.firesByKind[e.kind] ?? 0) + 1;
          }
          if (e.type === 'hit') {
            stats.hits++;
            stats.hitsByKind[e.kind] = (stats.hitsByKind[e.kind] ?? 0) + 1;
          }
          if (e.type === 'drop') stats.dropsByKind[e.kind] = (stats.dropsByKind[e.kind] ?? 0) + 1;
          if (e.type === 'explode') stats.explosions++;
          if (e.type === 'bump') stats.bumps++;
          if (e.type === 'pickup') stats.pickups++;
          if (e.type === 'spin') stats.spins++;
          if (e.type === 'respawn') stats.respawns++;
        }
        const ld = w.racers.find((r) => r.place === 1).id;
        if (ld !== rawLeader) {
          if (rawLeader !== -1) stats.leadChangesRaw++;
          rawLeader = ld;
        }
        if (ld !== cand) { cand = ld; candSince = t; }
        if (cand !== leader && t - candSince >= 2) {
          if (leader !== -1) stats.leadChanges++;
          leader = cand;
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
    // 3) taxa de acerto por arma da frente (todas as corridas acima): acertos / disparos
    const hitRate = {};
    for (const k of ['laser', 'missile', 'sundog']) {
      const fires = races.reduce((s, r) => s + (r.firesByKind[k] ?? 0), 0);
      const hits = races.reduce((s, r) => s + (r.hitsByKind[k] ?? 0), 0);
      hitRate[k] = { fires, hits, rate: fires ? +(hits / fires).toFixed(2) : null };
    }

    // 4) corridas mistas: um carro de cada modelo, mesma CPU (habilidade/agressividade iguais), 3 voltas,
    //    2 sementes por pista; registra vitórias e colocação média por carro (equilíbrio entre modelos)
    const mixed = { races: 0, wins: {}, avgPlace: {} };
    const placeSum = {};
    for (const def of TRACKS)
      for (const seed of [3, 9]) {
        const track = new Track(def);
        // a ordem do grid gira com a semente, para ninguém largar sempre na frente
        const order = ids.map((_, i) => ids[(i + seed) % ids.length]);
        const entries = order.map((id, i) => ({ name: id, color: 0xffffff, spec: VEHICLES[id], ai: { skill: 0.8, aggression: 0.6, lane: [-1.5, -0.5, 0.5, 1.5, 0, -1, 1][i % 7] } }));
        const w = createWorld(track, entries, 3, seed, PRIZES);
        w.started = true;
        for (let k = 0; k < 60 * 600 && w.finishedCount < entries.length; k++) stepWorld(w, {}, dt);
        mixed.races++;
        for (const r of w.racers) {
          if (r.finishPlace === 1) mixed.wins[r.name] = (mixed.wins[r.name] ?? 0) + 1;
          placeSum[r.name] = (placeSum[r.name] ?? 0) + (r.finishPlace || entries.length);
        }
      }
    for (const id of ids) {
      mixed.wins[id] = mixed.wins[id] ?? 0;
      mixed.avgPlace[id] = +(placeSum[id] / mixed.races).toFixed(2);
    }
    // 3b) armas de trás: acertos por carga (mina) e fração dos leques do scatter que acertam alguém
    //     (o scatter acerta no máximo uma vez cada carro por leque)
    const rearRate = {};
    for (const k of ['mine', 'scatter', 'oil']) {
      const drops = races.reduce((s, r) => s + (r.dropsByKind[k] ?? 0), 0);
      const hits = races.reduce((s, r) => s + (k === 'oil' ? r.spins : r.hitsByKind[k] ?? 0), 0);
      rearRate[k] = { drops, hits, perCharge: drops ? +(hits / drops).toFixed(2) : null };
    }
    // mina no perseguidor visado (o mais próximo atrás, até 25 m, na hora de soltar): meta 30–40%
    {
      const targeted = races.reduce((s, r) => s + r.mineTargeted, 0);
      const hits = races.reduce((s, r) => s + r.mineTargetedHits, 0);
      rearRate.mine.targeted = targeted;
      rearRate.mine.targetedHits = hits;
      rearRate.mine.targetedRate = targeted ? +(hits / targeted).toFixed(2) : null;
    }
    const leadChangesPerRace = +(races.reduce((s, r) => s + r.leadChanges, 0) / races.length).toFixed(1);

    // 6) piloto de referência "humano" (referenceInput: centro da pista, acelera sempre, só DERRAPAR, sem
    //    tiro) largando em último contra os 3 rivais da campanha (opponentsFor), em cada divisão de cada
    //    dificuldade, 2 pistas do planeta; ele corre com o carro e as peças de Shred no Normal (um jogador
    //    que acompanha a loja). Metas (rodada 11): Normal ~30–45% de vitórias, Fácil mais, Difícil menos
    const { newCampaign, opponentsFor, currentPlanet, planetTracks, playerSpec, CAMPAIGN_RULES, rivalLevel, rivalEngine } = await window.devModules();
    const reference = {};
    for (const diff of ['easy', 'normal', 'hard']) {
      let wins = 0, placeSum = 0, gapSum = 0, n = 0;
      for (let t = 0; t < CAMPAIGN_RULES[diff].planets * 2; t++) {
        const s = newCampaign('jake', 0, diff);
        s.planet = t >> 1;
        s.division = t & 1;
        const car = newCarSetup(currentPlanet(s).cars[1]);
        const lv = rivalLevel(t, 1, 'normal');
        car.upgrades = { engine: rivalEngine(t, 1, 'normal'), tires: lv, shocks: lv, armor: lv };
        s.car = car;
        const ids2 = planetTracks(currentPlanet(s));
        for (let k = 0; k < 2; k++) {
          const def = TRACKS.find((d) => d.id === ids2[(k + t) % ids2.length]);
          const w = createWorld(new Track(def), [...opponentsFor(s, VEHICLES, diff), { name: 'REF', color: 0, spec: playerSpec(s, VEHICLES), ai: null }], def.laps ?? 4, 11 + k, PRIZES, diff);
          w.started = true;
          const me = w.racers[3];
          for (let tt = 0; w.finishedCount < 4 && tt < 400; tt += dt) stepWorld(w, { 3: referenceInput(w, me, dt) }, dt);
          const place = me.finishPlace || 4;
          const best = Math.min(...w.racers.filter((r) => r.ai && r.finishPlace).map((r) => r.progress.finishTime));
          if (place === 1) wins++;
          placeSum += place;
          if (me.finishPlace && Number.isFinite(best)) gapSum += me.progress.finishTime - best;
          n++;
        }
      }
      // gapToBestCpuS: chegada do piloto de referência menos a da melhor CPU (negativo = chegou antes)
      reference[diff] = { races: n, wins, winRate: +(wins / n).toFixed(2), avgPlace: +(placeSum / n).toFixed(2), gapToBestCpuS: +(gapSum / n).toFixed(1) };
    }
    return { races, hitRate, rearRate, leadChangesPerRace, reference, mixed, handling, drift };
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
    // thread de áudio sob carga: além dos 5 motores e da música da corrida, ~12 efeitos por segundo
    // (explosões, tiros, batidas, derrapagens) disparados durante a medição
    { nome: 'estresse_cpu4x', leve: false, estresse: true },
    // rodada 12 (Som): modo leve (celular) com CPU 6x mais lenta
    { nome: 'leve_cpu6x', leve: true, cpu: 6 },
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
      // tarefas longas da thread principal durante a medição: início (performance.now), duração,
      // fase do jogo e atribuição do navegador
      window.__longtasks = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries())
            window.__longtasks.push({ inicio: Math.round(e.startTime), ms: Math.round(e.duration), atribuicao: e.attribution?.[0]?.name ?? '' });
        }).observe({ type: 'longtask', buffered: false });
      } catch {
        /* sem suporte */
      }
      // linha do tempo das fases (a longtask é atribuída à fase em que começou)
      const g = window.game;
      const faseAgora = () => `${g.phase}${g.preparing ? ':preparando' : ''}`;
      window.__fases = [[performance.now(), faseAgora()]];
      window.__faseTimer = setInterval(() => {
        const f = faseAgora();
        if (window.__fases[window.__fases.length - 1][1] !== f) window.__fases.push([performance.now(), f]);
      }, 20);
      // tempo de step() e render() separados (performance.mark/measure + intervalos para cruzar
      // com as longtasks)
      window.__trechos = [];
      // chamadas lentas (render > 100 ms, step > 50 ms): programas/geometrias/texturas na GPU antes
      // e depois (o que subiu/compilou no engasgo) e o tempo de cada subetapa (game.prof)
      window.__lentos = [];
      g.prof = {};
      const gpuInfo = () => ({ programas: g.renderer.info.programs?.length ?? 0, geometrias: g.renderer.info.memory.geometries, texturas: g.renderer.info.memory.textures });
      const somaProf = () => Object.fromEntries(Object.entries(g.prof ?? {}).map(([k, e]) => [k, e.soma]));
      for (const nome of ['step', 'render']) {
        const orig = g[nome];
        g[nome] = function (...a) {
          const t0 = performance.now();
          const antes = gpuInfo();
          const p0 = somaProf();
          performance.mark(`rr-${nome}`);
          try {
            return orig.apply(this, a);
          } finally {
            performance.measure(`rr-${nome}`, `rr-${nome}`);
            const d = performance.now() - t0;
            window.__trechos.push([nome, t0, d]);
            if (d > (nome === 'render' ? 100 : 50)) {
              const sub = {};
              for (const [k, v] of Object.entries(somaProf())) if (v - (p0[k] ?? 0) > 0.5) sub[k] = +(v - (p0[k] ?? 0)).toFixed(1);
              window.__lentos.push({ nome, inicio: Math.round(t0), ms: +d.toFixed(1), fase: `${g.phase}${g.preparing ? ':preparando' : ''}`, antes, depois: gpuInfo(), subetapas: sub });
            }
          }
        };
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
          this.port.onmessage = () => { this.on = false; this.port.postMessage({ fim: true, saltos: this.saltos, saltosEm: this.saltosEm || [] }); }; }
        process(inputs) {
          if (!this.on) return false;
          const now = Date.now();
          if (this.w0 < 0) this.w0 = now;
          const lag = (now - this.w0) - (this.frames / sampleRate) * 1000;
          if (this.w1 === undefined) { this.w1 = now; this.port.postMessage({ inicio: now }); }
          if (this.frames > sampleRate && lag > this.hi + 2) { this.saltos.push(+(lag - this.hi).toFixed(1)); (this.saltosEm = this.saltosEm || []).push(this.frames); }
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
        if (e.data && e.data.fim) {
          window.__tap.saltos = e.data.saltos;
          window.__tap.saltosEm = e.data.saltosEm;
        } else if (e.data && e.data.inicio) window.__tap.inicio = e.data.inicio;
        else window.__tap.chunks.push(e.data);
      };
      window.__playout0 = a.ctx.playoutStats ? { ...a.ctx.playoutStats.toJSON?.() } : null;
      window.__longtasks.length = 0;
      window.__trechos.length = 0;
      window.__lentos.length = 0;
      window.game.prof = {};
      performance.clearMarks();
      performance.clearMeasures();
    });
    if (caso.estresse)
      await page.evaluate(async () => {
        const m = await window.devModules();
        const fx = [
          () => m.sfxExplosion(1, true, -0.5),
          () => m.sfxLaser(1, 0.3),
          () => m.sfxMissile(1, -0.2),
          () => m.sfxHit(1, 0.6),
          () => m.sfxBump(1, -0.6),
          () => m.sfxSkid(1, 0),
          () => m.sfxExplosion(0.8, false, 0.4),
          () => m.sfxWall(1, 0.1),
        ];
        let k = 0;
        window.__estresse = setInterval(() => {
          try {
            fx[k++ % fx.length]();
          } catch {
            /* efeito ausente nesta versão */
          }
        }, 80);
      });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: caso.cpu ?? 4 });
    await wait(SEG * 1000);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    if (caso.estresse) await page.evaluate(() => clearInterval(window.__estresse));
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
      // descontinuidades: salto de amostra muito maior que a variação local (estalo). Rodada 12: cada
      // uma com o tempo exato (s desde o início da gravação e performance.now) e o contexto
      let desc = 0;
      const descLista = [];
      const W = 64;
      for (let i = W + 1; i < n - W; i += 1) {
        const d = Math.abs(x[i] - x[i - 1]);
        if (d < 0.15) continue;
        let s = 0;
        for (let j = i - W; j < i + W; j++) if (j !== i) s += Math.abs(x[j] - x[j - 1]);
        if (d > 8 * (s / (2 * W - 1))) {
          desc++;
          descLista.push({ amostra: i, salto: +d.toFixed(3), variacaoLocal: +(s / (2 * W - 1)).toFixed(4), antes: +x[i - 1].toFixed(3), depois: +x[i].toFixed(3) });
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
      clearInterval(window.__faseTimer);
      const lt = window.__longtasks;
      const fases = window.__fases;
      const faseEm = (t) => {
        let f = fases[0][1];
        for (const [ft, nome] of fases) if (ft <= t) f = nome;
        return f;
      };
      const trechos = window.__trechos;
      // quanto de cada longtask foi step() e render() (sobreposição dos intervalos)
      const dentro = (ini, fim, nome) =>
        trechos.reduce((s, [n, t0, d]) => (n === nome ? s + Math.max(0, Math.min(fim, t0 + d) - Math.max(ini, t0)) : s), 0);
      const tarefas = lt
        .map((e) => ({ ...e, fase: faseEm(e.inicio), stepMs: Math.round(dentro(e.inicio, e.inicio + e.ms, 'step')), renderMs: Math.round(dentro(e.inicio, e.inicio + e.ms, 'render')) }))
        .sort((x, y) => y.ms - x.ms);
      // contexto de cada descontinuidade: fase do jogo, tarefa longa / step() / render() em curso
      // (±30 ms), salto do atraso de render mais próximo (±60 ms) e o que o locutor/efeitos faziam
      const perf0 = t.inicio ? t.inicio - performance.timeOrigin : null;
      const saltosEm = (t.saltosEm ?? []).map((fr, k) => ({ ms: (fr / sr) * 1000, salto: (t.saltos ?? [])[k] }));
      const descontinuidadesDetalhe = descLista.slice(0, 40).map((e) => {
        const seg = e.amostra / sr;
        const pn = perf0 === null ? null : perf0 + seg * 1000;
        const perto = (ini, dur, folga) => pn !== null && ini - folga <= pn && pn <= ini + dur + folga;
        const lt0 = pn === null ? null : lt.find((q) => perto(q.inicio, q.ms, 30));
        const tr0 = pn === null ? [] : trechos.filter(([, t0, d]) => perto(t0, d, 30)).map(([nm, t0, d]) => ({ nome: nm, inicioRel: Math.round(t0 - pn), ms: +d.toFixed(1) }));
        const at = saltosEm.find((q) => Math.abs(q.ms - seg * 1000) < 60);
        return {
          ...e,
          segundo: +seg.toFixed(4),
          perfNow: pn === null ? null : Math.round(pn),
          fase: pn === null ? null : faseEm(pn),
          longtask: lt0 ? { inicioRel: Math.round(lt0.inicio - pn), ms: lt0.ms } : null,
          trechos: tr0.slice(0, 4),
          atrasoRenderMs: at ? at.salto : null,
          nivelLocal_dBFS: +(20 * Math.log10(Math.max(1e-9, Math.max(...Array.from(x.subarray(Math.max(0, e.amostra - 480), e.amostra + 480), Math.abs))))).toFixed(1),
        };
      });
      const soma = (nome) => trechos.reduce((s, [n, , d]) => (n === nome ? s + d : s), 0);
      const conta = (nome) => trechos.filter(([n]) => n === nome).length;
      const maior = (nome) => trechos.reduce((s, [n, , d]) => (n === nome ? Math.max(s, d) : s), 0);
      const tempos = {
        step: { chamadas: conta('step'), somaMs: Math.round(soma('step')), maiorMs: +maior('step').toFixed(1) },
        render: { chamadas: conta('render'), somaMs: Math.round(soma('render')), maiorMs: +maior('render').toFixed(1) },
      };
      performance.clearMarks();
      performance.clearMeasures();
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
        descontinuidadesDetalhe,
        atrasosRenderMaior2ms: saltos.length,
        atrasosRenderMaior10ms: saltos.filter((s) => s > 10).length,
        atrasosRenderMs: saltos.slice(0, 30),
        picoDbfs: +(20 * Math.log10(pico || 1e-9)).toFixed(2),
        longtasks: {
          total: lt.length,
          maiorMs: lt.length ? Math.max(...lt.map((e) => e.ms)) : 0,
          somaMs: lt.reduce((s, e) => s + e.ms, 0),
          // as 15 maiores: início (performance.now), fase, e quanto foi step()/render()
          maiores: tarefas.slice(0, 15),
        },
        tempos,
        // render > 100 ms / step > 50 ms: GPU antes/depois e subetapas (atribuição dos engasgos)
        lentos: window.__lentos.slice().sort((x, y) => y.ms - x.ms).slice(0, 20),
        // subetapas de step()/render() na medição toda (ms somados, maior chamada, chamadas)
        subetapas: Object.fromEntries(Object.entries(window.game.prof ?? {}).map(([k, e]) => [k, { somaMs: Math.round(e.soma), maiorMs: +e.maior.toFixed(1), n: e.n }])),
        fases: fases.map(([t, f]) => [Math.round(t), f]),
        playoutStats: ps,
        playoutInicio: window.__playout0,
        wav: btoa(bin),
      };
    });
    const { wav, ...met } = r;
    fs.writeFileSync(path.join(dir, `picote_${caso.nome}.wav`), Buffer.from(wav, 'base64'));
    const res = { caso: caso.nome, cpuLentidao: caso.cpu ?? 4, ...met };
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
          'descontinuidadesDetalhe = cada uma com o segundo exato na gravação, performance.now, fase, tarefa longa/step()/render() em curso (±30 ms), ' +
          'salto do atraso de render próximo (±60 ms) e nível local; leve_cpu6x = modo leve (celular) com CPU 6x mais lenta; ' +
          'atrasosRender = saltos (> 2 ms) do atraso do relógio de áudio em relação ao relógio de parede (a thread de áudio não entregou a tempo: buraco na saída); ' +
          'playoutStats = contadores do Chrome (fallbackFrames = amostras que o dispositivo tocou em silêncio), quando disponíveis. ' +
          'longtasks.maiores = tarefas longas (inicio = performance.now), com a fase do jogo e os ms de step()/render() dentro delas; ' +
          'tempos = soma e maior duração de step() e render() na medição (performance.mark/measure rr-step e rr-render). ' +
          'lentos = render() > 100 ms e step() > 50 ms, com renderer.info (programas, geometrias, texturas) antes/depois e os ms de cada subetapa; ' +
          'subetapas = soma/maior de cada trecho de step() (entrada, stepWorld, onEvent, faiscas, commentary, sfx) e render() (carros, efeitos, hudSom, gpu).',
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
  const refWav = fs.readFileSync(new URL('./locutor/voz-referencia-arena.wav', import.meta.url)).toString('base64');
  // referência masculina de ringue (a voz que o locutor clona): os trechos GRITADOS dela são a meta
  const lutaWav = fs.readFileSync(new URL('./locutor/voz-referencia-luta.wav', import.meta.url)).toString('base64');
  const clips = await page.evaluate(async ({ refWavB64, lutaWavB64 }) => {
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
      let centroidSum = 0, centroidN = 0, eLow = 0, eAll = 0;
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
          eAll += m * m;
          if ((b * SR) / N < 120) eLow += m * m;
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
        energiaAbaixo120Hz_pct: eAll ? Math.round((100 * eLow) / eAll) : 0,
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
    const mixEvents = [[0.3, 'contagem', () => sfx.sfxCountdown(false)], [1.3, 'vai', () => sfx.sfxCountdown(true)], [2, 'plasma', () => sfx.sfxLaser(1, -0.3)], [2.3, 'plasma_2', () => sfx.sfxLaser(1, -0.3)], [3.5, 'missil', () => sfx.sfxMissile(1, 0.4)], [4.2, 'explosao_pequena', () => sfx.sfxExplosion(0.8, false, 0.5)],
      [5.5, 'dinheiro', () => sfx.sfxPickup('money')], [6.2, 'pouso', () => sfx.sfxLand(0.8)], [7, 'batida', () => sfx.sfxBump(0.8, -0.5)], [7.6, 'mureta', () => sfx.sfxWall(0.7, 0.6)], [8.5, 'explosao_grande', () => sfx.sfxExplosion(1, true, 0.2)], [10, 'mina', () => sfx.sfxDrop(0.9, 'mine')], [10.8, 'impacto', () => sfx.sfxHit(0.9, -0.2)]];
    // `music`/`engine`/`fx`: as mesmas 12 s só com a cama (música + motor) ou só com o motor, para
    // medir o destaque dos efeitos sobre a cama e sobre o motor (rodada 11)
    const mixCorrida = (music, engine, fx) => render(12, async (c, a) => {
      const s = new SynthRock(c, a.music);
      a.music.gain.value = music ? 0.7 : 0;
      s.play(SONGS[0]);
      const e = new EngineSound();
      if (engine) e.start();
      let next = 0;
      return (t) => {
        s.schedule();
        const p = engineProfile(Math.min(t, 6));
        if (engine) e.update(p.s, p.th, p.b);
        while (fx && next < mixEvents.length && mixEvents[next][0] <= t) mixEvents[next++][2]();
      };
    }, 0.025);
    const mixFull = await mixCorrida(true, true, true);
    res.push(analyse('mix_corrida', mixFull));
    // destaque dos efeitos (rodada 11): pico de 100 ms do efeito (0–0,4 s após o disparo) menos o RMS
    // da cama sem efeitos no mesmo trecho; e o mesmo acima de 200 Hz (alto-falante de celular/notebook
    // não reproduz o sub-grave) contra o motor sozinho. Metas: explosão ≥ +8 dB, batida/mureta ≥ +5 dB
    // sobre a cama; ≥ +6 dB acima de 200 Hz sobre o motor
    const hp200 = async (x) => {
      const c = new OfflineAudioContext(1, x.length, SR);
      const b = c.createBuffer(1, x.length, SR); b.copyToChannel(x, 0);
      const s = c.createBufferSource(); s.buffer = b; let node = s;
      for (let k = 0; k < 2; k++) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 200; node.connect(f); node = f; }
      node.connect(c.destination); s.start();
      return (await c.startRendering()).getChannelData(0);
    };
    const rmsDb = (x, a0, a1) => { let s = 0; const i0 = Math.floor(a0 * SR), i1 = Math.min(x.length, Math.floor(a1 * SR)); for (let i = i0; i < i1; i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12); };
    const peak100 = (x, a0, a1) => { let best = -120; for (let t0 = a0; t0 + 0.1 <= a1; t0 += 0.01) best = Math.max(best, rmsDb(x, t0, t0 + 0.1)); return best; };
    const contraste = async (full, bed, engineOnly, events) => {
      const fh = await hp200(full.mono), eh = engineOnly ? await hp200(engineOnly.mono) : null;
      const out = {};
      for (const [te, name] of events) {
        const o = { sobreCama_dB: +(peak100(full.mono, te, te + 0.4) - rmsDb(bed.mono, te, te + 0.4)).toFixed(1) };
        if (eh) o.acima200Hz_sobreMotor_dB = +(peak100(fh, te, te + 0.4) - rmsDb(eh, te, te + 0.4)).toFixed(1);
        out[name] = o;
      }
      return out;
    };
    const mixBed = await mixCorrida(true, true, false), mixEngine = await mixCorrida(false, true, false);
    const extraContraste = {
      mix_corrida: {
        camaRMS_dB: +rmsDb(mixBed.mono, 1, 12).toFixed(1),
        motorRMS_dB: +rmsDb(mixEngine.mono, 1, 12).toFixed(1),
        efeitos: await contraste(mixFull, mixBed, mixEngine, mixEvents.filter(([te]) => te >= 2)),
      },
      metas: { explosao_sobreCama_dB: 8, batida_mureta_sobreCama_dB: 5, acima200Hz_sobreMotor_dB: 6 },
      observacao: 'pico de 100 ms do efeito (0–0,4 s após o disparo) menos o RMS da mesma janela na gravação sem efeitos (cama = música + motor; motor = só o motor). A cama sem efeitos não tem o ducking: é o nível que o efeito precisa vencer.',
    };
    // mixagem de corrida com a música do jogador (pasta music/), nivelada como no jogo
    const files = m.bundledTracks();
    if (files.length) {
      const track = files.find((f) => !/peter/i.test(f.name)) ?? files[0];
      const userEvents = [[1.3, 'vai', () => sfx.sfxCountdown(true)], [1.5, 'locutor_largada', () => { ann.busyUntil = 0; ann.say('start', null, 3); }], [4, 'plasma', () => sfx.sfxLaser(1, -0.3)], [4.3, 'plasma_2', () => sfx.sfxLaser(1, -0.3)], [5.2, 'missil', () => sfx.sfxMissile(1, 0.4)], [5.9, 'explosao_grande', () => sfx.sfxExplosion(0.9, true, 0.3)], [7.4, 'locutor_lightsUp', () => { ann.busyUntil = 0; ann.say('lightsUp', 'snake', 3); }], [9.5, 'nitro', () => sfx.sfxAssist('nitro', 1)], [10.5, 'batida', () => sfx.sfxBump(0.8, -0.5)]];
      const mixUsuario = (fx) => render(12, async (c, a) => {
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
        let next = 0;
        return (t) => {
          const p = engineProfile(Math.min(t, 6));
          e.update(p.s, p.th, t > 9.5 && t < 11);
          while (fx && next < userEvents.length && userEvents[next][0] <= t) userEvents[next++][2]();
        };
      }, 0.025);
      const userFull = await mixUsuario(true);
      res.push(analyse('mix_corrida_musica_usuario', userFull));
      const userBed = await mixUsuario(false);
      extraContraste.mix_corrida_musica_usuario = {
        faixa: track.name,
        camaRMS_dB: +rmsDb(userBed.mono, 1, 12).toFixed(1),
        efeitos: await contraste(userFull, userBed, null, userEvents.filter(([, n]) => !n.startsWith('locutor'))),
      };
    }
    // ---- rodada 10 (Som 7) ----
    const extra = {};
    extra.contraste = extraContraste;
    // espectro médio (FFT 8192, Hann, 50%) e energia por banda (dB) de um trecho mono
    const spectrum = (x) => {
      const N = 8192, P = new Float64Array(N / 2);
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let st = 0; st + N <= x.length; st += N / 2) {
        for (let i = 0; i < N; i++) { re[i] = x[st + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); im[i] = 0; }
        for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; } }
        for (let len = 2; len <= N; len <<= 1) {
          const ang = (-2 * Math.PI) / len;
          for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
            const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a0 = i + k, b0 = a0 + len / 2;
            const vr = re[b0] * wr - im[b0] * wi, vi = re[b0] * wi + im[b0] * wr;
            re[b0] = re[a0] - vr; im[b0] = im[a0] - vi; re[a0] += vr; im[a0] += vi;
          }
        }
        for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
      }
      return { P, hz: SR / N, band: (lo, hi) => { let e = 0; for (let k = Math.ceil(lo / (SR / N)); k < Math.min(N / 2, hi / (SR / N)); k++) e += P[k]; return 10 * Math.log10(e + 1e-20); } };
    };
    // motor em regime (rodada 11, item 21): corpo abaixo de 100 Hz e agudos em relação aos médios
    // (300–1500 Hz) e periodicidade (autocorrelação normalizada máxima, lag 2,5–25 ms, janelas de
    // 100 ms: 1 = zumbido perfeitamente periódico)
    extra.motorTimbre = {};
    for (const [nome, sp, th, b] of [['lenta', 0, 0, false], ['corrida', 0.7, 1, false], ['alto_giro', 1, 1, false], ['nitro', 1.15, 1, true]]) {
      const clip = await render(3, async () => { const e = new EngineSound(); e.start(); return () => e.update(sp, th, b, 0); });
      const x = clip.mono.subarray(Math.floor(1.5 * SR));
      const S = spectrum(x), mid = S.band(300, 1500);
      let per = 0, nw = 0;
      for (let st = 0; st + 4410 + 1200 < x.length; st += 2205) {
        let e0 = 0; for (let i = 0; i < 4410; i++) e0 += x[st + i] * x[st + i];
        let best = 0;
        for (let L = 110; L < 1100; L++) { let s2 = 0, e1 = 0; for (let i = 0; i < 4410; i++) { s2 += x[st + i] * x[st + i + L]; e1 += x[st + i + L] * x[st + i + L]; } best = Math.max(best, s2 / Math.sqrt(e0 * e1 + 1e-20)); }
        per += best; nw++;
      }
      extra.motorTimbre[nome] = { rms_dB: +rmsDb(x, 0, x.length / SR).toFixed(1), abaixo100Hz_vs_medios_dB: +(S.band(20, 100) - mid).toFixed(1), de100a300Hz_vs_medios_dB: +(S.band(100, 300) - mid).toFixed(1), de1k5a5k_vs_medios_dB: +(S.band(1500, 5000) - mid).toFixed(1), periodicidade: +(per / Math.max(1, nw)).toFixed(2) };
    }
    // motor: varredura 0 → 100% em 8 s, pé embaixo, com e sem nitro (item 21 / nitro)
    const sweep = (nitro) => render(10, async () => {
      const e = new EngineSound();
      e.start();
      return (t) => { const s = Math.max(0, Math.min(1, (t - 1) / 8)); e.update(s * (nitro ? 1.15 : 1), t < 1 ? 0 : 1, nitro && t >= 1, 0); };
    });
    res.push(analyse('motor_varredura', await sweep(false)));
    res.push(analyse('motor_nitro', await sweep(true)));
    // final da campanha (item 58): o hino que showChampion toca (Music.playAnthem → anthemSource: a
    // faixa do menu/abertura do jogador ou a trilha sintetizada do menu) + fogos + multidão + locutor
    const anthem = m.anthemSource(m.bundledTracks());
    extra.finalCampanha = { musica: anthem.kind === 'file' ? 'faixa do jogador: ' + anthem.name : 'trilha sintetizada: ' + anthem.song.name };
    res.push(analyse('final_campanha', await render(14, async (c, a) => {
      await loadAnn();
      let s = null;
      if (anthem.kind === 'file') {
        const buf = await c.decodeAudioData(await (await fetch(anthem.url)).arrayBuffer());
        const d = buf.getChannelData(0);
        const n = Math.min(d.length, buf.sampleRate * 20);
        let sum = 0;
        for (let i = 0; i < n; i++) sum += d[i] * d[i];
        const rms = Math.sqrt(sum / Math.max(1, n));
        const src = c.createBufferSource();
        src.buffer = buf;
        const g = c.createGain();
        g.gain.value = Math.min(4, Math.max(0.4, 0.2 / (rms || 0.2))) * 0.7; // nivelamento do jogo, volume 0.7, humor "corrida"
        src.connect(g);
        g.connect(a.music);
        src.start(0);
      } else {
        s = new SynthRock(c, a.music);
        a.music.gain.value = 0.7;
        s.play(anthem.song);
      }
      const later = [];
      const show = sfx.finaleShow((sec, fn) => later.push([c.currentTime + sec, fn]));
      const cues = show.cues.map(([sec, fn]) => [0.9 + sec, fn]).sort((x, y) => x[0] - y[0]);
      const says = [[0.05, 'dominating', 'Viper Mackay'], [4.2, 'holyToledo', null]];
      return (t) => {
        s?.schedule();
        while (cues.length && cues[0][0] <= t) cues.shift()[1]();
        for (let i = later.length - 1; i >= 0; i--) if (later[i][0] <= t) later.splice(i, 1)[0][1]();
        while (says.length && says[0][0] <= t) { const [, k, who] = says.shift(); ann.busyUntil = 0; ann.say(k, who, 3); }
      };
    }, 0.01)));
    // espacialização: um rival passa da esquerda para a direita (chega, cruza a 3 m, vai embora), com Doppler
    {
      const clip = await render(5, async () => {
        const r = new m.RivalEngines(1);
        r.start();
        return (t) => {
          const x = (t - 2.5) * 14; // m, lateral (−35 → +35)
          const dist = Math.hypot(x, 3);
          r.update([{ speedRatio: 0.8, throttle: 1, dist, pan: Math.max(-1, Math.min(1, x / 12)), closing: (-x / dist) * 14 }]);
        };
      });
      res.push(analyse('rival_passando_esq_dir', clip));
      const seg = (arr, a0, a1) => { let s = 0; const i0 = Math.floor(a0 * SR), i1 = Math.floor(a1 * SR); for (let i = i0; i < i1; i++) s += arr[i] * arr[i]; return 10 * Math.log10(s / (i1 - i0) + 1e-12); };
      // Doppler no MESMO harmônico (rodada 11; a autocorrelação pulava de harmônico): pico do espectro
      // perto da frequência de queima esperada (speedRatio 0,8 → giro ~0,9 → ~283 Hz), antes e depois
      const fEsperada = 50 + (0.25 + 3 * 0.03 + 0.9 * 0.62) * 260;
      const pitch = (a0, a1) => {
        const S = spectrum(clip.mono.subarray(Math.floor(a0 * SR), Math.floor(a1 * SR)));
        let best = -1, kb = 0;
        for (let k = Math.floor((fEsperada * 0.85) / S.hz); k < (fEsperada * 1.15) / S.hz; k++) if (S.P[k] > best) { best = S.P[k]; kb = k; }
        // interpolação parabólica do pico
        const [y0, y1, y2] = [S.P[kb - 1], S.P[kb], S.P[kb + 1]].map((v) => Math.log(v + 1e-20));
        return +((kb + (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2 || 1)) * S.hz).toFixed(1);
      };
      const antes = pitch(1.3, 2.1), depois = pitch(2.9, 3.7);
      // motor do jogador na mesma velocidade, para comparar o nível do rival a 3 m
      const player = await render(2.5, async () => { const e = new EngineSound(); e.start(); return () => e.update(0.8, 1, false, 0); });
      extra.espacializacao = {
        antes_1a2s: { L_dB: +seg(clip.L, 1, 2).toFixed(1), R_dB: +seg(clip.R, 1, 2).toFixed(1), tomHz: antes },
        depois_3a4s: { L_dB: +seg(clip.L, 3, 4).toFixed(1), R_dB: +seg(clip.R, 3, 4).toFixed(1), tomHz: depois },
        razaoDoppler: +(antes / depois).toFixed(3),
        razaoDopplerTeorica: +((343 / (343 - 14 * 0.9)) / (343 / (343 + 14 * 0.9))).toFixed(3),
        rivalA3m_dB: +seg(clip.mono, 2.35, 2.65).toFixed(1),
        motorJogadorMesmaVelocidade_dB: +rmsDb(player.mono, 1.5, 2.5).toFixed(1),
        observacao: 'pan -0,8→+0,8 (limite do jogo) e aproximação +14 → −14 m/s: antes do cruzamento o lado esquerdo domina e o tom é mais alto (Doppler); depois, o direito domina e o tom cai. Tom = pico do espectro perto da frequência de queima.',
      };
    }
    // motores nas telas de resultados, viagem e final: motor do jogador + 2 rivais acelerando e, em
    // 1,5 s, o silence() chamado por showResults (com ou sem rede), showPlanetWarp e toHub/showChampion
    extra.motorNasTelas = {};
    for (const tela of ['resultados', 'viagem', 'final']) {
      const clip = await render(4, async () => {
        const e = new EngineSound();
        e.start();
        const r = new m.RivalEngines(2);
        r.start();
        let off = false;
        return (t) => {
          if (t >= 1.5 && !off) { off = true; e.silence(); r.silence(); }
          if (!off) { e.update(0.7, 1, false, 0); r.update([{ speedRatio: 0.7, throttle: 1, dist: 8, pan: -0.4, closing: 0 }, { speedRatio: 0.6, throttle: 1, dist: 14, pan: 0.5, closing: 0 }]); }
        };
      });
      const rms = (a0, a1) => { let s = 0; const i0 = Math.floor(a0 * SR), i1 = Math.floor(a1 * SR); for (let i = i0; i < i1; i++) s += clip.mono[i] * clip.mono[i]; return +(10 * Math.log10(s / (i1 - i0) + 1e-12)).toFixed(1); };
      extra.motorNasTelas[tela] = { rmsCorrida_dB: rms(0.5, 1.5), rmsTela_2a4s_dB: rms(2, 4) };
    }
    // locutor (itens 32/53): métricas de emoção contra a referência de arena (voz humana, CC-BY)
    {
      const kFilt = (x) => {
        // ponderação K (BS.1770) para SR: prateleira +4 dB em 1,5 kHz + passa-alta 38 Hz
        const biq = (x, b, a) => { const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0]; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; } return y; };
        let A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1500 / SR, al = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w), sA = 2 * Math.sqrt(A) * al;
        const y = biq(x, [A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA)], [(A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA]);
        w = 2 * Math.PI * 38 / SR; al = Math.sin(w) / (2 * 0.5); c = Math.cos(w);
        return biq(y, [(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al]);
      };
      const band = async (x, lo, hi) => {
        const c = new OfflineAudioContext(1, x.length, SR);
        const b = c.createBuffer(1, x.length, SR); b.copyToChannel(x, 0);
        const s = c.createBufferSource(); s.buffer = b;
        let node = s;
        for (let k = 0; k < 2; k++) { const f1 = c.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = lo; const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = hi; node.connect(f1); f1.connect(f2); node = f2; }
        node.connect(c.destination); s.start();
        return (await c.startRendering()).getChannelData(0);
      };
      const voiceMetrics = async (x) => {
        const k = kFilt(x);
        const win = Math.floor(0.4 * SR), hop = Math.floor(0.1 * SR);
        let M = -99;
        for (let s = 0; s + win <= k.length; s += hop) { let e = 0; for (let i = s; i < s + win; i++) e += k[i] * k[i]; if (e > 0) M = Math.max(M, -0.691 + 10 * Math.log10(e / win)); }
        const fr = Math.floor(0.02 * SR), nf = Math.floor(x.length / fr);
        const hi = await band(x, 2000, 4000), lo = await band(x, 300, 800), sp = await band(x, 300, 3000);
        const en = (a, i) => { let e = 0; for (let j = i * fr; j < (i + 1) * fr; j++) e += a[j] * a[j]; return e / fr; };
        const E = Array.from({ length: nf }, (_, i) => en(x, i)), Emax = Math.max(...E);
        let eh = 0, el = 0;
        for (let i = 0; i < nf; i++) if (E[i] > Emax * 1e-3) { eh += en(hi, i); el += en(lo, i); }
        // sílabas/s: picos (≥4 dB de proeminência, ≥100 ms entre si) do envelope 300–3000 Hz
        const h = Math.floor(0.01 * SR), nb = Math.floor(sp.length / h);
        const env = Array.from({ length: nb }, (_, i) => { let e = 0; for (let j = i * h; j < Math.min(sp.length, i * h + 4 * h); j++) e += sp[j] * sp[j]; return 10 * Math.log10(e / (4 * h) + 1e-12); });
        const top = Math.max(...env);
        let peaks = 0, lastPk = -99, active = 0;
        for (let i = 1; i < nb - 1; i++) {
          if (env[i] > top - 25) active++;
          if (env[i] >= env[i - 1] && env[i] > env[i + 1] && env[i] > top - 20 && i - lastPk >= 10) {
            let l = env[i], r = env[i];
            for (let j = i; j >= Math.max(0, i - 30); j--) l = Math.min(l, env[j]);
            for (let j = i; j < Math.min(nb, i + 30); j++) r = Math.min(r, env[j]);
            if (env[i] - Math.max(l, r) >= 4) { peaks++; lastPk = i; }
          }
        }
        // F0 (rodada 12): autocorrelação em quadros de 40 ms (passo 10 ms) do sinal 60–900 Hz reduzido a
        // SR/4, só quadros com voz (energia a até 30 dB do máximo e correlação >= 0,45), 70–450 Hz;
        // mediana e faixa de entonação (semitons entre os percentis 10 e 90), como o tratar.py
        const lp = await band(x, 60, 900), D = 4, sr4 = SR / D;
        const y = Float32Array.from({ length: Math.floor(lp.length / D) }, (_, i) => lp[i * D]);
        const w4 = Math.floor(0.04 * sr4), h4 = Math.floor(0.01 * sr4), lag0 = Math.floor(sr4 / 450), lag1 = Math.ceil(sr4 / 70);
        const fe = []; for (let st = 0; st + w4 + lag1 < y.length; st += h4) { let e = 0; for (let i = st; i < st + w4; i++) e += y[i] * y[i]; fe.push(e); }
        const feMax = Math.max(...fe, 1e-12), f0s = [];
        fe.forEach((e0, k) => {
          if (e0 < feMax * 1e-3) return;
          const st = k * h4;
          let best = 0, bl = 0;
          for (let L = lag0; L <= lag1; L++) { let s2 = 0, e1 = 0; for (let i = st; i < st + w4; i++) { s2 += y[i] * y[i + L]; e1 += y[i + L] * y[i + L]; } const r = s2 / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; bl = L; } }
          if (best >= 0.45 && bl) f0s.push(sr4 / bl);
        });
        f0s.sort((a, b) => a - b);
        const pct = (q) => f0s[Math.min(f0s.length - 1, Math.floor(q * f0s.length))];
        const f0Med = f0s.length >= 5 ? Math.round(pct(0.5)) : 0, f0Faixa = f0s.length >= 5 ? +(12 * Math.log2(pct(0.9) / pct(0.1))).toFixed(1) : 0;
        return { loudnessMomentaneoMaxLUFS: +M.toFixed(1), esforcoVocal_dB_2a4k_vs_300a800: +(10 * Math.log10(eh / (el || 1e-12))).toFixed(1), silabasPorSeg: +(peaks / Math.max(0.1, active * 0.01)).toFixed(2), f0Mediano_Hz: f0Med, faixaF0_semitons: f0Faixa };
      };
      const toMono = (b) => { const x = new Float32Array(b.length); for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < x.length; i++) x[i] += d[i] / b.numberOfChannels; } return x; };
      const decode = async (ab) => { const c = new OfflineAudioContext(1, 1, SR); return toMono(await c.decodeAudioData(ab)); };
      // referência (arquivo cru) e cada fala: arquivo cru e depois da cadeia de arena do jogo
      const refB = Uint8Array.from(atob(refWavB64), (ch) => ch.charCodeAt(0)).buffer;
      const ref = await voiceMetrics(await decode(refB));
      // trechos gritados (rodada 11): janelas de 400 ms com energia a até 8 dB do máximo, emendadas
      const gritado = (x) => {
        const w = Math.floor(0.4 * SR), hop = Math.floor(0.1 * SR), lv = [];
        for (let st = 0; st + w <= x.length; st += hop) { let e = 0; for (let i = st; i < st + w; i++) e += x[i] * x[i]; lv.push(10 * Math.log10(e / w + 1e-12)); }
        const top = Math.max(...lv), keep = new Uint8Array(x.length);
        lv.forEach((v, k) => { if (v > top - 8) keep.fill(1, k * hop, k * hop + w); });
        const out = [];
        for (let i = 0; i < x.length; i++) if (keep[i]) out.push(x[i]);
        return Float32Array.from(out);
      };
      const lutaX = await decode(Uint8Array.from(atob(lutaWavB64), (ch) => ch.charCodeAt(0)).buffer);
      const refGrito = { luta: await voiceMetrics(gritado(lutaX)), arena: await voiceMetrics(gritado(await decode(Uint8Array.from(atob(refWavB64), (ch) => ch.charCodeAt(0)).buffer))) };
      const TAXA_GRITO = 4.5;
      const throughArena = async (x) => {
        const c = new OfflineAudioContext(1, x.length + Math.floor(0.5 * SR), SR);
        const b = c.createBuffer(1, x.length, SR); b.copyToChannel(x, 0);
        const s = c.createBufferSource(); s.buffer = b;
        s.connect(m.arenaChain(c, c.destination)); s.start();
        return (await c.startRendering()).getChannelData(0);
      };
      const falas = {};
      for (const f of ['start_0', 'hotFury_0', 'hotFury_1', 'lightsUp_0', 'hammered_0', 'holyToledo_0', 'holyToledo_1', 'wow_0', 'wipedOut_0', 'wipedOut_1', 'finishFirst_0']) {
        const x = await decode(await (await fetch(m.publicUrl(`audio/locutor/${f}.mp3`))).arrayBuffer());
        const cru = await voiceMetrics(x);
        const arena = await voiceMetrics(await throughArena(x));
        const g = refGrito.luta;
        falas[f] = { cru, arena, faixaF0Minima8st: cru.faixaF0_semitons >= 8, atingeGrito: { esforco: cru.esforcoVocal_dB_2a4k_vs_300a800 >= g.esforcoVocal_dB_2a4k_vs_300a800, taxa: cru.silabasPorSeg >= TAXA_GRITO, esforcoArena: arena.esforcoVocal_dB_2a4k_vs_300a800 >= g.esforcoVocal_dB_2a4k_vs_300a800, taxaArena: arena.silabasPorSeg >= TAXA_GRITO }, abaixoDaReferencia: { loudness: cru.loudnessMomentaneoMaxLUFS < ref.loudnessMomentaneoMaxLUFS, esforco: cru.esforcoVocal_dB_2a4k_vs_300a800 < ref.esforcoVocal_dB_2a4k_vs_300a800, taxa: cru.silabasPorSeg < ref.silabasPorSeg }, arenaAtingeReferencia: { loudness: arena.loudnessMomentaneoMaxLUFS >= ref.loudnessMomentaneoMaxLUFS, esforco: arena.esforcoVocal_dB_2a4k_vs_300a800 >= ref.esforcoVocal_dB_2a4k_vs_300a800 } };
      }
      extra.locutor = {
        referencia: { arquivo: 'scripts/locutor/voz-referencia-arena.wav (Alba MacKenna, CC-BY 4.0)', ...ref },
        referenciaGritada: { luta: { arquivo: 'scripts/locutor/voz-referencia-luta.wav (klankbeeld, CC-BY 4.0), só trechos a até 8 dB do máximo', ...refGrito.luta }, arena: refGrito.arena, taxaMinimaGrito: TAXA_GRITO },
        metricasPython: 'F0 mediano, faixa e escolha dos takes: .tts/takes-luta/refazer.json (scripts/locutor/gerar.py refazer)',
        falas,
        observacao: 'loudness = máximo momentâneo (janela 400 ms, ponderação K); esforço = energia 2–4 kHz menos 300–800 Hz nos quadros com voz; taxa = picos silábicos do envelope 300–3000 Hz por segundo de fala. "arena" = a fala depois de arenaChain (src/audio/announcer.ts), usada nas falas de largada/ataque (ARENA_LINES).',
      };
    }
    window.__somExtra = extra;
    return res;
  }, { refWavB64: refWav, lutaWavB64: lutaWav });
  const extra = await page.evaluate(() => window.__somExtra);
  fs.writeFileSync(path.join(dir, 'locutor_emocao.json'), JSON.stringify(extra.locutor, null, 2));
  // rodada 11: destaque dos efeitos sobre a cama/motor, timbre do motor, Doppler e o hino do final
  fs.writeFileSync(path.join(dir, 'contraste_mix.json'), JSON.stringify(extra.contraste, null, 2));
  fs.writeFileSync(path.join(dir, 'motor_timbre.json'), JSON.stringify(extra.motorTimbre, null, 2));
  fs.writeFileSync(path.join(dir, 'espacializacao_e_telas.json'), JSON.stringify({ espacializacao: extra.espacializacao, motorNasTelas: extra.motorNasTelas, finalCampanha: extra.finalCampanha }, null, 2));
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
          const origStep = g.step;
          const t = [];
          // tempo de step() e render() separados (performance.mark/measure)
          const custo = { step: 0, render: 0, passos: 0 };
          // render() > 100 ms: o que subiu para a GPU no engasgo (renderer.info antes/depois) e as subetapas
          const lentos = [];
          g.prof = {};
          const gpuInfo = () => ({ programas: g.renderer.info.programs?.length ?? 0, geometrias: g.renderer.info.memory.geometries, texturas: g.renderer.info.memory.textures });
          const somaProf = () => Object.fromEntries(Object.entries(g.prof ?? {}).map(([k, e]) => [k, e.soma]));
          const t00 = performance.now();
          g.render = function (...a) {
            const t0 = performance.now();
            t.push(t0);
            const antes = gpuInfo();
            const p0 = somaProf();
            performance.mark('rr-render');
            try {
              return orig.apply(this, a);
            } finally {
              performance.measure('rr-render', 'rr-render');
              const d = performance.now() - t0;
              custo.render += d;
              if (d > 100) {
                const sub = {};
                for (const [k, v] of Object.entries(somaProf())) if (v - (p0[k] ?? 0) > 0.5) sub[k] = +(v - (p0[k] ?? 0)).toFixed(1);
                lentos.push({ aosMs: Math.round(t0 - t00), ms: +d.toFixed(1), antes, depois: gpuInfo(), subetapas: sub });
              }
            }
          };
          g.step = function (...a) {
            const t0 = performance.now();
            performance.mark('rr-step');
            try {
              return origStep.apply(this, a);
            } finally {
              performance.measure('rr-step', 'rr-step');
              custo.step += performance.now() - t0;
              custo.passos++;
            }
          };
          setTimeout(() => {
            g.render = orig;
            g.step = origStep;
            const subetapas = Object.fromEntries(Object.entries(g.prof ?? {}).map(([k, e]) => [k, { somaMs: Math.round(e.soma), maiorMs: +e.maior.toFixed(1), n: e.n }]));
            g.prof = null;
            performance.clearMarks();
            performance.clearMeasures();
            const iv = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
            const seg = t.length > 1 ? (t[t.length - 1] - t[0]) / 1000 : ms / 1000;
            const p95 = iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] : 0;
            resolve({
              inicioAbs: Math.round(t00),
              quadros: t.length,
              fpsMedio: +(Math.max(0, t.length - 1) / seg).toFixed(1),
              quadroP95ms: +p95.toFixed(1),
              fpsP95: p95 ? +(1000 / p95).toFixed(1) : 0,
              // custo médio por quadro desenhado e por passo da simulação
              renderMsQuadro: t.length ? +(custo.render / t.length).toFixed(2) : 0,
              stepMsPasso: custo.passos ? +(custo.step / custo.passos).toFixed(2) : 0,
              passos: custo.passos,
              renderLentos: lentos.sort((x, y) => y.ms - x.ms).slice(0, 10),
              subetapas,
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
    const estado = await page.evaluate((t0) => {
      const g = window.game;
      const tipos = { 0: 'Basic', 1: 'PCF', 2: 'PCFSoft', 3: 'VSM' };
      return {
        escalaResolucao: +g.dynRes.scale.toFixed(2),
        pixelRatio: +g.renderer.getPixelRatio().toFixed(2),
        trava30: g.cap30,
        // queda automática e o que ficou ligado (prova de que a resolução dinâmica e a queda agiram)
        degrau: g.degrade,
        bloom: !!g.postfx,
        sombraTipo: tipos[g.renderer.shadowMap.type] ?? g.renderer.shadowMap.type,
        sombraLigada: g.sun.castShadow,
        sombraIntensidade: g.sun.shadow.intensity,
        historicoEscalas: g.dynRes.history,
        // resize, resolução dinâmica, queda e preparo com carimbo relativo ao início da medição da
        // corrida (aosMs negativo = antes dela; cruzar com corrida.renderLentos[].aosMs)
        eventos: g.perfEvents.map((e) => ({ aosMs: e.t - t0, tipo: e.tipo, info: e.info })),
      };
    }, corrida.inicioAbs);
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
      'pausaQuadros = quadros desenhados em 4 s de pausa (esperado 0: imagem congelada). trava30 = nível baixo travou a corrida em 30 qps. ' +
      'O menu principal só desenha ao entrar e quando algo muda (menuQps/desenhoQps perto de 0 é o esperado). ' +
      'renderMsQuadro/stepMsPasso = custo médio de render() por quadro e de step() por passo (performance.mark rr-render/rr-step). ' +
      'renderLentos = render() > 100 ms (aosMs = início desde o começo da medição) com renderer.info antes/depois e as subetapas; subetapas = trechos de step()/render() (game.prof).',
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
