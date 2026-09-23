# Rock 'n' Roll Racing 3D

Remake 3D de *Rock n' Roll Racing* para navegador (PC e celular). Plano completo em [PLANO.md](PLANO.md).

## Rodar

```bash
cd rock-n-roll-racing-3d
npm install
npm run dev      # abre em http://localhost:5173 — e na rede local, para testar no celular
npm test         # testes da simulação (pistas, física, voltas)
npm run build    # gera a versão estática em dist/
```

Para jogar no celular: rode `npm run dev` no PC e abra no celular o endereço "Network" que aparece
no terminal (mesmo Wi‑Fi). O `dist/` pode ser publicado em qualquer hospedagem estática.

## Modos

- **Campanha:** escolha um dos 6 pilotos, comece em Chem VI (Divisão B) com um Dirt Devil e
  suba até Inferno. Entre as corridas, a garagem mostra a próxima pista e os rivais; na loja você
  compra carros (com troca), melhorias e cargas extras de armas. O progresso é salvo no navegador
  e pode ser levado para outro aparelho com a **senha**.
- **Corrida rápida:** qualquer uma das 12 pistas, com qualquer carro.

## Música

- Sem nada configurado, toca uma **trilha de rock sintetizada** em tempo real (bateria, baixo e
  guitarra distorcida), com um tema por planeta.
- **No PC:** coloque arquivos (`.mp3`, `.ogg`, `.m4a`, `.wav`...) na pasta [`music/`](music/README.md)
  — eles entram no jogo automaticamente e não vão para o git.
- **No celular:** menu **⚙ Som e música → Adicionar músicas do aparelho**; os arquivos ficam
  guardados no navegador.
- Na mesma tela: liga/desliga música, efeitos e locutor, volume da música e "próxima música".

## Controles

| | Teclado | Controle | Celular |
|---|---|---|---|
| Acelerar | ↑ / W | RT ou A | ACEL |
| Frear / ré | ↓ / S | LT | FREIO |
| Virar | ← → / A D | analógico / direcional | ◀ ▶ |
| Arma frontal (laser/míssil) | Espaço / J | X / RB | TIRO |
| Arma traseira (mina/óleo) | X / K | B / LB | MINA / ÓLEO |
| Nitro | Shift | L3 / R3 | NITRO |
| Câmera (aérea → cockpit → perseguição) | C | Y | 🎥 |
| Pausa | Esc / P | Start | ❚❚ |
| Som liga/desliga | M | | |

Armas e nitro recarregam a cada volta, como no original. Parâmetros de URL para testes:
`?autopilot` (a IA pilota o seu carro) e `?laps=1` (corrida curta).

## Estrutura

- `src/sim/` — simulação pura e determinística (pista, física, voltas, armas, IA), sem Three.js:
  a mesma que rodará no servidor online. `world.ts` é o estado da corrida; `ai.ts` os pilotos da CPU.
- `src/render/` — pista, cenário, câmeras e pós-processamento, tudo gerado por código.
  `src/render/cars/` tem um modelo 3D por carro (buggy, muscle car, hovercraft, blindado de esteiras, cunha).
- `src/input/`, `src/ui/`, `src/audio/`, `src/core/` — controles, HUD/menus, som e loop do jogo.
