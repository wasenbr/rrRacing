---
name: rodada-avaliadores
description: Loop de melhoria do Rock 'n' Roll Racing 3D com avaliadores independentes e exigentes (visual, carros, jogabilidade, som, interface/celular). Use quando pedirem "rodada de melhorias", "submeta aos avaliadores", "/rodada-avaliadores" ou para continuar melhorando até todos aprovarem.
---

# Rodada de melhorias com avaliadores

Objetivo: um remake **fiel ao original** (identidade, pistas, carros, armas, campanha) com a
**qualidade 3D do Motor Rock**, e só parar quando **os cinco avaliadores aprovarem** na mesma rodada.

Referências (inspiração, nada entra no jogo):
- `referencias/original.md` — fatos do original (planetas, pistas, carros, armas, pontos, pilotos).
- `referencias/snes/` e `referencias/snes/mapas/` — telas e mapas das 36 pistas originais.
- `referencias/motor-rock/` — padrão de qualidade 3D (leia `referencias/README.md`).
- `referencias/modernizados/` — **alvo visual definido pelo usuário** (ver `referencias/README.md`):
  `como-jogo-deveria-ser.png` é o padrão de acabamento da cena (pista de placas metálicas com
  sujeira, bordas elevadas claras, iluminação dramática com vinheta escura, carros com pintura
  brilhante e reflexos); `air-blade.png` e `tank.webp` são o padrão dos modelos dos carros
  (mesma linha do pack de 5 carros do CCamuz3D no Cults3D: formas fiéis ao original, volumes
  arredondados e lisos, pneus grossos com cravos, esteiras segmentadas, cockpit escuro).
- `referencias/carros-original/` — sprites originais dos 5 carros (silhueta e cores).
- `referencias/feedback-usuario.md` — retorno do usuário. **Cada item é requisito**; o usuário é o
  juiz final. O loop segue sozinho entre rodadas; só pausar se o usuário pedir explicitamente para
  testar antes. Pedidos novos do usuário no meio do loop entram na rodada corrente.

## Loop

```
rodada = 1
repita:
  1. MELHORAR   aplicar as correções pendentes (na 1ª rodada: plano próprio a partir das referências)
  2. VERIFICAR  npm run typecheck && npm test   (tem que passar; senão corrigir antes de seguir)
  3. EVIDÊNCIAS reiniciar o `npm run dev` e rodar:
                node scripts/evidencias.mjs <scratchpad>/rN tudo
  4. AVALIAR    lançar os 5 avaliadores EM PARALELO (Agent, general-purpose, sempre agentes NOVOS
                a cada rodada, para não ficarem condescendentes). Prompt: seção "Avaliadores".
  5. DECIDIR    fim SÓ se os 5 avaliadores tiverem "aprovado": true, "nota" ≥ 8 e todos os
                critérios ≥ 8 (conferir os números; não aceitar nota < 8 mesmo com "aprovado": true).
                senão -> juntar os problemas (bloqueantes primeiro), rodada += 1, voltar ao passo 1
                         AUTOMATICAMENTE: corrigir as pendências e reavaliar sem parar para perguntar.
                         Não encerrar a resposta com pendências abertas só para relatar notas.
  limite: 8 rodadas.
  comandos longos (evidências completas levam vários minutos) sempre em segundo plano. Se atingir, parar e relatar ao usuário o que falta e por quê.
```

Registrar cada rodada em `referencias/rodadas.md`: notas de cada avaliador, problemas, o que foi feito.

### Evidências (scripts/evidencias.mjs)

Gera em `<pasta>`:
- `telas/` — menu e 6 corridas (câmeras aérea, perseguição e cockpit), largada e 2 momentos de corrida;
  `20_vitrine_*.png` se `game.showroom(angulo)` existir.
- `jogo.json` — corrida de 4 CPUs em cada pista (tempos, ultrapassagens, tiros, acertos, explosões,
  batidas, tempo parado) e dirigibilidade de cada carro (0–60, frenagem, grip).
- `som/` — WAV + espectrograma PNG de cada efeito, do motor acelerando, de cada música e de uma
  mixagem de corrida; `metricas.json` com pico, RMS, fator de crista, clipping e centroide espectral.
- `erros.txt` — erros de JavaScript na página.

Limitação: os avaliadores não ouvem. Som é julgado por espectrograma, métricas e leitura do código.
O render é por software (SwiftShader); lentidão nas capturas não é defeito do jogo.

## Avaliadores

Cinco agentes, um por área. Cada um recebe este prompt-base mais o foco da área:

> Você é um avaliador independente e EXTREMAMENTE exigente de um jogo de corrida de combate 3D
> para navegador (remake de Rock 'n' Roll Racing, em `C:\Projetos\rrRacing`). Sua área: **<ÁREA>**.
> Referências: fidelidade ao original em `referencias/original.md`, `referencias/snes/` e
> `referencias/snes/mapas/`; qualidade 3D do *Motor Rock* em `referencias/motor-rock/`.
> Leia `referencias/feedback-usuario.md` e confira CADA item que toca a sua área: item não
> atendido é problema "alto" (ou "bloqueante" se o usuário foi enfático).
> Evidências desta rodada em `<PASTA>`: abra os arquivos relevantes à sua área e leia o código
> relevante em `src/`. Não edite nada.
> Seja duro: aprove só se um fã do original reconhecer o jogo na hora E um jogador exigente achar
> o resultado comparável ou melhor que o Motor Rock na sua área. Não aprove por esforço, só por resultado visível/audível/jogável.
> Ignore lentidão do render por software e a mensagem de HUD que fica presa por causa do avanço
> rápido da simulação nas capturas.
> Responda SÓ com JSON:
> `{"area": "...", "nota": 0-10, "aprovado": bool, "criterios": [{"nome": "...", "nota": 0-10, "comentario": "..."}], "problemas": [{"gravidade": "bloqueante|alta|media|baixa", "descricao": "...", "evidencia": "arquivo", "sugestao": "correção concreta, com arquivo/função quando possível"}]}`
> Regra de aprovação: `aprovado` só é true se a nota geral E TODOS os critérios tiverem nota ≥ 8
> e não houver problema bloqueante ou alto. Nota abaixo de 8 em qualquer lugar = reprovado.

Focos:
- **Visual** — comparar com `referencias/modernizados/como-jogo-deveria-ser.png` (alvo do usuário); iluminação e cores de cada planeta, legibilidade da pista, bordas/muretas, cenário,
  efeitos (explosões, fumaça, faíscas, nitro), HUD (posição, armas, blindagem, minimapa), câmeras
  (aérea, perseguição, cockpit), menu. Telas em `telas/`.
- **Carros** — comparar com `referencias/modernizados/air-blade.png` e `tank.webp` (alvo do usuário) e com `referencias/carros-original/`; modelos 3D: silhueta, detalhes, proporção na tela, identidade de cada um dos 5 carros,
  armas visíveis, rodas/suspensão/animação, pintura e materiais; e se as diferenças de
  desempenho (`jogo.json` → handling, `src/data/vehicles.ts`) combinam com o visual.
- **Jogabilidade** — `jogo.json`, `src/sim/*`, `src/input/*`, HUD e feedback: sensação de controle,
  equilíbrio de armas, IA (disputa, ultrapassagens, agressividade), ritmo da corrida, pistas,
  recompensas, clareza do que acontece.
- **Interface e celular** — menus, loja e garagem (miniaturas de carros/pistas, retratos dos
  pilotos, barras de atributos que diferenciam os carros), salvar jogo em slots, seleção de
  dificuldade, botão de sair, controles de toque (armas à esquerda, acelerar sem soltar),
  tela cheia no celular, instalação como web app (manifest, service worker, ícones). Telas em
  `telas/` (incluindo as de celular, se houver) e código em `src/ui/*`, `src/input/*`, `index.html`, `public/`.
- **Som** — `som/metricas.json`, espectrogramas `som/*.png`, `src/audio/*`: motor (variação com
  rotação, corpo, nitro), impacto dos efeitos, mixagem (efeitos audíveis sobre a música, sem clipping),
  música (variedade, energia rock), locutor, espacialização.
- **Desempenho** (dentro de Interface e celular) — o jogo deve rodar liso em hardware simples:
  conferir níveis de qualidade, resolução dinâmica e que controles de toque só aparecem na corrida.

## Regras para quem implementa

- Gráficos gerados por código. Áudio: sintetizado ou de bancos com licença livre (CC0/CC-BY, com
  créditos em `public/audio/CREDITOS.md`); nunca rips do jogo original. Música do usuário vem de `music/`.
- Manter a simulação determinística e os testes passando; atualizar testes quando a regra mudar de propósito.
- Cuidar do celular: nada que derrube o desempenho no touch (`isTouchDevice`).
- Corrigir primeiro bloqueantes e altos; um problema só sai da lista quando o avaliador da rodada
  seguinte não o repetir.
