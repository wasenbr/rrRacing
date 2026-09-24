/**
 * Relógio que continua batendo com a aba oculta (o rAF para e o setInterval da página cai para
 * 1 vez por segundo). O host de uma corrida online usa para seguir simulando: o timer roda num
 * Worker, que o navegador não estrangula como a página. Sem Worker, cai no setInterval.
 */
export class HiddenTicker {
  private worker: Worker | null = null;
  private url = '';
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onTick: () => void) {}

  get running(): boolean {
    return !!(this.worker || this.interval);
  }

  start(ms = 16): void {
    if (this.running) return;
    try {
      this.url = URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.worker.onmessage = () => this.onTick();
      this.worker.onerror = () => {
        this.stop();
        this.interval = setInterval(this.onTick, ms);
      };
    } catch {
      this.stop();
      this.interval = setInterval(this.onTick, ms);
    }
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
