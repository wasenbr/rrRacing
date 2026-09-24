import { beforeEach, describe, expect, it } from 'vitest';
import { encodeSave, newCampaign } from '../sim/campaign';
import { activeSlot, deleteSlot, listSlots, loadCampaign, loadFromSlot, saveCampaign, saveToSlot } from './storage';

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
});
