/**
 * Retratos dos pilotos, desenhados por código em SVG (estilo cartoon heavy metal do original).
 * Cada rosto é montado a partir de peças: formato da cabeça, olhos, boca, cabelo e acessórios.
 */

type Head = 'human' | 'brute' | 'long' | 'skull' | 'robot' | 'cat';
type Eyes = 'shades' | 'visor' | 'angry' | 'glow' | 'cat' | 'goggles';
type Mouth = 'grin' | 'smirk' | 'fangs' | 'snarl' | 'grill' | 'skull';
type Hair = 'none' | 'mullet' | 'mohawk' | 'spikes' | 'long' | 'crest';
type Extra = 'horns' | 'viking' | 'beard' | 'scar' | 'earring' | 'antenna' | 'bolts' | 'tusks';

interface Face {
  head: Head;
  skin: string;
  eyes: Eyes;
  eyeColor?: string;
  mouth: Mouth;
  hair: Hair;
  hairColor?: string;
  extras?: Extra[];
  jacket: string;
  bg: string;
}

const FACES: Record<string, Face> = {
  snake: { head: 'human', skin: '#e8b48a', eyes: 'shades', mouth: 'smirk', hair: 'mullet', hairColor: '#f2d060', extras: ['earring'], jacket: '#1a1a1e', bg: '#1f4fa0' },
  cyberhawk: { head: 'robot', skin: '#9aa6b8', eyes: 'visor', eyeColor: '#ff2a1a', mouth: 'grill', hair: 'none', extras: ['antenna', 'bolts'], jacket: '#5a1010', bg: '#6a1010' },
  ivanzypher: { head: 'brute', skin: '#7aa04a', eyes: 'goggles', eyeColor: '#ffb020', mouth: 'snarl', hair: 'spikes', hairColor: '#2a3a10', extras: ['tusks'], jacket: '#3a2a1a', bg: '#3a5a1a' },
  katarina: { head: 'cat', skin: '#e0943a', eyes: 'cat', eyeColor: '#5cff5c', mouth: 'smirk', hair: 'long', hairColor: '#8a1a2a', extras: ['earring'], jacket: '#2a0a3a', bg: '#6a2a8a' },
  jake: { head: 'brute', skin: '#c08060', eyes: 'angry', mouth: 'grin', hair: 'mohawk', hairColor: '#e0301a', extras: ['scar'], jacket: '#202020', bg: '#a04010' },
  tarquinn: { head: 'long', skin: '#4aa05a', eyes: 'glow', eyeColor: '#ffe020', mouth: 'fangs', hair: 'crest', hairColor: '#e05a1a', jacket: '#1a2a4a', bg: '#10507a' },
  olaf: { head: 'human', skin: '#f0c0a0', eyes: 'angry', mouth: 'grin', hair: 'none', extras: ['viking', 'beard'], hairColor: '#e0701a', jacket: '#5a3a1a', bg: '#2a6a3a' },
  rip: { head: 'human', skin: '#b8b8c0', eyes: 'angry', mouth: 'fangs', hair: 'spikes', hairColor: '#f0f0f0', extras: ['scar'], jacket: '#3a3a40', bg: '#505058' },
  shred: { head: 'human', skin: '#a0704a', eyes: 'angry', mouth: 'snarl', hair: 'spikes', hairColor: '#4a2a14', extras: ['earring'], jacket: '#3a2210', bg: '#6a4020' },
  viper: { head: 'long', skin: '#3ac040', eyes: 'cat', eyeColor: '#ff3020', mouth: 'fangs', hair: 'long', hairColor: '#101010', jacket: '#0a2a10', bg: '#0a4a1a' },
  grinder: { head: 'robot', skin: '#6a6f7c', eyes: 'visor', eyeColor: '#40ff80', mouth: 'grill', hair: 'none', extras: ['bolts'], jacket: '#202228', bg: '#303440' },
  ragewortt: { head: 'brute', skin: '#5a6a2a', eyes: 'glow', eyeColor: '#ff3a1a', mouth: 'snarl', hair: 'spikes', hairColor: '#2e3a12', extras: ['tusks'], jacket: '#2a2a10', bg: '#2a3a10' },
  roadkill: { head: 'human', skin: '#a0a878', eyes: 'goggles', eyeColor: '#80e0ff', mouth: 'grin', hair: 'mohawk', hairColor: '#5cff3a', extras: ['scar'], jacket: '#4a3a14', bg: '#6a5a20' },
  butcher: { head: 'skull', skin: '#d8e8f0', eyes: 'glow', eyeColor: '#40e0ff', mouth: 'skull', hair: 'none', extras: ['horns'], jacket: '#10202a', bg: '#103a5a' },
  slash: { head: 'brute', skin: '#b02010', eyes: 'glow', eyeColor: '#ffe020', mouth: 'fangs', hair: 'long', hairColor: '#0a0a0a', extras: ['horns'], jacket: '#1a0606', bg: '#3a0606' },
};

/** Liga nomes/ids (com variações de grafia) ao rosto. */
function faceKey(nameOrId: string): string {
  const n = nameOrId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys: [string, string][] = [
    ['snake', 'snake'], ['cyber', 'cyberhawk'], ['ivan', 'ivanzypher'], ['zypher', 'ivanzypher'], ['katarina', 'katarina'], ['lyons', 'katarina'],
    ['jake', 'jake'], ['badlands', 'jake'], ['tarquinn', 'tarquinn'], ['olaf', 'olaf'], ['rip', 'rip'], ['shred', 'shred'], ['viper', 'viper'],
    ['grinder', 'grinder'], ['rage', 'ragewortt'], ['roadkill', 'roadkill'], ['kelly', 'roadkill'], ['butcher', 'butcher'], ['icebone', 'butcher'],
    ['slash', 'slash'], ['jb', 'slash'],
  ];
  return keys.find(([k]) => n.includes(k))?.[1] ?? '';
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Rosto genérico (piloto desconhecido): variação determinística pelo nome. */
function genericFace(name: string): Face {
  const h = hash(name);
  const pick = <T,>(arr: T[], k: number) => arr[(h >>> k) % arr.length];
  return {
    head: pick<Head>(['human', 'brute', 'long', 'robot'], 0),
    skin: pick(['#e8b48a', '#7aa04a', '#9aa6b8', '#c08060', '#a070c0'], 3),
    eyes: pick<Eyes>(['angry', 'shades', 'glow', 'goggles'], 6),
    eyeColor: pick(['#ff3020', '#40e0ff', '#ffe020'], 9),
    mouth: pick<Mouth>(['grin', 'snarl', 'fangs', 'smirk'], 11),
    hair: pick<Hair>(['mohawk', 'spikes', 'none', 'long'], 14),
    hairColor: pick(['#e0301a', '#f2d060', '#101010', '#5cff3a'], 17),
    jacket: '#202020',
    bg: pick(['#6a1010', '#1f4fa0', '#3a5a1a', '#6a2a8a'], 20),
  };
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

let uid = 0;

/** SVG do retrato (string pronta para innerHTML). */
export function portraitSvg(nameOrId: string, size = 96): string {
  const f = FACES[faceKey(nameOrId)] ?? genericFace(nameOrId);
  const id = `pt${uid++}`;
  const skinD = shade(f.skin, 0.62);
  const skinL = shade(f.skin, 1.25);
  const hairC = f.hairColor ?? '#222';
  const eyeC = f.eyeColor ?? '#ff3020';
  const ex = new Set(f.extras ?? []);
  const p: string[] = [];

  // fundo: moldura com chamas
  p.push(`<defs>
    <radialGradient id="${id}bg" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(f.bg, 1.35)}"/><stop offset="1" stop-color="${shade(f.bg, 0.35)}"/></radialGradient>
    <linearGradient id="${id}sk" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="${skinL}"/><stop offset="0.55" stop-color="${f.skin}"/><stop offset="1" stop-color="${skinD}"/></linearGradient>
    <linearGradient id="${id}fl" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff3a0a"/><stop offset="0.6" stop-color="#ffb020"/><stop offset="1" stop-color="#ffe070" stop-opacity="0"/></linearGradient>
    <clipPath id="${id}c"><rect x="2" y="2" width="116" height="116" rx="14"/></clipPath>
  </defs>`);
  p.push(`<g clip-path="url(#${id}c)">`);
  p.push(`<rect width="120" height="120" fill="url(#${id}bg)"/>`);
  p.push(`<path d="M0 120 L0 92 Q8 70 14 90 Q20 60 28 88 Q36 66 42 94 L78 94 Q84 66 92 88 Q100 60 106 90 Q112 70 120 92 L120 120Z" fill="url(#${id}fl)" opacity="0.85"/>`);

  // ombros / jaqueta com ombreiras
  p.push(`<path d="M14 120 Q18 96 40 90 L80 90 Q102 96 106 120Z" fill="${f.jacket}" stroke="#000" stroke-width="2"/>`);
  p.push(`<path d="M22 104 L30 92 L36 104Z M98 104 L90 92 L84 104Z" fill="#c8c8d0" stroke="#000" stroke-width="1.5"/>`);
  p.push(`<path d="M52 90 L60 104 L68 90" fill="none" stroke="${shade(f.jacket, 1.6)}" stroke-width="2"/>`);
  // pescoço
  p.push(`<rect x="50" y="76" width="20" height="16" fill="${skinD}" stroke="#000" stroke-width="2"/>`);

  // cabelo de trás (mullet e longo)
  if (f.hair === 'mullet') p.push(`<path d="M34 50 Q30 86 44 92 L76 92 Q90 86 86 50Z" fill="${shade(hairC, 0.8)}" stroke="#000" stroke-width="2"/>`);
  if (f.hair === 'long') p.push(`<path d="M30 46 Q24 90 38 100 L82 100 Q96 90 90 46Z" fill="${shade(hairC, 0.85)}" stroke="#000" stroke-width="2"/>`);

  // orelhas de gato e chifres atrás da cabeça
  if (f.head === 'cat') {
    p.push(`<path d="M36 36 L34 10 L54 28Z M84 36 L86 10 L66 28Z" fill="${f.skin}" stroke="#000" stroke-width="2"/>`);
    p.push(`<path d="M39 30 L38 17 L49 27Z M81 30 L82 17 L71 27Z" fill="#f0a0b0"/>`);
  }
  if (ex.has('horns')) p.push(`<path d="M38 34 Q22 22 24 4 Q32 20 46 26Z M82 34 Q98 22 96 4 Q88 20 74 26Z" fill="#e8e0c8" stroke="#000" stroke-width="2"/>`);

  // cabeça
  const head: Record<Head, string> = {
    human: `<path d="M36 44 Q36 18 60 18 Q84 18 84 44 L84 58 Q82 80 60 84 Q38 80 36 58Z"/>`,
    brute: `<path d="M32 42 Q34 16 60 16 Q86 16 88 42 L90 62 Q88 84 60 86 Q32 84 30 62Z"/>`,
    long: `<path d="M38 40 Q40 16 62 16 Q84 18 84 40 L86 54 Q96 60 96 70 Q94 82 70 84 L54 84 Q38 80 36 60Z"/>`,
    skull: `<path d="M34 44 Q34 14 60 14 Q86 14 86 44 Q86 58 78 64 L76 80 L44 80 L42 64 Q34 58 34 44Z"/>`,
    robot: `<path d="M36 28 Q36 18 46 18 L74 18 Q84 18 84 28 L86 66 Q86 82 70 84 L50 84 Q34 82 34 66Z"/>`,
    cat: `<path d="M34 46 Q34 20 60 20 Q86 20 86 46 Q86 70 70 80 Q60 86 50 80 Q34 70 34 46Z"/>`,
  };
  p.push(head[f.head].replace('<path', `<path fill="url(#${id}sk)" stroke="#000" stroke-width="2.5"`));

  // detalhes de cabeça
  if (f.head === 'robot' || ex.has('bolts')) {
    p.push(`<g fill="${skinD}" stroke="#000" stroke-width="1"><circle cx="40" cy="30" r="2.2"/><circle cx="80" cy="30" r="2.2"/><circle cx="39" cy="70" r="2.2"/><circle cx="81" cy="70" r="2.2"/></g>`);
    p.push(`<path d="M60 18 L60 36" stroke="${skinD}" stroke-width="2"/>`);
  }
  if (f.head === 'long') p.push(`<circle cx="88" cy="66" r="1.8" fill="#000"/><circle cx="82" cy="64" r="1.6" fill="#000"/>`);
  if (f.head === 'cat') p.push(`<path d="M56 62 L64 62 L60 67Z" fill="#3a1a1a"/><path d="M48 66 L34 64 M48 68 L34 70 M72 66 L86 64 M72 68 L86 70" stroke="#000" stroke-width="1"/>`);
  if (f.head === 'human' || f.head === 'brute') p.push(`<path d="M58 52 Q56 62 60 64 Q64 62 62 52" fill="${skinD}" opacity="0.7"/>`);

  // olhos
  const eyes: Record<Eyes, string> = {
    shades: `<path d="M36 44 L84 44 L82 54 Q72 58 64 52 L56 52 Q48 58 38 54Z" fill="#0a0a10" stroke="#000" stroke-width="1.5"/><path d="M42 46 L52 46" stroke="#8ac8ff" stroke-width="2" opacity="0.8"/><path d="M68 46 L78 46" stroke="#8ac8ff" stroke-width="2" opacity="0.8"/>`,
    visor: `<rect x="38" y="42" width="44" height="11" rx="5" fill="#120606" stroke="#000" stroke-width="1.5"/><rect x="41" y="45" width="38" height="5" rx="2.5" fill="${eyeC}"/><rect x="41" y="45" width="38" height="5" rx="2.5" fill="${eyeC}" opacity="0.6" filter="blur(1px)"/>`,
    angry: `<ellipse cx="49" cy="49" rx="6" ry="4.5" fill="#fff" stroke="#000" stroke-width="1.5"/><ellipse cx="71" cy="49" rx="6" ry="4.5" fill="#fff" stroke="#000" stroke-width="1.5"/><circle cx="50" cy="50" r="2.4" fill="#000"/><circle cx="70" cy="50" r="2.4" fill="#000"/><path d="M40 40 L56 45 M80 40 L64 45" stroke="#000" stroke-width="3.5" stroke-linecap="round"/>`,
    glow: `<path d="M41 46 L56 49 L42 52Z M79 46 L64 49 L78 52Z" fill="${eyeC}" stroke="#000" stroke-width="1"/><circle cx="48" cy="49" r="6" fill="${eyeC}" opacity="0.25"/><circle cx="72" cy="49" r="6" fill="${eyeC}" opacity="0.25"/><path d="M40 41 L56 46 M80 41 L64 46" stroke="#000" stroke-width="3" stroke-linecap="round"/>`,
    cat: `<path d="M41 48 Q49 40 57 48 Q49 55 41 48Z M63 48 Q71 40 79 48 Q71 55 63 48Z" fill="${eyeC}" stroke="#000" stroke-width="1.5"/><path d="M49 43 L49 53 M71 43 L71 53" stroke="#000" stroke-width="2.4"/>`,
    goggles: `<path d="M34 46 L86 46" stroke="#3a2a1a" stroke-width="5"/><circle cx="49" cy="48" r="8" fill="${shade(eyeC, 0.5)}" stroke="#6a6a70" stroke-width="3"/><circle cx="71" cy="48" r="8" fill="${shade(eyeC, 0.5)}" stroke="#6a6a70" stroke-width="3"/><circle cx="46" cy="45" r="2.5" fill="#fff" opacity="0.8"/><circle cx="68" cy="45" r="2.5" fill="#fff" opacity="0.8"/>`,
  };
  p.push(eyes[f.eyes]);

  // boca
  const mouth: Record<Mouth, string> = {
    grin: `<path d="M44 68 Q60 80 76 68 Q60 74 44 68Z" fill="#fff" stroke="#000" stroke-width="2"/><path d="M50 69.5 L50 73 M56 71 L56 75 M62 71 L62 75 M68 70 L68 73.5" stroke="#000" stroke-width="1"/>`,
    smirk: `<path d="M48 70 Q58 74 72 66" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round"/>`,
    fangs: `<path d="M44 68 Q60 76 76 68 L74 72 Q60 80 46 72Z" fill="#3a0606" stroke="#000" stroke-width="2"/><path d="M49 70 L51 77 L53 71 M67 71 L69 77 L71 70" fill="#fff" stroke="#000" stroke-width="1"/>`,
    snarl: `<path d="M44 70 L76 70 L74 76 L46 76Z" fill="#fff" stroke="#000" stroke-width="2"/><path d="M50 70 L50 76 M56 70 L56 76 M62 70 L62 76 M68 70 L68 76 M44 73 L76 73" stroke="#000" stroke-width="1"/>`,
    grill: `<rect x="46" y="66" width="28" height="11" rx="2" fill="#1a1a20" stroke="#000" stroke-width="1.5"/><path d="M50 66 L50 77 M55 66 L55 77 M60 66 L60 77 M65 66 L65 77 M70 66 L70 77" stroke="${skinD}" stroke-width="1.5"/>`,
    skull: `<path d="M56 58 L60 64 L64 58Z" fill="#0a0a10"/><rect x="46" y="68" width="28" height="10" fill="#f4f4f0" stroke="#000" stroke-width="1.5"/><path d="M51 68 L51 78 M56 68 L56 78 M61 68 L61 78 M66 68 L66 78 M71 68 L71 78" stroke="#000" stroke-width="1"/>`,
  };
  p.push(mouth[f.mouth]);
  if (ex.has('tusks')) p.push(`<path d="M46 74 Q42 66 44 60 Q48 68 50 72Z M74 74 Q78 66 76 60 Q72 68 70 72Z" fill="#f4ecd0" stroke="#000" stroke-width="1.5"/>`);
  if (ex.has('scar')) p.push(`<path d="M72 36 L80 60" stroke="#6a1010" stroke-width="2.5"/><path d="M73 42 L78 40 M75 48 L80 46 M77 54 L82 52" stroke="#6a1010" stroke-width="1.5"/>`);
  if (ex.has('beard')) p.push(`<path d="M36 58 Q38 92 60 100 Q82 92 84 58 Q78 74 70 70 Q60 80 50 70 Q42 74 36 58Z" fill="${hairC}" stroke="#000" stroke-width="2"/><path d="M48 64 Q60 60 72 64" fill="none" stroke="${shade(hairC, 0.6)}" stroke-width="4" stroke-linecap="round"/>`);

  // cabelo da frente
  if (f.hair === 'mullet') p.push(`<path d="M34 42 Q34 12 62 14 Q88 16 86 42 Q80 30 70 32 Q62 24 52 32 Q42 28 34 42Z" fill="${hairC}" stroke="#000" stroke-width="2"/>`);
  if (f.hair === 'long') p.push(`<path d="M32 46 Q30 12 60 12 Q90 12 88 46 Q84 28 72 26 Q60 34 48 26 Q36 28 32 46Z" fill="${hairC}" stroke="#000" stroke-width="2"/>`);
  if (f.hair === 'mohawk') p.push(`<path d="M52 24 L50 2 L56 12 L60 -2 L64 12 L70 2 L68 24 Q60 20 52 24Z" fill="${hairC}" stroke="#000" stroke-width="2"/>`);
  if (f.hair === 'spikes') p.push(`<path d="M34 38 L26 18 L42 26 L40 6 L52 20 L60 0 L68 20 L80 6 L78 26 L94 18 L86 38 Q74 26 60 26 Q46 26 34 38Z" fill="${hairC}" stroke="#000" stroke-width="2"/>`);
  if (f.hair === 'crest') p.push(`<path d="M46 20 L40 4 L52 14 L56 0 L62 14 L70 2 L70 18 Q58 14 46 20Z" fill="${hairC}" stroke="#000" stroke-width="2"/>`);

  // capacete viking, antena, brinco
  if (ex.has('viking')) {
    p.push(`<path d="M34 40 Q34 10 60 10 Q86 10 86 40Z" fill="#9aa0aa" stroke="#000" stroke-width="2.5"/><path d="M32 40 L88 40 L88 46 L32 46Z" fill="#c8a040" stroke="#000" stroke-width="2"/>`);
    p.push(`<path d="M36 30 Q18 26 16 6 Q26 22 38 22Z M84 30 Q102 26 104 6 Q94 22 82 22Z" fill="#f0e8d0" stroke="#000" stroke-width="2"/><path d="M58 10 L62 10 L62 40 L58 40Z" fill="#c8a040" stroke="#000" stroke-width="1"/>`);
  }
  if (ex.has('antenna')) p.push(`<path d="M76 20 L86 2" stroke="#000" stroke-width="2.5"/><circle cx="86" cy="3" r="3.5" fill="${eyeC}" stroke="#000" stroke-width="1.5"/>`);
  if (ex.has('earring')) p.push(`<circle cx="${f.head === 'cat' ? 34 : 36}" cy="64" r="3.5" fill="none" stroke="#ffd84a" stroke-width="2"/>`);

  p.push(`</g><rect x="2" y="2" width="116" height="116" rx="14" fill="none" stroke="#000" stroke-width="3"/><rect x="4.5" y="4.5" width="111" height="111" rx="12" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>`);
  return `<svg class="portrait" viewBox="0 0 120 120" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${nameOrId.replace(/"/g, '')}">${p.join('')}</svg>`;
}
