import { beforeEach, describe, expect, it } from 'vitest';
import { encodeSave, newCampaign } from '../sim/campaign';
import { activeSlot, deleteSlot, firstEmptySlot, latestSlot, listSlots, loadCampaign, loadFromSlot, loadPrefs, saveCampaign, savePrefs, saveToSlot, setActiveSlot } from './storage';

/** localStorage em memória (o vitest roda em node). */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('slots de save', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
  });

  it('salva, lista e carrega por slot; o salvamento automático vai para o slot ativo', () => {
    const a = newCampaign('jake', 0x2f7bff);
    const b = newCampaign('katarina', 0xe02828);
    saveToSlot(0, a);
    saveToSlot(2, b);
    expect(activeSlot()).toBe(2);
    expect(listSlots().map((s) => s.empty)).toEqual([false, true, false]);
    b.money = 777;
    saveCampaign(b);
    expect(loadFromSlot(2)?.money).toBe(777);
    expect(loadFromSlot(0)?.characterId).toBe('jake');
    expect(activeSlot()).toBe(0);
  });

  it('apagar o slot ativo: CONTINUAR passa ao save mais recente, ou some se não houver', () => {
    saveToSlot(0, newCampaign('jake', 0x2f7bff));
    saveToSlot(1, newCampaign('snake', 0xe02828));
    deleteSlot(1);
    expect(activeSlot()).toBe(-1);
    expect(loadCampaign()?.characterId).toBe('jake');
    deleteSlot(0);
    expect(loadCampaign()).toBeNull();
  });

  it('slot com senha inválida ou impossível aparece vazio', () => {
    const s = newCampaign('jake', 0x2f7bff);
    s.car.vehicleId = 'tanque';
    localStorage.setItem('rnrr3d-slot-1', JSON.stringify({ code: encodeSave(s), savedAt: 1 }));
    localStorage.setItem('rnrr3d-slot-2', '{lixo');
    expect(listSlots().map((x) => x.empty)).toEqual([true, true, true]);
  });

  it('save antigo (antes dos slots) vira o slot 1 e o slot ativo; não sobrescreve um slot 1 ocupado', () => {
    const old = newCampaign('snake', 0xe02828, 'hard');
    localStorage.setItem('rnrr3d-campaign-v1', encodeSave(old));
    expect(loadCampaign()?.characterId).toBe('snake');
    expect(activeSlot()).toBe(0);
    expect(localStorage.getItem('rnrr3d-campaign-v1')).toBeNull();
    expect(listSlots()[0].difficulty).toBe('hard');
    // com o slot 1 já ocupado, o save antigo é descartado (não apaga o jogo novo)
    localStorage.setItem('rnrr3d-campaign-v1', encodeSave(newCampaign('jake', 0x2f7bff)));
    expect(listSlots()[0].characterId).toBe('snake');
    expect(localStorage.getItem('rnrr3d-campaign-v1')).toBeNull();
  });

  it('slot ativo inválido ou apontando para slot vazio vale -1; o mais recente assume o CONTINUAR', () => {
    localStorage.setItem('rnrr3d-active-slot', '7');
    expect(activeSlot()).toBe(-1);
    localStorage.setItem('rnrr3d-active-slot', '');
    expect(activeSlot()).toBe(-1);
    setActiveSlot(1);
    expect(activeSlot()).toBe(-1); // slot 2 vazio
    const now = Date.now;
    try {
      Date.now = () => 1000;
      saveToSlot(2, newCampaign('jake', 0x2f7bff));
      Date.now = () => 2000;
      saveToSlot(0, newCampaign('snake', 0xe02828));
    } finally {
      Date.now = now;
    }
    expect(latestSlot()).toBe(0);
    localStorage.removeItem('rnrr3d-active-slot');
    expect(loadCampaign()?.characterId).toBe('snake');
    expect(activeSlot()).toBe(0);
  });

  it('sem slot livre: o salvamento automático sem slot ativo vai para o slot 1', () => {
    saveToSlot(0, newCampaign('jake', 0x2f7bff));
    saveToSlot(1, newCampaign('snake', 0xe02828));
    saveToSlot(2, newCampaign('katarina', 0xe02828));
    expect(firstEmptySlot()).toBe(-1);
    localStorage.removeItem('rnrr3d-active-slot');
    const c = newCampaign('tarquinn', 0x22aa22);
    saveCampaign(c);
    expect(loadFromSlot(0)?.characterId).toBe('tarquinn');
    expect(activeSlot()).toBe(0);
    // com slot livre, vai para ele
    deleteSlot(1);
    localStorage.removeItem('rnrr3d-active-slot');
    saveCampaign(newCampaign('jake', 0));
    expect(listSlots()[1].characterId).toBe('jake');
  });

  it('armazenamento indisponível: nada quebra (lista vazia, salvar ignora)', () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      ...fakeStorage(),
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
    } as Storage;
    expect(listSlots().every((s) => s.empty)).toBe(true);
    expect(() => saveCampaign(newCampaign('jake', 0))).not.toThrow();
    expect(loadCampaign()).toBeNull();
    expect(loadPrefs({ music: true })).toEqual({ music: true });
    expect(() => savePrefs({ music: false })).not.toThrow();
  });
});
