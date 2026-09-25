/**
 * Fila de trabalho pesado dos menus (miniaturas 3D, retratos): um trabalho por intervalo livre do
 * navegador (`requestIdleCallback`, só com mais de 8 ms sobrando) e nada enquanto a tela rola — a
 * rolagem no celular fica lisa. Os trabalhos da tela aberta passam na frente dos de pré-geração.
 */

type Job = { key: string; run: () => void };

interface Deadline {
  timeRemaining(): number;
  didTimeout: boolean;
}

const queue: Job[] = [];
const queued = new Set<string>();
let scheduled = false;
let scrollingUntil = 0;
let listening = false;
/** corrida na tela: a fila espera (sem requestIdleCallback, o Safari rodava um trabalho a cada 40 ms) */
let paused = false;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function requestIdle(f: (d: Deadline) => void): void {
  const ric = (globalThis as unknown as { requestIdleCallback?: (f: (d: Deadline) => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof ric === 'function') ric(f, { timeout: 2000 });
  else
    setTimeout(() => {
      const t0 = now();
      f({ timeRemaining: () => Math.max(0, 16 - (now() - t0)), didTimeout: false });
    }, 40);
}

function listenScroll(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // captura: pega a rolagem de qualquer elemento (o overlay dos menus rola, não a janela)
  const mark = () => (scrollingUntil = now() + 150);
  document.addEventListener('scroll', mark, { capture: true, passive: true });
  document.addEventListener('touchmove', mark, { capture: true, passive: true });
  document.addEventListener('wheel', mark, { capture: true, passive: true });
}

/** Pausa a fila durante a corrida; ao soltar, volta de onde parou. */
export function setIdlePaused(on: boolean): void {
  paused = on;
  if (!on) schedule();
}

function schedule(): void {
  if (paused || scheduled || !queue.length) return;
  scheduled = true;
  requestIdle(tick);
}

function tick(deadline: Deadline): void {
  scheduled = false;
  if (paused) return;
  const wait = scrollingUntil - now();
  if (wait > 0) {
    // rolando: espera a rolagem parar (150 ms sem eventos) antes de voltar a gerar
    setTimeout(schedule, wait + 10);
    return;
  }
  if (deadline.timeRemaining() > 8 || deadline.didTimeout) {
    const job = queue.shift();
    if (job) {
      queued.delete(job.key);
      try {
        job.run();
      } catch {
        /* um trabalho que falha não trava a fila */
      }
    }
  }
  schedule();
}

/**
 * Põe um trabalho na fila (ignorado se a mesma chave já estiver lá). `urgent` coloca na frente
 * (ou adianta um que já estava na fila) — usado para o que a tela aberta mostra.
 */
export function idleJob(key: string, run: () => void, urgent = false): void {
  listenScroll();
  if (queued.has(key)) {
    if (!urgent) return;
    const i = queue.findIndex((j) => j.key === key);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
  } else {
    queued.add(key);
    if (urgent) queue.unshift({ key, run });
    else queue.push({ key, run });
  }
  schedule();
}

/** Várias chaves urgentes preservando a ordem (a primeira fica na frente). */
export function idleJobsUrgent(jobs: Job[]): void {
  for (let i = jobs.length - 1; i >= 0; i--) idleJob(jobs[i].key, jobs[i].run, true);
}
