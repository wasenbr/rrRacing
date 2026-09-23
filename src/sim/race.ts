import { forwardX, forwardZ } from './math';
import type { Track } from './track';
import type { VehicleState } from './vehicle';

export interface RacerProgress {
  /** volta atual (1..laps); laps+1 quando terminou */
  lap: number;
  lapStart: number;
  lapTimes: number[];
  lastDist: number;
  halfwayReached: boolean;
  wrongWayTime: number;
  finished: boolean;
  finishTime: number;
}

export function createProgress(track: Track, v: VehicleState): RacerProgress {
  return {
    lap: 1,
    lapStart: 0,
    lapTimes: [],
    lastDist: track.query(v.x, v.z, v.pieceIndex).dist,
    halfwayReached: false,
    wrongWayTime: 0,
    finished: false,
    finishTime: 0,
  };
}

export type RaceEvent = { type: 'lap'; lap: number; time: number } | { type: 'finish'; time: number };

/**
 * Atualiza voltas. A linha de chegada fica no início da peça 0; para uma volta contar
 * o carro precisa ter passado pela metade da pista (evita "roubar" dando ré na linha).
 */
export function updateProgress(p: RacerProgress, track: Track, v: VehicleState, raceTime: number, laps: number, dt: number): RaceEvent | null {
  if (p.finished) return null;
  const sample = track.query(v.x, v.z, v.pieceIndex);
  const d = sample.dist;
  const T = track.totalLength;
  let event: RaceEvent | null = null;

  if (d > T * 0.4 && d < T * 0.6) p.halfwayReached = true;

  const window = 30;
  if (p.lastDist > T - window && d < window) {
    if (p.halfwayReached) {
      p.lapTimes.push(raceTime - p.lapStart);
      p.lapStart = raceTime;
      p.halfwayReached = false;
      p.lap++;
      if (p.lap > laps) {
        p.finished = true;
        p.finishTime = raceTime;
        event = { type: 'finish', time: raceTime };
      } else {
        event = { type: 'lap', lap: p.lap, time: raceTime };
      }
    }
  } else if (p.lastDist < window && d > T - window) {
    p.halfwayReached = false; // cruzou a linha de ré
  }
  p.lastDist = d;

  const along = v.vx * forwardX(sample.heading) + v.vz * forwardZ(sample.heading);
  p.wrongWayTime = along < -3 ? p.wrongWayTime + dt : 0;
  return event;
}
