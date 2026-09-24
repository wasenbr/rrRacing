// Medição de equilíbrio dos carros (roda no Node, sem navegador).
// Uso: npx rolldown scripts/equilibrio.ts --file <saida>.mjs --platform node && node <saida>.mjs
import { TRACKS } from '../src/data/tracks';
import { VEHICLES } from '../src/data/vehicles';
import { buildSpec, newCarSetup } from '../src/sim/garage';
import { Track } from '../src/sim/track';
import { forwardSpeed } from '../src/sim/vehicle';
import { createWorld, PRIZES, stepWorld, type Difficulty } from '../src/sim/world';

const dt = 1 / 60;
const ids = Object.keys(VEHICLES);
const profile = { skill: 0.9, aggression: 0, lane: 0 };
/** Tempo parado (s, somado em todas as pistas) e pistas não completadas na volta solo. */
const stopped: Record<string, number> = {};
const failed: string[] = [];

/** Volta solo pilotada pela CPU (habilidade 0,9), média em todas as pistas. */
function soloLaps(upgrades = 0) {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const setup = newCarSetup(id);
    setup.upgrades = { engine: upgrades, tires: upgrades, shocks: upgrades, armor: upgrades };
    const spec = buildSpec(VEHICLES[id], setup);
    let sum = 0;
    let n = 0;
    for (const def of TRACKS) {
      const w = createWorld(new Track(def), [{ name: 'P', color: 0, spec, ai: { ...profile } }], 2, 7, PRIZES);
      w.started = true;
      let t = 0;
      const r = w.racers[0];
      while (r.progress.lapTimes.length < 2 && t < 120) {
        stepWorld(w, {}, dt);
        t += dt;
        // tempo parado (quase sem andar) depois da arrancada
        if (t > 3 && Math.hypot(r.car.vx, r.car.vz) < 2) stopped[id] = (stopped[id] ?? 0) + dt;
      }
      if (r.progress.lapTimes.length >= 2) {
        sum += r.progress.lapTimes[1];
        n++;
      } else failed.push(`${id}@${def.id}`);
    }
    out[id] = +(sum / Math.max(1, n)).toFixed(2);
  }
  return out;
}

/** Corridas com os 5 carros misturados (4 por corrida, CPUs iguais) — posição média de cada carro. */
function mixed(withWeapons: boolean, difficulty: Difficulty = 'normal') {
  const places: Record<string, number[]> = Object.fromEntries(ids.map((i) => [i, []]));
  let seed = 1;
  for (const def of TRACKS) {
    for (let rot = 0; rot < ids.length; rot++) {
      const cars = [0, 1, 2, 3].map((k) => ids[(rot + k) % ids.length]);
      const entries = cars.map((id, i) => ({
        name: id,
        color: 0,
        spec: VEHICLES[id],
        ai: { skill: 0.88, aggression: withWeapons ? 0.7 : 0, lane: [-1.5, -0.5, 0.5, 1.5][i] },
      }));
      const w = createWorld(new Track(def), entries, 3, seed++, PRIZES, difficulty);
      if (!withWeapons) w.racers.forEach((r) => (r.frontCharges = r.rearCharges = 0));
      w.started = true;
      let t = 0;
      while (w.finishedCount < 4 && t < 400) {
        if (!withWeapons) w.racers.forEach((r) => (r.frontCharges = r.rearCharges = 0));
        stepWorld(w, {}, dt);
        t += dt;
      }
      w.racers.forEach((r) => places[r.spec.id].push(r.place));
    }
  }
  return Object.fromEntries(ids.map((id) => [id, +(places[id].reduce((a, b) => a + b, 0) / places[id].length).toFixed(2)]));
}

function accel() {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const spec = VEHICLES[id];
    const def = TRACKS.find((d) => d.id.startsWith('newmojave')) ?? TRACKS[0];
    const w = createWorld(new Track(def), [{ name: 'P', color: 0, spec, ai: null }], 9, 1, PRIZES);
    w.started = true;
    let t = 0;
    let t60 = 0;
    let t100 = 0;
    const r = w.racers[0];
    while (t < 4) {
      stepWorld(w, { 0: { throttle: 1, brake: 0, steer: 0, fire: false, drop: false, nitro: false } }, dt);
      t += dt;
      const k = forwardSpeed(r.car) * 3.6;
      if (!t60 && k >= 60) t60 = t;
      if (!t100 && k >= 100) t100 = t;
    }
    out[id] = `0-60 ${t60.toFixed(2)}s 0-100 ${t100 ? t100.toFixed(2) + 's' : '>4s'} máx ${(spec.maxSpeed * 3.6).toFixed(0)}km/h`;
  }
  return out;
}

const what = process.argv[2] ?? 'tudo';
if (what === 'tudo' || what === 'accel') console.log('arranque', accel());
if (what === 'tudo' || what === 'solo') {
  console.log('volta solo (média, s)', soloLaps(0), 'melhorado nível 3', soloLaps(3));
  console.log('parado (s, todas as pistas, 2 níveis)', Object.fromEntries(Object.entries(stopped).map(([k, v]) => [k, +v.toFixed(1)])), 'não completou', failed);
}
if (what === 'tudo' || what === 'misto') console.log('posição média sem armas', mixed(false), 'com armas', mixed(true));
