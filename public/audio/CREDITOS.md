# Créditos de áudio

Nenhum áudio do jogo original (1993) é usado. Os efeitos abaixo vêm de bancos com licença livre e
são tocados em camadas com síntese própria (`src/audio/sfx.ts`). Todos foram convertidos para MP3
mono, com silêncio aparado e volume normalizado.

## Efeitos (`sfx/`)

| Arquivo | Origem | Autor | Licença |
|---|---|---|---|
| explosao_crunch_a, explosao_crunch_b, explosao_curta_a, explosao_curta_b | Sci-Fi Sounds 1.0 (explosionCrunch_001, 004, 000, 002) | Kenney (kenney.nl) | CC0 1.0 |
| explosao_sub | Sci-Fi Sounds 1.0 (lowFrequency_explosion_000) | Kenney | CC0 1.0 |
| plasma_a, plasma_b, plasma_c | Sci-Fi Sounds 1.0 (laserLarge_001, 000, 003) | Kenney | CC0 1.0 |
| sundog | Sci-Fi Sounds 1.0 (forceField_000) | Kenney | CC0 1.0 |
| nitro, jato | Sci-Fi Sounds 1.0 (thrusterFire_001, 003, recortados) | Kenney | CC0 1.0 |
| batida_grave, mina_clunk | Sci-Fi Sounds 1.0 (impactMetal_001, 002) | Kenney | CC0 1.0 |
| oleo | Sci-Fi Sounds 1.0 (slime_000) | Kenney | CC0 1.0 |
| impacto_metal_a, impacto_metal_b | Impact Sounds 1.0 (impactMetal_heavy_000, 002) | Kenney | CC0 1.0 |
| impacto_placa, mureta | Impact Sounds 1.0 (impactPlate_heavy_001, 000) | Kenney | CC0 1.0 |
| batida_soco | Impact Sounds 1.0 (impactPunch_heavy_000) | Kenney | CC0 1.0 |
| explosao_cauda, missil_lancamento | "50 CC0 Sci-Fi SFX" (explosion_01, rocket_01), opengameart.org/content/50-cc0-sci-fi-sfx | rubberduck | CC0 1.0 |

- Kenney: https://kenney.nl/assets/sci-fi-sounds e https://kenney.nl/assets/impact-sounds
- CC0: https://creativecommons.org/publicdomain/zero/1.0/

## Motor (`motor/`)

| Arquivo | Origem | Autor | Licença |
|---|---|---|---|
| motor_lenta, motor_0, motor_1 | "Chevrolet Caprice (motor at different speeds & driving away)", https://freesound.org/people/romanholtwick/sounds/391671/ | romanholtwick | CC0 1.0 |

Trechos estáveis da gravação (marcha lenta ~650 rpm e ~870 rpm) recortados em loops sem emenda
audível; motor_1 é o loop de ~870 rpm 1,4x acima (ffmpeg rubberband, formantes preservados). Cada
loop toca no máximo ±25% fora do próprio tom: a gravação cobre a lenta e o giro baixo e, acima disso,
a síntese de ciclos de V8 do projeto assume (`src/audio/engine.ts`). Os rivais usam os mesmos loops.
(Gravações livres de motor em rotação alta testadas — Red Library/archive.org, BMW 120d, Opel Astra —
eram de motores e timbres diferentes ou só variações de tom do mesmo trecho.)

## Locutor (`locutor/`)

Falas geradas por **Chatterbox TTS** (Resemble AI, licença MIT, https://github.com/resemble-ai/chatterbox)
com exagero emocional alto (1,5–1,8; narrador de arena gritando), clonando uma referência de voz humana
de locutor de luta: `scripts/locutor/voz-referencia-arena.wav`, montada com falas do
**"Voice Pack | Fighting Game Announcer"** de **Alba MacKenna** (OpenGameArt,
https://opengameart.org/content/voice-pack%E2%94%82fighting-game-announcer), licença **CC-BY 4.0**
(https://creativecommons.org/licenses/by/4.0/). As falas do jogo são novas (sintetizadas), não trechos do pacote.
Vários takes por frase; cada um é conferido por transcrição (faster-whisper, MIT) e escolhido pela
entonação (faixa de F0 ≥ 12 semitons e mediana ≥ 150 Hz). Texto e
tratamento de arena (compressão, presença e eco curto) feitos pelo projeto (`scripts/locutor/gerar.py`).
Pós-tratamento (`scripts/locutor/tratar.py`, ffmpeg + rubberband): takes sem emoção descartados,
silêncio aparado, nomes graves afinados para cima, frases longas aceleradas e loudness igual (−18 LUFS).
As frases seguem o estilo do locutor do original, sem usar gravações dele.

## Música

Sem nada em `music/`, toca a trilha sintetizada do projeto (`src/audio/synthrock.ts`).
Músicas em `music/` são do próprio usuário e não vão para o repositório.
