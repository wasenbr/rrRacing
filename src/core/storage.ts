import { decodeSave, encodeSave, type CampaignState } from '../sim/campaign';

/** Save da campanha e preferências no navegador. Tudo protegido: sem armazenamento, o jogo segue funcionando. */
const KEY = 'rnrr3d-campaign-v1';
const PREFS = 'rnrr3d-prefs-v1';

export function loadCampaign(): CampaignState | null {
  try {
    const code = localStorage.getItem(KEY);
    return code ? decodeSave(code) : null;
  } catch {
    return null;
  }
}

export function saveCampaign(s: CampaignState): void {
  try {
    localStorage.setItem(KEY, encodeSave(s));
  } catch {
    /* modo privado ou armazenamento cheio: segue sem salvar */
  }
}

export function loadPrefs<T extends object>(defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS) ?? '{}') };
  } catch {
    return defaults;
  }
}

export function savePrefs(p: object): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}
