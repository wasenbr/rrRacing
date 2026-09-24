# Handoff — Rodada 8

Para quem continuar: rode `/rodada-avaliadores` e use esta lista como passo 1 (MELHORAR).
Contexto completo da rodada 7 em `referencias/rodadas.md`; requisitos do usuário em
`referencias/feedback-usuario.md` (itens 1–54). Regras da skill valem (processos pesados em Idle,
simulação determinística, `npm run typecheck && npm test` passando).

## Estado ao encerrar a rodada 7

- Commit `eda0b7b` tem tudo até o início da rodada 7. Depois dele, **não commitado**: pré-geração de
  retratos/miniaturas (`src/ui/portraits.ts`, `src/ui/menus.ts`, `src/style.css`), skill em grupos
  (`.claude/skills/rodada-avaliadores/SKILL.md`), itens 53–54 no feedback, registro da rodada 7 e
  este arquivo.
- Item 53 feito no fim da rodada 7: `public/audio/locutor/start_2.mp3` regravado ("Let the CARNAGE...
  BEGIN!!", voz `voz-referencia-arena.wav`, exagero 1,75, cfg 0,3; F0 mediano 268→207 Hz, acento de
  volume 2,9→6,3 dB). Escolhido só por números: o usuário deve ouvir e confirmar. Takes em
  `.tts/takes-carnage/`.
- Dev server: `npm run dev` (conferir a porta; na rodada 7 foi 5175). Aquecer com uma requisição antes
  de `node scripts/evidencias.mjs <scratchpad>/r8 tudo http://localhost:<porta>/`.

## Grupos a chamar na rodada 8

Todos reprovaram na rodada 7, então todos voltam: Aparência (Visual, Carros), Jogo (Jogabilidade,
Pistas, Campanha), Plataforma (Interface, Desempenho), Som, Online e QA.

## Correções, por prioridade

### 1. Bloqueantes

- **Online — XSS pela cor do convidado.** `src/core/game.ts` hostJoin (~1296): aceitar `m.color` só
  se `Number.isInteger(m.color) && COLORS.includes(m.color)`, senão a primeira cor livre. No convidado,
  validar `net.players` vindo do host. `src/ui/menus.ts` sala online (~938) e `carImg`: passar cor e
  chave `data-thumb` por `esc()`.
- **Som — item 53**: só confirmar com o usuário se o novo `start_2.mp3` ficou bom (ver "Estado").

### 2. Altas — pedidos do usuário ainda falhando

- **Curva freando (itens 38/41)** — `src/sim/vehicle.ts` stepVehicle: derrapagem forte só com
  `input.sharp` ou esterço segurado > ~0,4 s; ao alinhar a lateral, girar o vetor de velocidade para o
  bico (perda máx. ~5–8% numa curva de 90°) em vez de só amortecer `vl`; rampa de esterço ~6–8/s para
  entrada digital (teclado/toque). Meta: Dirt Devil em curva de 90° com esterço total perde ≤ 8%.
- **Câmera aérea vai e volta (item 40)** — `src/render/cameras.ts` modo iso: antecipação máx. 4–5 m,
  seguida a ~0,6/s, pela direção da pista (`track.pointAtDist`) e não pela velocidade; no celular,
  manter o carro fora da área do HUD/minimapa.
- **Volante relativo ao dedo (item 46, sem quebrar o 47)** — `src/input/controls.ts`
  createTouchControls/setFrom: centro = X do pointerdown; se pousar a > 25% do centro da faixa, esterça
  logo para aquele lado; inverte ao cruzar ±10 px do ponto de apoio; `navigator.vibrate(8)` na troca.
  Tiro por deslize só ≥ 1,0 × altura da faixa acima (hoje 0,35).
- **Rolagem dos menus (item 54)** — `src/ui/menus.ts` fillThumbs/warmThumbs: uma miniatura por
  `requestIdleCallback` checando `deadline.timeRemaining() > 8`, pausar durante `scroll` (debounce
  150 ms); não cancelar warmThumbs ao trocar de menu; pré-gerar também pistas (todas as abas),
  planetas 32/48/72, carros `transparent` 96 e as 6 cores; `toBlob` + `createObjectURL` no lugar de
  `toDataURL` (`src/render/thumbnails.ts`, `planetThumbs.ts`, `src/ui/trackThumb.ts`); trocar cor/planeta
  atualiza só o `src`/a linha, sem refazer o menu. Em `portraits.ts`: `revokeObjectURL` do SVG após o PNG
  e aquecer os tamanhos 48/56/64/72/76.
- **Som picotando (47/50) — medir e aliviar** — em `scripts/evidencias.mjs`, gravar a saída real da
  corrida com CPU 4x lenta e contar descontinuidades/buracos > 2 ms; registrar `baseLatency`,
  `outputLatency` e longtasks. No toque/nível baixo: convolver da trilha → delay ou IR 0,4 s mono
  (`src/audio/synthrock.ts`), `oversample 'none'`, um compressor só, 1 rival; motor com um loop de ruído
  compartilhado e camadas de peso ~0 desligadas (`src/audio/engine.ts`).

### 3. Altas — estabilidade e desempenho

- **Vazamento de GPU** — `src/core/game.ts` createRace (~515–534): `traverse` + `dispose` de geometria e
  material dos carros antigos (sem liberar texturas em cache) e do material da sombra de contato; não
  recriar a corrida em toHub se pista e carros não mudaram. `src/render/effects.ts`: materiais/geometrias
  de projétil (sundog, LEDs de mina/scatter) compartilhados; criar `Effects.reset()` (limpa
  projectiles/hazards/pickups) e chamar em createRace — hoje poças de uma pista reaparecem em outra.
  `src/render/environment.ts`: dispose do render target do PMREM e da esfera.
- **Carregar senha sobrescreve o slot ativo** — `game.ts` (~1051) / `storage.ts`: escolher slot com
  confirmação. Também: apagar o slot ativo zera `this.campaign`; CONTINUAR se atualiza após apagar;
  confirmar Substituir e Nova campanha sobre slot ocupado; `decodeSave` valida personagem, veículo,
  planeta, divisão, melhorias e cargas.
- **Áudio após pausa/aba oculta** — `visibilitychange`: `ctx.suspend()`/`ctx.resume()`; `unlockAudio()`
  em resume/restart/quit; tratar estado `interrupted` do iOS. Zerar `idleDt`/accumulator ao sair da pausa.
- **WebGL context lost/restored** — pausar com aviso; ao restaurar, refazer `buildEnvironment`,
  `shadowMap.needsUpdate` e redraw.
- **Desempenho** — `src/render/quality.ts`/`game.ts`: médio do toque com piso 0,75 (hoje começa no piso);
  Apple no toque → médio com maxPixelRatio 2; trava 30 e queda automática de nível (flashLights → sombra →
  partículas) para todos os níveis; resolução dinâmica medindo só quadros desenhados (tempo de
  step+render contra o orçamento), depois do limitador; w/h guardados no resize (tirar `clientWidth` do
  render e do minimapa); reduzir alocações por quadro (HudData, sort, Set em syncMap, `Math.min(...)`);
  modo bateria sem `getBattery` (opção "Economia de bateria").

### 4. Altas — conteúdo

- **Campanha** — `src/sim/garage.ts`/`src/data/vehicles.ts`: o máximo de cada carro supera o do anterior
  (Dirt Devil < Marauder ≈ Air Blade < Battle Trak < Havac), com teste; Havac com "Estabilizadores" no
  lugar de pneus/amortecedores. `src/sim/campaign.ts`: nível dos rivais por tier
  `[0,0,1,1,1,2,2,2,2,3,3,3]`, cargas e agressividade crescendo por planeta; peças nível 3 só a partir de
  Bogmire/Nho; teste de economia (Havac no máximo só perto de Inferno). Compra de carro com confirmação e
  texto correto. Tela de campeão (`Menus.showChampion`: estatísticas, rota completa, locutor, recompensa);
  após campeão, voltar à garagem e não ao menu.
- **Pistas** — `scripts/pistas/`: relevo por pista (`relevo.json`: casa → U/D/J/B/>/<, minas/pickups)
  transcrito de `referencias/snes/mapas/`, sorteio só como fallback; começar por uma pista de cada
  planeta. Cor do piso fiel ao tema (poeira ≤ 15%, `trackStyle.ts`/`textures.ts`): Chem VI escuro com
  grade vermelha, New Mojave verde-oliva com borda amarela, Nho grade azul, Inferno escuro.
- **Visual** — `src/render/effects.ts` explosion(): clarão menor, núcleo colorido, decal queimado ~8 s,
  fumaça escura 3–4 s, destroços maiores; poças com textura (borda irregular, bolhas, normal, reflexo).
  Cockpit do Havac: anel/esfera do Sundog na lista `visual.cabin` escondida no cockpit. Faixa "VOLTA"
  abaixo do retrovisor. HUD zerado e câmera encaixada na largada. Nho com identidade (metal azulado com
  geada, neve fora da pista, cenário de gelo).
- **Interface** — barras de atributos normalizadas entre os 5 carros (2–10 segmentos) com FORTE/FRACO
  sempre (item 13); miniaturas das armas com o card dos carros; versão sem `+` fora do dev.

### 5. Online (altas restantes)

Sanitizar o comando do convidado no host (clamp de steer/throttle, booleanos, limite de tamanho/taxa);
ping a cada 1 s e queda aos 8 s; convidado oculto manda input vazio e o host zera após 500 ms; fila de
snapshots limitada; host oculto continua a simulação fora do rAF; previsão do carro do convidado com
reconciliação; buffer de interpolação de ~100 ms; largada com "pronto"; `/api/turn` com Origin e rate
limit (`worker/index.ts`); broadcast só para peers aceitos.

### 6. Médias e baixas

Ver a lista completa da rodada 7 em `referencias/rodadas.md` (mureta punitiva, munição que acaba em
20 s, suspensão real dos carros, Air Blade/Battle Trak na vitrine, carros caros mais lentos, efeitos de
óleo/queda fracos, clipping da mix a −0,2 dBFS, calendário da divisão, apresentação de planeta etc.).
