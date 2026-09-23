# Rock 'n' Roll Racing 3D — Plano de Desenvolvimento

Remake em 3D do clássico *Rock n' Roll Racing* (SNES/Mega Drive, 1993), mantendo a
dinâmica original (corrida de combate, 4 carros, armas, dinheiro, upgrades, planetas e
divisões) com duas câmeras principais:

- **Vista aérea / isométrica** — fiel ao original (câmera ortográfica em ~45°, seguindo o carro).
- **Cockpit** — primeira pessoa, de dentro do carro.
- (Bônus, custo baixo) **Terceira pessoa / chase cam** atrás do carro.

> Este projeto é independente do pacote `vandium` que está na raiz do repositório.
> Tem seu próprio `package.json` e não altera nada fora desta pasta.

## Decisões tomadas

- **Uso pessoal**, não comercial → mantemos nomes, carros, planetas e personagens originais.
- **Plataforma:** navegador, no **PC e no celular** (controles de toque na tela).
- **Multiplayer online fica para a v2.** A simulação já é separada da renderização e
  trabalha só com `ControlInput` por passo fixo — é exatamente o que o servidor vai trocar no online.
- **Visual:** 3D mais realista, **tudo gerado por código** (sem modelos externos):
  materiais PBR, reflexos, tone mapping ACES, sombras e bloom no PC.
- **Pistas:** o mais fiéis possível às originais.

---

### Estilo visual (revisado)
- Carros pequenos em pistas largas (pista de 13 m, carros em escala 0,8), como no original.
- Câmera isométrica clássica 2:1 da pixel art (30° de elevação), mostrando as laterais dos blocos.
- Visual **realista inspirado no original** (não pixel art): materiais PBR com relevo procedural,
  reflexos do céu de cada planeta, líquidos refletivos e sombras de contato.
- Referências de imagem do original ainda não puderam ser consultadas daqui (sites bloqueados);
  capturas de tela em `referencias/` ajudariam a afinar cores e proporções.

## 1. Stack técnica proposta

| Item | Escolha | Motivo |
|---|---|---|
| Plataforma | Navegador (desktop), exportável depois para desktop via Electron/Tauri | Roda em qualquer lugar, sem instalação, fácil de testar |
| Linguagem | TypeScript | Tipagem ajuda muito em lógica de jogo |
| Build | Vite | Hot reload rápido |
| Render 3D | Three.js | Maduro, leve, ótimo para câmera ortográfica + perspectiva |
| Física | Física *arcade* própria, determinística, passo fixo de 60 Hz | Carros do RnRR não são simulação; precisam de controle "arcade" responsivo — e determinismo facilita o online |
| Áudio | Web Audio API (via Howler.js) | Música, efeitos, locutor |
| Entrada | Teclado + Gamepad API | Split‑screen local com 2 controles |
| Testes | Vitest (lógica: regras de corrida, economia, IA) | |

## 2. Estrutura de pastas

```
rock-n-roll-racing-3d/
├── index.html
├── package.json
├── vite.config.ts
├── public/
│   ├── models/        # carros, peças de pista, props (glTF)
│   ├── textures/
│   ├── audio/         # música, sfx, falas do locutor
│   └── tracks/        # pistas em JSON (tile-based)
└── src/
    ├── main.ts
    ├── core/          # game loop, estado, eventos, tempo fixo
    ├── render/        # cena, câmeras (iso, cockpit, chase), luz, partículas
    ├── physics/       # veículo arcade, colisões, rampas/saltos
    ├── track/         # formato de pista, gerador de malha, checkpoints, linha de corrida
    ├── vehicles/      # definições dos carros e upgrades
    ├── weapons/       # arma frontal, arma traseira, nitro, dano
    ├── ai/            # pilotos da CPU
    ├── race/          # regras: voltas, posições, dinheiro na pista, resultados
    ├── campaign/      # planetas, divisões, pontos, loja, personagens
    ├── ui/            # menus, HUD, minimapa, loja
    ├── audio/         # música, locutor, sfx
    └── input/         # teclado, gamepad, mapeamento por jogador
```

## 3. Mecânicas a reproduzir (fiéis ao original)

### Corrida
- 4 carros por corrida (1–2 humanos + CPU), normalmente 4 voltas.
- Pista com rampas, saltos, lombadas, curvas inclinadas, poças de óleo/lama, abismos (cair = reaparece, perde tempo).
- **Dinheiro e bônus espalhados na pista** (pegar dá dinheiro extra; itens de armadura/reparo).
- Carro destruído explode e reaparece após alguns segundos.
- Colocação final dá dinheiro + pontos; pontos acumulados liberam a próxima divisão/planeta.

### Combate (3 slots, cargas limitadas por volta)
- **Arma frontal**: laser/plasma, mísseis, *sundog* etc. (varia por carro).
- **Arma traseira**: minas, mancha de óleo, *scatter pack*.
- **Nitro / boost**: impulso; alguns carros com salto (*jump jets*).
- Cargas recarregam a cada volta; upgrades aumentam cargas.

### Carros (5, como no original)
| Carro | Perfil |
|---|---|
| Dirt Devil | Buggy inicial, barato, fraco |
| Marauder | Equilibrado, bom em curvas |
| Air Blade | Hovercraft, rápido, derrapa muito |
| Battle Trak | Esteiras, pesado, resistente |
| Havac | Topo de linha, mais rápido e armado |

Upgrades por carro: **motor, pneus, suspensão, blindagem** + cargas de armas/nitro. Cores personalizáveis.

### Campanha (implementada)
- Temporadas de 4 corridas; pontos 10/6/3/0; 24 pontos sobem de divisão (B → A → próximo planeta).
  Sem pontos suficientes, a temporada recomeça (dinheiro e carro continuam).
- Começa com Dirt Devil e $10.000; prêmios crescem a cada planeta/divisão; rivais ganham carros
  e melhorias melhores (curva de dificuldade calibrada por simulação).
- Save automático no navegador + "senha" exportável para continuar em outro aparelho.

### Campanha (visão original)
- 6 planetas (Chem VI, Drakonis, Bogmire, New Mojave, Nho, Inferno), cada um com visual e
  perigos próprios (gelo, lava, pântano, deserto…).
- Divisões B → A em cada planeta; pontuação mínima para avançar.
- Pilotos jogáveis com bônus de atributos; rivais da CPU com personalidade (um "chefe" por planeta).
- Loja entre corridas: comprar carro novo, upgrades, armas.
- Senha/Save (salvar no `localStorage`, com exportação de save).

### Apresentação
- Locutor narrando eventos ("…is on fire!", "…has been blasted!") — ver pergunta sobre áudio.
- Trilha de rock pesado.
- HUD: posição, volta, dinheiro, cargas das armas, dano, **minimapa** (essencial no cockpit).

## 4. As câmeras — detalhes de design

**Isométrica (padrão):** `OrthographicCamera` com ângulo fixo ~35°/45°, rotação fixa (como o
original — o jogador *não* gira a câmera), segue o carro com antecipação na direção do movimento.
Em split-screen cada jogador tem seu viewport. Objetos que tapam o carro ficam semitransparentes.

**Cockpit:** `PerspectiveCamera` na posição do piloto com FOV ~75°, painel 3D simples
(volante, velocímetro, luzes de armas), leve *head-bob* nos saltos e tremida ao ser atingido.
Como as pistas originais foram pensadas para visão de cima, o modo cockpit precisa de:
- guard‑rails e placas de curva visíveis;
- setas de direção e sinalização de saltos;
- retrovisor (render‑to‑texture) para ver quem vem atrás e a arma traseira;
- minimapa sempre visível.

**Chase:** câmera com mola atrás do carro (bônus, reaproveita tudo).

Troca de câmera a qualquer momento (tecla `C` / botão do controle).

## 5. Sistema de pistas

As pistas do original são grades de blocos isométricos com altura. Vamos usar o mesmo conceito:

- Pista = **grade de tiles** em JSON: `{ tipo, rotação, altura, tema, perigo }`.
- Tipos: reta, curva, rampa ↑/↓, salto, lombada, curva inclinada, cruzamento, ponte, largada.
- Um **gerador** transforma o JSON em malha 3D + colisores + checkpoints + linha de corrida da IA.
- Implementado: peças `F S L R U D J B` (largada, reta, curvas, rampas, salto, lombadas) em
  `src/sim/track.ts`; teste automático garante que todo circuito fecha.

### Fidelidade às pistas originais
Para reproduzir o traçado exato de cada pista preciso dos mapas de referência. Os sites de mapas
(ex.: vgmaps.de, que tem todas as pistas do SNES) estão bloqueados no ambiente onde eu trabalho.
Caminho proposto:
1. Salvar os mapas/capturas das pistas em `rock-n-roll-racing-3d/referencias/` (ex.: `chem6-1.png`).
2. Eu converto cada mapa na sequência de peças e confiro a forma pelo minimapa.
3. O editor de pistas (fase 7) permite ajustes finos visuais.
Enquanto isso há 12 pistas provisórias (2 por planeta) no estilo de cada planeta, todas
validadas por teste (circuito fecha e a CPU completa voltas).
- **Editor de pistas no navegador** (grade 2D clicável) para recriar as pistas rapidamente a
  partir de mapas/capturas do original e criar novas.
- Cada planeta tem ~ 7–8 pistas no original; começamos por Chem VI completo.

## 6. IA dos oponentes
- Segue a linha de corrida (spline gerada pela pista) com variação por personalidade.
- Decide atirar se houver alvo no cone frontal; solta minas quando alguém está colado atrás.
- Usa nitro em retas; *rubber-band* leve ajustável pela dificuldade.
- Rivais "chefes" mais agressivos e com carros melhores.

## 7. Arte e áudio
- Estilo **low‑poly estilizado** com cores fortes (fiel ao clima do original, viável para uma
  equipe pequena). Modelos em glTF, feitos no Blender ou gerados proceduralmente no início.
- Protótipo usa formas geométricas simples; arte final entra depois que a jogabilidade estiver boa.

## 8. Fases de desenvolvimento (entregas incrementais)

| # | Entrega | Resultado jogável |
|---|---|---|
| 0 ✅ | Setup Vite + TS + Three.js, loop de jogo com passo fixo | Tela com cena 3D |
| 1 ✅ | Física arcade de 1 carro + pista de teste + **3 câmeras** + toque no celular | Dirigir e alternar iso/cockpit/chase |
| 2 ✅ | Formato de pista em tiles + gerador + rampas/saltos + checkpoints/voltas | Correr voltas cronometradas |
| 3 ✅ | 3 oponentes de IA (Rip, Shred, Viper Mackay) + posições + tela de resultado | Corrida completa de 4 carros |
| 4 ✅ | Armas (laser/míssil, mina/óleo, nitro), dano, explosão, respawn, dinheiro e blindagem na pista, locutor | Corrida de combate |
| 5 ✅ | Os 5 carros + melhorias (motor, pneus, suspensão, blindagem) + cargas extras + loja com troca | Loop corrida → loja → corrida |
| 6 ✅ | Campanha: 6 planetas × Divisões B/A, pontos, 6 pilotos, save automático + senha | Jogo completo de ponta a ponta |
| 7 | Pistas de todos os planetas + editor de pistas | Conteúdo completo |
| 8 ✅ | HUD, minimapa, retrovisor, locutor, música (trilha sintetizada + músicas do jogador), menus, 5 modelos de carro | Apresentação |
| 9 | Split‑screen 2 jogadores + gamepad | Multiplayer local |
| 10 | Arte final, efeitos, otimização, build desktop | Versão 1.0 |

As fases 0–4 formam o **protótipo vertical** (uma pista de Chem VI jogável com combate e as
duas câmeras) — é a melhor forma de validar a sensação do jogo antes de produzir conteúdo.

## 9. Riscos e cuidados
- **Propriedade intelectual:** projeto de uso pessoal. As músicas originais (Paranoid, Born to Be
  Wild, Highway Star...) não podem ser incluídas no repositório; o jogo vai aceitar arquivos de
  música que você coloque localmente em `public/audio/music/`.
- **Cockpit em pistas feitas para visão aérea** pode ficar confuso → sinalização, retrovisor e
  minimapa já previstos; possível ajuste de largura das pistas.
- **Física arcade** exige muita iteração de "sensação" → fase 1 dedicada só a isso.
