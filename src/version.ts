declare const __APP_VERSION__: string | undefined;

/** Versão do jogo, calculada no build (ver vite.config.ts). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
