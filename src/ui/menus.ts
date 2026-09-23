import type { CameraMode } from '../render/cameras';
import {
  DIVISIONS, POINTS, PROMOTE_POINTS, RACES_PER_SEASON, type CampaignState, type OpponentSetup, type PlanetDef, type RaceOutcome,
} from '../sim/campaign';
import {
  CAR_PRICES, CHARACTERS, CHARGE_KINDS, chargePrice, MAX_EXTRA_CHARGES, MAX_UPGRADE, tradeInValue, UPGRADE_HELP, UPGRADE_KINDS, UPGRADE_LABEL,
  upgradePrice, type Character, type ChargeKind, type UpgradeKind,
} from '../sim/garage';
import type { Track, TrackDef } from '../sim/track';
import type { VehicleSpec } from '../sim/vehicle';
import { formatTime } from './hud';
import { drawTrack, trackTransform } from './trackMap';

export const WEAPON_LABEL = { laser: 'Laser', missile: 'Míssil', mine: 'Mina', oil: 'Óleo' } as const;
const CHARGE_LABEL: Record<ChargeKind, string> = { front: 'Arma frontal', rear: 'Arma traseira', nitro: 'Nitro' };
export const COLORS = [0x2f7bff, 0xe02828, 0x2fc840, 0xf2c318, 0xb040e0, 0xf0f0f0];
const CAMERAS: [CameraMode, string][] = [['iso', 'Vista aérea'], ['cockpit', 'Cockpit'], ['chase', 'Perseguição']];

const money = (n: number) => `$${n.toLocaleString('pt-BR')}`;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface QuickOptions {
  trackId: string;
  vehicleId: string;
  color: number;
}

export interface MenuActions {
  quickRace(o: QuickOptions): void;
  newCampaign(characterId: string, color: number): void;
  continueCampaign(): void;
  loadPassword(code: string): boolean;
  campaignRace(): void;
  openShop(): void;
  buyCar(id: string): void;
  buyUpgrade(kind: UpgradeKind): void;
  buyCharge(kind: ChargeKind): void;
  showPassword(): void;
  backToHub(): void;
  resume(): void;
  restart(): void;
  quit(): void;
  resultsContinue(): void;
  toMain(): void;
  setCamera(mode: CameraMode): void;
  openSettings(): void;
  closeSettings(): void;
  setAudio(key: 'music' | 'sfx' | 'announcer', on: boolean): void;
  setMusicVolume(v: number): void;
  addMusic(files: File[]): void;
  clearMusic(): void;
  skipTrack(): void;
}

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  announcer: boolean;
  musicVolume: number;
  bundled: number;
  user: number;
}

export interface ResultRow {
  place: number;
  name: string;
  color: string;
  time: number | null;
  kills: number;
  prize: number;
  money: number;
  me: boolean;
}

export interface HubData {
  state: CampaignState;
  planet: PlanetDef;
  track: Track;
  opponents: OpponentSetup[];
  spec: VehicleSpec;
  character: Character;
  vehicles: Record<string, VehicleSpec>;
}

export interface CampaignReport {
  outcome: RaceOutcome;
  pointsEarned: number;
  points: number;
  label: string;
}

function stat(label: string, value: number): string {
  return `<div class="stat"><span>${label}</span><i style="width:${Math.round(Math.min(1, value) * 100)}%"></i></div>`;
}

function pips(n: number, max: number): string {
  return `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

export class Menus {
  private el: HTMLElement;
  private camera: CameraMode = 'iso';
  private quick: QuickOptions = { trackId: 'chem6-1', vehicleId: 'marauder', color: COLORS[0] };
  private newChar = { characterId: CHARACTERS[0].id, color: COLORS[0] };
  private shopTab: 'cars' | 'upgrades' | 'weapons' = 'upgrades';
  private lastHub: HubData | null = null;
  private inCampaign = false;

  constructor(
    root: HTMLElement,
    private actions: MenuActions,
    private vehicles: Record<string, VehicleSpec>,
    private tracks: TrackDef[],
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overlay';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  setCameraChoice(mode: CameraMode): void {
    this.camera = mode;
  }

  private show(html: string): void {
    this.el.innerHTML = html;
    this.el.style.display = '';
    this.el.scrollTop = 0;
    this.refresh();
  }

  hideAll(): void {
    this.el.style.display = 'none';
  }

  private cameraPicker(): string {
    return `<div class="cams">${CAMERAS.map(([m, l]) => `<button class="cam" data-cam="${m}">${l}</button>`).join('')}</div>`;
  }

  private colorPicker(group: string): string {
    return `<div class="colors">${COLORS.map((c) => `<button class="color" data-color="${c}" data-group="${group}" style="background:${hex(c)}" aria-label="cor"></button>`).join('')}</div>`;
  }

  private carCard(v: VehicleSpec, extra = ''): string {
    const all = Object.values(this.vehicles);
    const max = (k: keyof VehicleSpec) => Math.max(...all.map((x) => x[k] as number));
    return `<b>${v.name}</b>
      ${stat('Velocidade', v.maxSpeed / max('maxSpeed'))}${stat('Aceleração', v.accel / max('accel'))}${stat('Aderência', v.grip / max('grip'))}${stat('Blindagem', v.armor / max('armor'))}
      <em>${WEAPON_LABEL[v.front]} + ${WEAPON_LABEL[v.rear]}</em>${extra}`;
  }

  /* ---------------- menu principal ---------------- */

  showMain(hasSave: boolean): void {
    this.inCampaign = false;
    this.show(`
      <div class="card">
        <h1>ROCK <span>'N'</span> ROLL<br/>RACING <em>3D</em></h1>
        <p class="sub">6 planetas · 12 pistas · 5 carros · armas e muito rock</p>
        <div class="main-buttons">
          ${hasSave ? `<button class="go" data-act="continue">CONTINUAR CAMPANHA</button>` : ''}
          <button class="${hasSave ? '' : 'go'}" data-act="new">Nova campanha</button>
          <button data-act="quick">Corrida rápida</button>
          <button data-act="password">Carregar senha</button>
          <button data-act="settings">⚙ Som e música</button>
        </div>
        ${this.helpBlock()}
      </div>`);
  }

  private helpBlock(): string {
    return `<details class="help">
      <summary>Controles</summary>
      <p><b>Teclado:</b> ↑/W acelera · ↓/S freia/ré · ←→/A D vira · Espaço/J atira · X/K arma traseira · Shift nitro · C câmera · Esc pausa · M som</p>
      <p><b>Controle:</b> RT acelera · LT freia · analógico vira · X/RB atira · B/LB arma traseira · L3/R3 nitro · Y câmera · Start pausa</p>
      <p><b>Celular:</b> botões na tela; 🎥 troca a câmera. Melhor com o aparelho deitado.</p>
      <p>Armas e nitro recarregam a cada volta. Dinheiro e blindagem aparecem pela pista.</p>
    </details>`;
  }

  /* ---------------- corrida rápida ---------------- */

  private showQuick(): void {
    this.show(`
      <div class="card">
        <h2>CORRIDA RÁPIDA</h2>
        <h3>Pista</h3>
        <div class="tracks">${this.tracks.map((t) => `<button class="trk" data-track="${t.id}"><b>${t.name}</b><small>${t.planet}</small></button>`).join('')}</div>
        <h3>Carro</h3>
        <div class="cars">${Object.values(this.vehicles).map((v) => `<button class="car" data-vehicle="${v.id}">${this.carCard(v)}</button>`).join('')}</div>
        <h3>Cor</h3>${this.colorPicker('quick')}
        <h3>Câmera inicial</h3>${this.cameraPicker()}
        <button class="go" data-act="quick-start">CORRER!</button>
        <button class="link" data-act="main">← Voltar</button>
      </div>`);
  }

  /* ---------------- nova campanha ---------------- */

  private showNewCampaign(): void {
    const bonusText = (c: Character) =>
      Object.entries(c.bonus)
        .map(([k, v]) => `${{ accel: 'Aceleração', topSpeed: 'Velocidade', cornering: 'Curvas', jumping: 'Saltos' }[k]} ${'+'.repeat(v)}`)
        .join(' · ');
    this.show(`
      <div class="card">
        <h2>NOVA CAMPANHA</h2>
        <p class="sub center">Comece em Chem VI, Divisão B, com um Dirt Devil e ${money(10000)}.
          Some ${PROMOTE_POINTS} pontos em ${RACES_PER_SEASON} corridas para subir de divisão (1º: ${POINTS[0]} · 2º: ${POINTS[1]} · 3º: ${POINTS[2]}).</p>
        <h3>Escolha seu piloto</h3>
        <div class="chars">${CHARACTERS.map((c) => `<button class="char" data-char="${c.id}"><b>${c.name}</b><small>${c.description}</small><em>${bonusText(c)}</em></button>`).join('')}</div>
        <h3>Cor do carro</h3>${this.colorPicker('new')}
        <button class="go" data-act="new-start">COMEÇAR</button>
        <button class="link" data-act="main">← Voltar</button>
      </div>`);
  }

  /* ---------------- garagem (hub da campanha) ---------------- */

  showHub(d: HubData, notice = ''): void {
    this.lastHub = d;
    this.inCampaign = true;
    const s = d.state;
    const div = DIVISIONS[s.division];
    const pct = Math.min(100, (s.points / PROMOTE_POINTS) * 100);
    const u = s.car.upgrades;
    this.show(`
      <div class="card wide">
        <div class="hub-head">
          <div><small>PLANETA</small><b>${d.planet.name}</b></div>
          <div><small>DIVISÃO</small><b>${div}</b></div>
          <div><small>CORRIDA</small><b>${s.race + 1}/${RACES_PER_SEASON}</b></div>
          <div><small>DINHEIRO</small><b class="gold">${money(s.money)}</b></div>
        </div>
        <div class="points"><span>Pontos: <b>${s.points}</b> / ${PROMOTE_POINTS} para subir</span><div class="bar"><i style="width:${pct}%"></i></div></div>
        ${notice ? `<div class="notice">${notice}</div>` : ''}
        <div class="hub-grid">
          <div class="panel">
            <h3>Próxima pista</h3>
            <canvas class="hub-map" width="240" height="170"></canvas>
            <p class="trk-name"><b>${d.track.def.name}</b> · ${d.track.def.laps} voltas${d.track.def.slime ? ' · poças de gosma' : ''}</p>
            <h3>Rivais</h3>
            <ul class="rivals">${d.opponents.map((o) => `<li><span class="dot" style="background:${hex(o.color)}"></span>${o.name} <small>${o.spec.name}</small></li>`).join('')}</ul>
          </div>
          <div class="panel">
            <h3>Seu carro</h3>
            <div class="mycar">${this.carCard(d.spec)}</div>
            <ul class="upg-list">
              ${UPGRADE_KINDS.map((k) => `<li>${UPGRADE_LABEL[k]} ${pips(u[k], MAX_UPGRADE)}</li>`).join('')}
            </ul>
            <p class="small-note">Piloto: <b>${d.character.name}</b> · ${d.spec.frontCharges}× ${WEAPON_LABEL[d.spec.front]} · ${d.spec.rearCharges}× ${WEAPON_LABEL[d.spec.rear]} · ${d.spec.nitroCharges}× nitro</p>
          </div>
        </div>
        <h3>Câmera</h3>${this.cameraPicker()}
        <button class="go" data-act="hub-race">CORRER!</button>
        <div class="row-buttons">
          <button data-act="shop">🛒 Loja</button>
          <button data-act="show-password">🔑 Senha</button>
          <button data-act="settings">⚙ Som</button>
          <button data-act="main">Menu</button>
        </div>
      </div>`);
    const canvas = this.el.querySelector<HTMLCanvasElement>('.hub-map');
    if (canvas) {
      const map = trackTransform(d.track, canvas.width, canvas.height, 12);
      drawTrack(canvas.getContext('2d')!, d.track, map, 6);
    }
  }

  /* ---------------- loja ---------------- */

  showShop(d: HubData, notice = ''): void {
    this.lastHub = d;
    const s = d.state;
    const tabs = `<div class="tabs">
      ${(['upgrades', 'weapons', 'cars'] as const).map((t) => `<button class="tab" data-tab="${t}">${{ upgrades: 'Melhorias', weapons: 'Armas', cars: 'Carros' }[t]}</button>`).join('')}
    </div>`;
    let body = '';
    if (this.shopTab === 'upgrades') {
      body = UPGRADE_KINDS.map((k) => {
        const price = upgradePrice(s.car, k);
        return `<div class="shop-row"><div><b>${UPGRADE_LABEL[k]}</b> ${pips(s.car.upgrades[k], MAX_UPGRADE)}<small>${UPGRADE_HELP[k]}</small></div>
          ${price === null ? '<span class="maxed">MÁXIMO</span>' : `<button class="buy" data-upgrade="${k}" ${price > s.money ? 'disabled' : ''}>${money(price)}</button>`}</div>`;
      }).join('');
    } else if (this.shopTab === 'weapons') {
      body = CHARGE_KINDS.map((k) => {
        const price = chargePrice(s.car, k);
        const label = k === 'front' ? `${CHARGE_LABEL[k]} (${WEAPON_LABEL[d.spec.front]})` : k === 'rear' ? `${CHARGE_LABEL[k]} (${WEAPON_LABEL[d.spec.rear]})` : CHARGE_LABEL[k];
        const total = k === 'front' ? d.spec.frontCharges : k === 'rear' ? d.spec.rearCharges : d.spec.nitroCharges;
        return `<div class="shop-row"><div><b>${label}</b> ${pips(s.car.charges[k], MAX_EXTRA_CHARGES)}<small>${total} cargas por volta · +1 por compra</small></div>
          ${price === null ? '<span class="maxed">MÁXIMO</span>' : `<button class="buy" data-charge="${k}" ${price > s.money ? 'disabled' : ''}>${money(price)}</button>`}</div>`;
      }).join('');
    } else {
      const trade = tradeInValue(s.car);
      body =
        `<p class="small-note">Ao trocar de carro, o atual (com melhorias) entra como parte do pagamento: <b>${money(trade)}</b>.</p>` +
        Object.values(this.vehicles)
          .map((v) => {
            const mine = v.id === s.car.vehicleId;
            const net = Math.max(0, CAR_PRICES[v.id].price - trade);
            return `<div class="shop-row car-row"><div class="car">${this.carCard(v, `<small>Preço: ${money(CAR_PRICES[v.id].price)}</small>`)}</div>
              ${mine ? '<span class="maxed">SEU CARRO</span>' : `<button class="buy" data-buycar="${v.id}" ${net > s.money ? 'disabled' : ''}>${money(net)}</button>`}</div>`;
          })
          .join('');
    }
    this.show(`
      <div class="card wide">
        <div class="shop-head"><h2>LOJA</h2><b class="gold">${money(s.money)}</b></div>
        ${notice ? `<div class="notice">${notice}</div>` : ''}
        ${tabs}
        <div class="shop-body">${body}</div>
        <button class="go" data-act="hub">← Voltar à garagem</button>
      </div>`);
  }

  /* ---------------- senha ---------------- */

  showPassword(code: string | null): void {
    const saving = code !== null;
    this.show(`
      <div class="card small">
        <h2>SENHA</h2>
        <p class="small-note">${saving ? 'Guarde esta senha para continuar em outro aparelho ou navegador.' : 'Cole aqui uma senha salva para continuar a campanha.'}</p>
        <textarea class="pw" rows="5" ${saving ? 'readonly' : ''} spellcheck="false">${saving ? esc(code) : ''}</textarea>
        <p class="pw-msg"></p>
        ${saving ? '<button class="go" data-act="copy-password">Copiar</button><button data-act="hub">Voltar</button>' : '<button class="go" data-act="load-password">Carregar</button><button data-act="main">Voltar</button>'}
      </div>`);
  }

  /* ---------------- som e música ---------------- */

  showSettings(a: AudioSettings): void {
    const toggle = (key: string, label: string, on: boolean) =>
      `<div class="shop-row"><div><b>${label}</b></div><button class="toggle ${on ? 'on' : ''}" data-toggle="${key}" data-on="${on ? 1 : 0}">${on ? 'LIGADO' : 'DESLIGADO'}</button></div>`;
    const total = a.bundled + a.user;
    this.show(`
      <div class="card small">
        <h2>SOM E MÚSICA</h2>
        ${toggle('music', 'Música', a.music)}
        <div class="shop-row"><div><b>Volume da música</b></div><input class="vol" type="range" min="0" max="100" value="${Math.round(a.musicVolume * 100)}"/></div>
        ${toggle('sfx', 'Efeitos sonoros', a.sfx)}
        ${toggle('announcer', 'Locutor', a.announcer)}
        <h3>Minhas músicas</h3>
        <p class="small-note">${
          total
            ? `${total} música(s): ${a.bundled} da pasta <code>music/</code> e ${a.user} escolhida(s) neste aparelho. Tocam em ordem aleatória.`
            : 'Nenhuma música sua — tocando a trilha de rock sintetizada (um tema por planeta). Escolha arquivos do aparelho ou coloque-os na pasta <code>music/</code> do projeto.'
        }</p>
        <input class="music-files" type="file" accept="audio/*" multiple hidden />
        <button data-act="pick-music">➕ Adicionar músicas do aparelho</button>
        ${a.user ? '<button data-act="clear-music">🗑 Remover músicas do aparelho</button>' : ''}
        ${total ? '<button data-act="skip-track">⏭ Próxima música</button>' : ''}
        <p class="pw-msg"></p>
        <button class="go" data-act="close-settings">Voltar</button>
      </div>`);
    const vol = this.el.querySelector<HTMLInputElement>('.vol')!;
    vol.addEventListener('input', () => this.actions.setMusicVolume(Number(vol.value) / 100));
    const files = this.el.querySelector<HTMLInputElement>('.music-files')!;
    files.addEventListener('change', () => {
      if (files.files?.length) {
        this.el.querySelector('.pw-msg')!.textContent = 'Guardando músicas…';
        this.actions.addMusic(Array.from(files.files));
      }
    });
  }

  /* ---------------- pausa e resultado ---------------- */

  showPause(): void {
    this.show(`
      <div class="card small">
        <h2>PAUSADO</h2>
        <button class="go" data-act="resume">Continuar</button>
        <button data-act="restart">Reiniciar corrida</button>
        <button data-act="settings">⚙ Som e música</button>
        <button data-act="quit">${this.inCampaign ? 'Voltar à garagem (corrida não conta)' : 'Menu principal'}</button>
      </div>`);
  }

  showResults(rows: ResultRow[], lapTimes: number[], report: CampaignReport | null): void {
    const best = lapTimes.length ? Math.min(...lapTimes) : 0;
    const me = rows.find((r) => r.me);
    const title =
      report?.outcome === 'champion' ? '🏆 CAMPEÃO!' : report?.outcome === 'promoted' ? 'PROMOVIDO!' : me && me.place === 1 ? 'VITÓRIA!' : 'RESULTADO';
    const campaignBlock = report
      ? `<div class="notice ${report.outcome}">
          ${report.outcome === 'champion' ? 'Você venceu a galáxia inteira! Lenda do rock.' : ''}
          ${report.outcome === 'promoted' ? `Subiu para: <b>${report.label}</b>` : ''}
          ${report.outcome === 'retry' ? `Não somou ${PROMOTE_POINTS} pontos. A temporada recomeça — melhore o carro na loja!` : ''}
          ${report.outcome === 'continue' ? `+${report.pointsEarned} pontos · total ${report.points}/${PROMOTE_POINTS}` : ''}
        </div>`
      : '';
    this.show(`
      <div class="card small results">
        <h2>${title}</h2>
        ${campaignBlock}
        <table>
          <tr><th>#</th><th>Piloto</th><th>Tempo</th><th>Abates</th><th>Prêmio</th></tr>
          ${rows
            .map(
              (r) => `<tr class="${r.me ? 'me' : ''}"><td>${r.place}º</td><td><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</td>
                <td>${r.time !== null ? formatTime(r.time) : '—'}</td><td>${r.kills}</td><td>${money(r.prize)}</td></tr>`,
            )
            .join('')}
        </table>
        ${lapTimes.length ? `<table>${lapTimes.map((t, i) => `<tr class="${t === best ? 'best' : ''}"><td>Volta ${i + 1}</td><td>${formatTime(t)}</td></tr>`).join('')}</table>` : ''}
        ${me ? `<p class="money">Ganho nesta corrida (prêmio + pista): <b>${money(me.money)}</b></p>` : ''}
        ${report ? '<button class="go" data-act="results-continue">Continuar</button>' : '<button class="go" data-act="restart">Correr de novo</button><button data-act="main">Menu principal</button>'}
      </div>`);
  }

  /* ---------------- eventos ---------------- */

  private refresh(): void {
    const sel = (selector: string, on: (el: HTMLElement) => boolean) => this.el.querySelectorAll<HTMLElement>(selector).forEach((b) => b.classList.toggle('sel', on(b)));
    sel('.cam', (b) => b.dataset.cam === this.camera);
    sel('.car[data-vehicle]', (b) => b.dataset.vehicle === this.quick.vehicleId);
    sel('.trk', (b) => b.dataset.track === this.quick.trackId);
    sel('.char', (b) => b.dataset.char === this.newChar.characterId);
    sel('.tab', (b) => b.dataset.tab === this.shopTab);
    sel('.color', (b) => Number(b.dataset.color) === (b.dataset.group === 'new' ? this.newChar.color : this.quick.color));
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('button');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.cam) {
      this.camera = d.cam as CameraMode;
      this.actions.setCamera(this.camera);
    }
    if (d.vehicle) this.quick.vehicleId = d.vehicle;
    if (d.track) this.quick.trackId = d.track;
    if (d.char) this.newChar.characterId = d.char;
    if (d.color) {
      if (d.group === 'new') this.newChar.color = Number(d.color);
      else this.quick.color = Number(d.color);
    }
    if (d.tab && this.lastHub) {
      this.shopTab = d.tab as typeof this.shopTab;
      this.showShop(this.lastHub);
      return;
    }
    if (d.toggle) this.actions.setAudio(d.toggle as 'music' | 'sfx' | 'announcer', d.on !== '1');
    if (d.upgrade) this.actions.buyUpgrade(d.upgrade as UpgradeKind);
    if (d.charge) this.actions.buyCharge(d.charge as ChargeKind);
    if (d.buycar) this.actions.buyCar(d.buycar);

    switch (d.act) {
      case 'continue':
        return this.actions.continueCampaign();
      case 'new':
        return this.showNewCampaign();
      case 'new-start':
        return this.actions.newCampaign(this.newChar.characterId, this.newChar.color);
      case 'quick':
        return this.showQuick();
      case 'quick-start':
        return this.actions.quickRace({ ...this.quick });
      case 'password':
        return this.showPassword(null);
      case 'show-password':
        return this.actions.showPassword();
      case 'copy-password': {
        const ta = this.el.querySelector<HTMLTextAreaElement>('.pw')!;
        ta.select();
        void navigator.clipboard?.writeText(ta.value).catch(() => document.execCommand('copy'));
        this.el.querySelector('.pw-msg')!.textContent = 'Copiada!';
        return;
      }
      case 'load-password': {
        const ok = this.actions.loadPassword(this.el.querySelector<HTMLTextAreaElement>('.pw')!.value);
        if (!ok) this.el.querySelector('.pw-msg')!.textContent = 'Senha inválida.';
        return;
      }
      case 'hub-race':
        return this.actions.campaignRace();
      case 'shop':
        return this.actions.openShop();
      case 'hub':
        return this.actions.backToHub();
      case 'main':
        return this.actions.toMain();
      case 'resume':
        return this.actions.resume();
      case 'restart':
        return this.actions.restart();
      case 'quit':
        return this.actions.quit();
      case 'results-continue':
        return this.actions.resultsContinue();
      case 'settings':
        return this.actions.openSettings();
      case 'close-settings':
        return this.actions.closeSettings();
      case 'pick-music':
        this.el.querySelector<HTMLInputElement>('.music-files')?.click();
        return;
      case 'clear-music':
        return this.actions.clearMusic();
      case 'skip-track':
        return this.actions.skipTrack();
    }
    this.refresh();
  }
}
