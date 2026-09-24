import { decodeSave, encodeSave, PLANETS, DIVISIONS, type CampaignState } from '../sim/campaign';
import { CHARACTERS } from '../sim/garage';

/**
 * Jogo salvo e preferências no navegador. Tudo protegido: sem armazenamento, o jogo segue funcionando.
 * A campanha fica em SLOTS (como um cartucho com 3 saves); a senha continua existindo para levar o
 * progresso a outro aparelho.
 */
const LEGACY_KEY = 'rnrr3d-campaign-v1';
const PREFS = 'rnrr3d-prefs-v1';
const SLOT_KEY = (i: number) => `rnrr3d-slot-${i}`;
const ACTIVE_KEY = 'rnrr3d-active-slot';
export const SLOT_COUNT = 3;

export interface SlotInfo {
  slot: number;
  empty: boolean;
  /** quando foi salvo (ms) */
  savedAt: number;
  pilot: string;
  characterId: string;
  planet: string;
  division: string;
  money: number;
  vehicleId: string;
  color: number;
  champion: boolean;
}

interface SlotRecord {
  code: string;
  savedAt: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* modo privado ou armazenamento cheio: segue sem salvar */
  }
}

function readSlot(i: number): { state: CampaignState; savedAt: number } | null {
  const raw = read(SLOT_KEY(i));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as SlotRecord;
    const state = decodeSave(rec.code);
    return state ? { state, savedAt: rec.savedAt } : null;
  } catch {
    return null;
  }
}

/** Slot em uso (o último salvo/carregado); -1 se nenhum. */
export function activeSlot(): number {
  const raw = read(ACTIVE_KEY);
  // (Number(null) é 0: sem esta checagem, apagar o slot ativo fazia o slot 1 virar o ativo)
  if (raw === null || raw === '') return -1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < SLOT_COUNT && read(SLOT_KEY(n)) ? n : -1;
}

export function setActiveSlot(i: number): void {
  write(ACTIVE_KEY, String(i));
}

/** Resumo de cada slot para a tela de salvar/carregar. */
export function listSlots(): SlotInfo[] {
  migrateLegacy();
  return Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const s = readSlot(slot);
    if (!s) return { slot, empty: true, savedAt: 0, pilot: '', characterId: '', planet: '', division: '', money: 0, vehicleId: '', color: 0, champion: false };
    const st = s.state;
    return {
      slot,
      empty: false,
      savedAt: s.savedAt,
      pilot: CHARACTERS.find((c) => c.id === st.characterId)?.name ?? st.characterId,
      characterId: st.characterId,
      planet: PLANETS[st.planet]?.name ?? '?',
      division: DIVISIONS[st.division] ?? '?',
      money: st.money,
      vehicleId: st.car.vehicleId,
      color: st.color,
      champion: st.champion,
    };
  });
}

export function saveToSlot(i: number, s: CampaignState): void {
  write(SLOT_KEY(i), JSON.stringify({ code: encodeSave(s), savedAt: Date.now() } satisfies SlotRecord));
  setActiveSlot(i);
}

export function loadFromSlot(i: number): CampaignState | null {
  const s = readSlot(i);
  if (s) setActiveSlot(i);
  return s?.state ?? null;
}

export function deleteSlot(i: number): void {
  write(SLOT_KEY(i), null);
  if (read(ACTIVE_KEY) === String(i)) write(ACTIVE_KEY, null);
}

/** Primeiro slot vazio (ou -1 se todos ocupados). */
export function firstEmptySlot(): number {
  return listSlots().find((s) => s.empty)?.slot ?? -1;
}

/** Save antigo (antes dos slots) vira o slot 1. */
function migrateLegacy(): void {
  const code = read(LEGACY_KEY);
  if (!code) return;
  if (!read(SLOT_KEY(0)) && decodeSave(code)) {
    write(SLOT_KEY(0), JSON.stringify({ code, savedAt: Date.now() } satisfies SlotRecord));
    if (read(ACTIVE_KEY) === null) setActiveSlot(0);
  }
  write(LEGACY_KEY, null);
}

/** Slot salvo mais recentemente (-1 se todos vazios). */
export function latestSlot(): number {
  let best = -1;
  let at = -Infinity;
  for (const s of listSlots()) if (!s.empty && s.savedAt > at) (best = s.slot), (at = s.savedAt);
  return best;
}

/** Campanha do slot ativo (para "Continuar"); sem slot ativo (apagado), a salva mais recente. */
export function loadCampaign(): CampaignState | null {
  migrateLegacy();
  let i = activeSlot();
  if (i < 0) i = latestSlot();
  return i >= 0 ? loadFromSlot(i) : null;
}

/** Salvamento automático no slot ativo (ou no primeiro vazio, ou no 1). */
export function saveCampaign(s: CampaignState): void {
  let i = activeSlot();
  if (i < 0) i = firstEmptySlot();
  if (i < 0) i = 0;
  saveToSlot(i, s);
}

export function loadPrefs<T extends object>(defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function savePrefs(p: object): void {
  write(PREFS, JSON.stringify(p));
}
