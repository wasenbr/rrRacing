/**
 * Ícones monocromáticos em SVG inline (herdam a cor do texto). Substituem os emojis, que viram
 * glifos quebrados em aparelhos sem fonte de emoji.
 */
const P: Record<string, string> = {
  gamepad: '<path d="M7 7h10a5 5 0 0 1 4.8 6.4l-1 3.4a2.6 2.6 0 0 1-4.4 1L14.6 16H9.4l-1.8 1.8a2.6 2.6 0 0 1-4.4-1l-1-3.4A5 5 0 0 1 7 7z" fill="currentColor"/><path d="M7.5 10v4M5.5 12h4" stroke="#000" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="10.8" r="1.2" fill="#000" opacity=".55"/><circle cx="18" cy="13.2" r="1.2" fill="#000" opacity=".55"/>',
  install: '<path d="M12 3v11m0 0-4.5-4.5M12 14l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  globe: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2h7.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="currentColor"/>',
  gear: '<path d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z" fill="currentColor"/><circle cx="12" cy="12" r="3.4" fill="#000" opacity=".55"/>',
  power: '<path d="M12 3v8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  fullscreen: '<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  exitFullscreen: '<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  key: '<circle cx="7.5" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 12h10M18 12v4M21 12v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  cart: '<path d="M2 3h3l2.6 11.5h11L21 7H6.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="19.5" r="1.8" fill="currentColor"/><circle cx="17" cy="19.5" r="1.8" fill="currentColor"/>',
  save: '<path d="M4 3h13l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="currentColor"/><rect x="7" y="4" width="9" height="5" fill="#000" opacity=".5"/><rect x="6" y="13" width="12" height="7" rx="1" fill="#000" opacity=".5"/>',
  wrench: '<path d="M21 6.5a5 5 0 0 1-6.8 4.7L6 19.4a2 2 0 0 1-2.8-2.8l8.2-8.2A5 5 0 0 1 17.5 3L14.6 6l.6 2.6 2.6.6z" fill="currentColor"/>',
  blast: '<path d="M12 1.5l2.2 5.4 5.3-2.6-2.1 5.4 5.1 2.3-5.4 2 2.3 5.5-5.5-2.2L12 22.5l-2-5.2-5.4 2.2 2.3-5.5-5.4-2 5.1-2.3-2.1-5.4 5.3 2.6z" fill="currentColor"/><circle cx="12" cy="12" r="3" fill="#000" opacity=".35"/>',
  car: '<path d="M3 15v-3l2.5-5h9l3.5 4.5 3 .8V15z" fill="currentColor"/><circle cx="7" cy="16" r="2.6" fill="currentColor" stroke="#000" stroke-opacity=".5" stroke-width="1.4"/><circle cx="17.5" cy="16" r="2.6" fill="currentColor" stroke="#000" stroke-opacity=".5" stroke-width="1.4"/><path d="M7 8.5h6.5l2 3H6z" fill="#000" opacity=".45"/>',
  lock: '<rect x="4.5" y="10" width="15" height="11" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/>',
  plus: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  trash: '<path d="M9 3h6l1 2h4v2H4V5h4zm-3 6h12l-1 12H7z" fill="currentColor"/>',
  next: '<path d="M4 5l9 7-9 7zM13 5l7 7-7 7z" fill="currentColor"/><rect x="19" y="5" width="2.5" height="14" fill="currentColor"/>',
  eject: '<path d="M12 4l8 9H4z" fill="currentColor"/><rect x="4" y="16" width="16" height="3.5" rx="1" fill="currentColor"/>',
  trophy: '<path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 5H3.5c0 3 1.5 5 4 5.3M17 5h3.5c0 3-1.5 5-4 5.3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 13h3v4h-3zM7 19h10v2.5H7z" fill="currentColor"/>',
  bolt: '<path d="M13.5 1 4 13.5h6.5L9 23l10-13h-6.5z" fill="currentColor"/>',
  arrowRight: '<path d="M4 12h14m-5-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  pause: '<rect x="6" y="4" width="4.2" height="16" rx="1" fill="currentColor"/><rect x="13.8" y="4" width="4.2" height="16" rx="1" fill="currentColor"/>',
  camera: '<rect x="2" y="6.5" width="13.5" height="11" rx="2" fill="currentColor"/><path d="M16.5 10.5 22 7v10l-5.5-3.5z" fill="currentColor"/><circle cx="8.7" cy="12" r="2.4" fill="#000" opacity=".45"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10" y="18.2" width="4" height="1.4" rx=".7" fill="currentColor"/>',
  check: '<path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  music: '<path d="M9 17.5V5l11-2v12.5" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="6.5" cy="17.5" r="2.8" fill="currentColor"/><circle cx="17.5" cy="15.5" r="2.8" fill="currentColor"/>',
  soundOn: '<path d="M3 9h4l5-4.5v15L7 15H3z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  soundOff: '<path d="M3 9h4l5-4.5v15L7 15H3z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  swirl: '<path d="M12 12a2 2 0 1 1 2-2 4 4 0 0 1-4 4 6 6 0 0 1-6-6 8 8 0 0 1 8-8M12 12a2 2 0 1 0-2 2 4 4 0 0 0 4-4 6 6 0 0 0-6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  drift: '<path d="M4 19c3-1 5-3 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/><path d="M2 14c2 0 4-1 5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".45"/><g transform="rotate(-28 15 11)"><rect x="9" y="7" width="12" height="8" rx="2.2" fill="currentColor"/><rect x="8" y="5.3" width="3.4" height="2.4" rx=".8" fill="currentColor"/><rect x="18" y="5.3" width="3.4" height="2.4" rx=".8" fill="currentColor"/><rect x="8" y="14.3" width="3.4" height="2.4" rx=".8" fill="currentColor"/><rect x="18" y="14.3" width="3.4" height="2.4" rx=".8" fill="currentColor"/><rect x="12" y="8.6" width="5" height="4.8" rx="1" fill="#000" opacity=".4"/></g>',
  brake: '<circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M4.2 6.5a9.5 9.5 0 0 0 0 11M19.8 6.5a9.5 9.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 8.6v4.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="15.4" r="1.4" fill="currentColor"/>',
  flag: '<path d="M5 21V3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M5 4h14v10H5z" fill="currentColor"/><path d="M5 4h3.5v3.3H5zm7 0h3.5v3.3H12zM8.5 7.3H12v3.4H8.5zm7 0H19v3.4h-3.5zM5 10.7h3.5V14H5zm7 0h3.5V14H12z" fill="#000" opacity=".55"/>',
};

export type IconName = keyof typeof P;

/** SVG inline de um ícone (1em, alinhado ao texto). */
export function icon(name: IconName, cls = ''): string {
  return `<svg class="ico${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

/** Emojis usados em mensagens curtas (avisos da HUD etc.) e o ícone equivalente. */
const EMOJI: [string, IconName][] = [
  ['💥', 'blast'], ['🌀', 'swirl'], ['🏁', 'flag'], ['✔', 'check'], ['💾', 'save'], ['🌐', 'globe'], ['🎥', 'camera'],
  ['🔇', 'soundOff'], ['🔊', 'soundOn'], ['♪', 'music'], ['🏆', 'trophy'], ['⚡', 'bolt'],
];

/**
 * Texto (sem HTML) → HTML seguro com os emojis conhecidos trocados por ícones SVG; outros
 * pictogramas fora das fontes comuns são removidos.
 */
export function withIcons(text: string): string {
  return iconizeHtml(text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!));
}

/** Como withIcons, para um trecho que já é HTML. */
export function iconizeHtml(html: string): string {
  let s = html;
  for (const [e, n] of EMOJI) s = s.split(e).join(icon(n));
  return s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\u{FE0F}?/gu, '').trim();
}
