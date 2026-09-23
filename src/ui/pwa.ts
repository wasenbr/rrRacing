/**
 * Recursos de "app": tela cheia, instalação como web app (PWA) e sair do jogo.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: InstallPromptEvent | null = null;
const listeners: (() => void)[] = [];

/** Registra o service worker (só no build de produção) e escuta o convite de instalação. */
export function initPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    listeners.forEach((fn) => fn());
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* sem service worker o jogo funciona normalmente, só não fica offline */
      });
    });
  }
}

/** Avisa quando a possibilidade de instalar muda (para mostrar/esconder o botão). */
export function onInstallChange(fn: () => void): void {
  listeners.push(fn);
}

/** Rodando como app instalado? */
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function canInstall(): boolean {
  return !!installEvent && !isInstalled();
}

/** iPhone/iPad não têm o convite automático: é preciso usar "Compartilhar → Adicionar à Tela de Início". */
export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  await installEvent.prompt();
  const choice = await installEvent.userChoice;
  installEvent = null;
  listeners.forEach((fn) => fn());
  return choice.outcome === 'accepted';
}

export function fullscreenSupported(): boolean {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  const d = document as Document & { webkitFullscreenElement?: Element };
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
}

/** Entra ou sai da tela cheia (e trava em paisagem quando possível). Retorna o novo estado. */
export async function toggleFullscreen(force?: boolean): Promise<boolean> {
  const want = force ?? !isFullscreen();
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const d = document as Document & { webkitExitFullscreen?: () => void };
  try {
    if (want && !isFullscreen()) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else el.webkitRequestFullscreen?.();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {});
      // PC: com o Ctrl de tiro, Ctrl+W fecharia a aba; em tela cheia o Keyboard Lock segura as teclas
      await (navigator as Navigator & { keyboard?: { lock?: (k?: string[]) => Promise<void> } }).keyboard?.lock?.(['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'Escape']).catch(() => {});
    } else if (!want && isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else d.webkitExitFullscreen?.();
    }
  } catch {
    /* navegador recusou (ex.: sem gesto do usuário) */
  }
  return isFullscreen();
}

export function onFullscreenChange(fn: (on: boolean) => void): void {
  const h = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  document.addEventListener('webkitfullscreenchange', h);
}

/**
 * Sair do jogo: no app instalado fecha a janela; no navegador sai da tela cheia
 * (a aba não pode ser fechada por script) e o chamador mostra a tela de despedida.
 * @returns true se a janela deve fechar
 */
export async function quitGame(): Promise<boolean> {
  if (isFullscreen()) await toggleFullscreen(false);
  if (isInstalled()) {
    window.close();
    return true;
  }
  return false;
}
