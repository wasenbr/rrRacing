declare const __APP_VERSION__: string | undefined;

const raw: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/**
 * Versão do jogo, calculada no build (ver vite.config.ts). O "+" (alterações não commitadas) só
 * aparece no servidor de desenvolvimento: a versão publicada mostra só o commit.
 */
export const APP_VERSION: string = import.meta.env?.DEV ? raw : raw.replace(/\+(?=\s|$)/g, '');
