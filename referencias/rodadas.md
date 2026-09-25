# Rodada 3 (2026-09-23)

Pedido do usuário: ronco irritante, salto/física estranhos, carros não lembram o original
(+ referências em `referencias/modernizados/`).

Feito:
- Motor refeito (sem serra/ressonância; depois de o avaliador apontar subgrave, faixa 55–230 Hz,
  corpo em 240 Hz, passa-alta 38 Hz, turbina do nitro como ruído em banda). Pneu canta só com
  deslizamento lateral real.
- Carros refeitos a partir dos sprites (`referencias/carros-original/`) e das imagens modernizadas.
- Salto: J lança no ângulo da rampa (mais rápido = mais longe); pulo com buffer de 0,2 s e
  "pulo tardio" de 0,15 s; controle no ar; pouso só perde velocidade acima de 13 m/s; aviso de
  "sem pulo/turbo" quando acaba a carga.
- Aceleração reduzida em 40% e depois REVERTIDA a pedido do usuário ("ficou lento").
- Skill: nota < 8 (geral ou critério) reprova.

Notas: Visual 6,5 · Carros 6,5 · Jogabilidade 6,4 · Interface 6,5 · Som 6,0 (nenhum aprovado).
Pendências principais: câmera de perseguição entrando no carro; explosões e fumaça; Dirt Devil
ainda com cara de sedã; barras de atributos incoerentes (Battle Trak/Havac); óleo acumulando;
Sundog forte demais; volta solo de Havac/Battle Trak mais lenta; motores dos rivais; locutor
pouco emotivo; efeitos de contato fracos; aviso de girar o celular; HUD mistura idiomas.

## Pedidos do usuário de 2026-09-23 (itens 25–28 do feedback)

- Qualidade gráfica (`src/render/quality.ts`): Automática/Baixa/Média/Alta em Som e Opções; detecção
  por memória, núcleos e GPU; resolução dinâmica (baixa até 60% quando o fps cai); sombras, bloom,
  antialias, densidade do cenário e partículas por nível. `?q=alto` força o nível (evidências).
- HUD escreve no DOM só quando o texto muda; minimapa a 30 Hz.
- Controles de toque só na largada e na corrida (`.touch.off` fora disso).
- Teclado: Ctrl esquerdo atira, `\` (Backslash/IntlBackslash) solta a arma traseira; Ctrl+W acidental
  pede confirmação na corrida; em tela cheia o Keyboard Lock segura Ctrl+W.
- Carros refeitos na linha do pack CCamuz3D (`referencias/modernizados/`).
- Piso "grade" virou placas metálicas trianguladas com parafusos; poeira cor de areia nos pisos
  metálicos; vinheta escura; sol mais forte e ambiente menor; pintura com verniz alto.

## Pedidos de 2026-09-23 (itens 29–35)

- Retratos refeitos (SVG pintado à mão por piloto, fundo temático); miniaturas de carro em card
  (estúdio, neon, reflexo); miniaturas de planeta (`src/render/planetThumbs.ts`) na corrida rápida,
  garagem (rota dos 6 planetas), nova campanha, slots e resultados; ícones da loja com luz de estúdio.
- Locutor refeito com Chatterbox (exagero 1,1) clonando a voz Kokoro, conferido por Whisper
  (`scripts/locutor/gerar.py`).
- Carros: escala visual por modelo para ocupar a área do Havac (`VISUAL_SCALE` em `src/render/cars/index.ts`).
- Salto: teto de 6 m/s na subida da rampa; vão = pouso 4 m depois do buraco (+0,2 m por m/s acima de
  22 m/s); vão duplo pousa na rampa do meio. Voo: ~30 m (antes ~48 m; o duplo era 70 m).

# Rodada 4 (2026-09-23)

Notas: Visual 7 · Carros 7 · Jogabilidade 7,2 · Interface 7 · Som 7 (nenhum aprovado).
Usuário (item 38): o jogo não é simulador, é para ser divertido (arcade acima de realismo).

Feito:
- Visual: colocação do HUD em cor sólida (o gradiente recortado saía preto); avisos centrais no terço
  de cima; vinheta mais forte; menos luz ambiente (hemisférica 0,7, ambiente 0,7, exposição 1,1) e sol
  mais forte; neve de Nho e Bogmire menos estourados; perseguição mais perto; cockpit mais alto e
  inclinado, capô com para-lamas, faróis e friso, retrovisor com moldura; scatter virou esfera escura
  com brilho vermelho.
- Carros: Air Blade com nadadeira de tubarão, asas largas, bandeja cinza e casulos de míssil; Havac
  com dutos carenados, cúpula baixa, listras diagonais e canhão do Sundog; Battle Trak com esteiras
  mais altas que o casco; Havac com balanço de mola.
- Jogabilidade: faixa de arranque maior (Air Blade 41 … Havac 32,5); massas limitadas a 1,25:1 nas
  batidas; esteira/aerodeslizador resistem ao óleo (metade do giro) em vez de imunes; sundog da CPU só
  com alvo a < 25 m e 1 disparo a cada 1,5 s; bônus de volta pago só se vencer. Posição média em
  corridas mistas: 2,15–2,76 sem armas e 1,96–2,77 com armas (antes 1,20–3,39).
- Interface: retratos refeitos (Snake homem, card grande com placa metálica), menu/pausa do celular
  em duas colunas sem rolagem, munição abaixo do ícone, menus a 30 fps, ícones SVG no lugar de emojis,
  miniaturas de pista com as cores do planeta, rampas e vãos.
- Som: efeitos fora do compressor (impactos +5 a +8 dB na mix), soft-clip só de segurança, motor com
  formantes que abrem com a rotação, nitro grave, locutor com loudness igualado e takes calmos
  descartados, trilha sintetizada com seções e levada por planeta, efeitos de interface com corpo.

# Rodada 5 (2026-09-24)

Notas: Visual 6,5 · Carros 7,5 · Jogabilidade 7,4 · Interface 7 · Som 7,5 (nenhum aprovado).

Feito:
- Visual (item 28): poeira/areia nas juntas do piso em todos os planetas (padrão de cada planeta
  mantido), meio-fio claro arredondado em todas as pistas com o detalhe do planeta, luz lateral baixa e
  quente com ambiente 0,35, terreno escurecido e névoa escura; explosões com clarão, fumaça escura,
  detritos e luz de um pool; turbo como chama nos escapes; Nho com piso de gelo acinzentado; câmera de
  perseguição mais perto e marcador ciano sob o carro do jogador; cockpit com capô visível; anisotropia.
- Carros: Air Blade com barbatana em foice, asas varridas e cauda afilada; números e sujeira na
  pintura; armas maiores e cromadas; bônus do piloto em azul nas barras da garagem.
- Jogabilidade: pan pelo vetor direita da câmera (antes invertia atrás), queda de volume suave; plasma
  17, míssil 30, sundog 14; +1 carga da arma da frente no meio da volta; Battle Trak com 2 scatters;
  CPU ataca quando fica presa atrás; câmera aérea com mais antecipação. Posição média mista:
  2,20–2,74 sem armas e 2,01–2,78 com armas (Battle Trak levemente forte com armas).
- Interface: retratos pintados (volumes, luz de recorte, fundo com névoa; Tarquinn azul-gelo); rivais
  maiores; controles de toque menores e translúcidos em telas baixas; medição de fps por nível
  (`desempenho.json`), 30 fps no nível baixo quando necessário; pausa não redesenha; miniaturas de
  pista com largada, sentido, saltos e vãos.
- Som: locutor regerado com Chatterbox (exagero 1,5–1,8) clonando voz humana gritada CC-BY
  (F0 mediano 168→276 Hz); motor com gravação CC0 de V8 em loops por rotação + síntese de queima;
  laser mais grave e sujo; ducking reforçado; trilha sintetizada sem pausas secas.

# Rodada 6 (2026-09-24) — última com avaliadores (usuário pediu para parar as avaliações)

Notas: Visual 7 · Carros 7 · Jogabilidade 7,6 · Interface 7,5 · Som 7 (nenhum aprovado).
Usuário: itens 39 (direção por toque sensível demais) e 40 (vista aérea balança demais).

Feito (sem nova avaliação):
- Visual: camada de sujeira em manchas sobre as placas; vinheta forte; luz por planeta; Drakonis
  magenta/ciano com nebulosa e chão rachado; Nho com sol baixo, aurora e neve com relevo; cenário
  dobrado nesses dois; capô real no cockpit (vincos, entrada de ar, para-lamas, faróis), Havac com
  listras, saia e emissor do Sundog; céu do Inferno com brasas e fumaça; retrovisor acima do teto
  (sem a "moeda gigante"); perseguição mais alta; faíscas na mureta; fumaça de explosão mais longa;
  Mojave com mureta de metal areia/ferrugem; minimapa com marcadores maiores e seta do jogador;
  capturas 50_explosao_* e 51_faiscas_mureta nas evidências.
- Carros: Battle Trak com casco claro, para-brisa preto brilhante, torreta e cano maiores; Marauder
  baixo e alongado; Dirt Devil com cúpula de fusca; cor de vitrine por modelo na loja; escala visual
  pela área e pelo volume (nenhum carro cresce); Air Blade com barbatana fundida ao casco; barras da
  loja em escala absoluta e FORTE/FRACO só com diferença real (`attributeTags`).
- Jogabilidade: óleo cai 6 m atrás, ativa após 0,25 s, CPU só solta em quem está a 12–25 m, humano
  roda 0,5 s no Fácil/Normal; perfis mais nítidos (Havac veloz, Dirt Devil curva, Battle Trak
  aderência); elástico a 50 m no Fácil/Normal; letreiro de volta menor, no alto, 0,8 s. Posição média
  mista: 2,34–2,61 sem armas, 2,13–2,63 com armas.
- Item 39: direção por toque e por inclinação com zona morta e curva progressiva.
- Item 40: vista aérea com antecipação menor e suavizada à parte, zoom até +12% e lento, tremor só
  em pancada forte.
- Interface: retratos mais pintados (todos os pilotos e os 8 rivais) com placa metálica também nas
  miniaturas; nível Médio sem antialias (antes pior que o Alto); Baixo mais leve; botões de toque
  ≥ 56 px com ícone; CURVA → DERRAPAR; prévia do ganho na aba Melhorias; armas da loja em 3D; ícone
  do app novo; escolha de piloto na corrida rápida.
- Miniaturas: falha de WebGL não fica mais no cache (planetas sumiam da rota da Nova Campanha) e o
  renderizador é recriado se o contexto for perdido.
- Som: ver resumo do agente de som; locutor com voz grave sendo regerado fora da sessão
  (ver `referencias/locutor-pendente.md`).

# Rodada 7 (2026-09-24) — rodada única, avaliadores em grupos

Grupos chamados: todos (1ª rodada no formato de grupos; o commit mexeu em todas as áreas).
Notas: Visual 7,4 · Carros 7 · Jogabilidade 6,5 · Interface 7,3 · Som 6,5 · Desempenho 5,5 · QA 6 ·
Campanha 6 · Pistas 6 · Online 4 (nenhum aprovado).

Feito antes da avaliação:
- Itens 41–52 conferidos no código (maioria já feita); Voltar padronizado (item 44); `latencyHint`
  'balanced' também no PC (item 50); GPU `powerPreference: 'default'` (item 52).
- Item 54 (rolagem dos menus no celular): retratos rasterizados em PNG, `box-shadow` no lugar de
  `filter: drop-shadow`, retratos/planetas/carros da corrida rápida pré-gerados no menu principal.
- Item 53 (locutor "Let the carnage begin!" sem emoção): regravação em andamento.
- Skill: avaliadores em grupos (Aparência, Jogo, Plataforma, Som, Online, QA sempre).

Pendências (bloqueantes e altas primeiro):
- Online (bloqueante, segurança): XSS pela cor do convidado (`game.ts` hostJoin sem validar `m.color`;
  `menus.ts` sala sem `esc`). Altas: comando do convidado sem validação (trapaça/NaN), aba oculta do
  convidado/host, sem heartbeat, convidado sem previsão (~200 ms de atraso na direção).
- Som (bloqueante): item 53 ainda não publicado. Altas: picote sem medição; grafo de áudio pesado
  (motor e trilha sintetizada); motor em alto giro 100% síntese.
- Desempenho: médio do toque sem margem para baixar resolução; Apple sempre no nível alto; resolução
  dinâmica mede o rAF e não o quadro desenhado; layout forçado por quadro (clientWidth após HUD);
  materiais/geometrias por projétil sem dispose.
- QA: vazamento de GPU a cada createRace (carros sem dispose); carregar senha sobrescreve slot ativo;
  CONTINUAR morto após apagar save; áudio não retoma após pausa/aba oculta; sem webglcontextrestored;
  poças reaproveitadas entre pistas (Effects sem reset).
- Jogabilidade: curva com esterço total perde 23–38% da velocidade (itens 38/41); câmera aérea ainda
  vai e volta (item 40, antecipação até 12 m); volante de toque não relativo ao dedo (item 46); munição
  acaba nos primeiros 20 s; mureta pune demais.
- Campanha: progressão de carros quebrada (Havac máx. pior que Dirt Devil máx.); economia termina na
  metade; dificuldade estagna após Bogmire; fim de campanha fraco; compra de carro sem confirmação.
- Pistas: relevo sorteado por planeta em vez de transcrito dos mapas (itens 2/19); cor do piso lavada
  (Chem VI, New Mojave, Nho, Inferno).
- Visual: explosão (clarão branco + disco chapado); poças como discos lisos; peça do Havac tapando o
  cockpit; Nho sem identidade.
- Carros: sem suspensão real (rodas no mesmo grupo da carroceria); Air Blade e Battle Trak fora do
  alvo na vitrine; carros caros mais lentos.
- Interface: item 54 parcial (miniaturas WebGL síncronas durante a rolagem; trocar cor refaz o menu);
  barras de atributos pouco diferenciadas (item 13); miniaturas de armas toscas.

# Rodada 8 (2026-09-24) — rodada única, seguindo referencias/handoff-rodada8.md

Grupos chamados: todos (todos reprovaram na rodada 7). Correções feitas por 8 agentes em paralelo
(online, som, jogabilidade, estabilidade/desempenho, visual/carros, campanha, pistas, interface).
Notas: Visual 7,4 · Carros 7 · Jogabilidade 7,3 · Pistas 6,5 · Campanha 7 · Interface 7,2 ·
Desempenho 7 · Som 7,5 · Online 6,6 · QA 7,6 (nenhum aprovado; nenhum bloqueante).

Feito:
- Online: XSS da cor/nome fechado, validação de tudo que vem do host/convidado, clamp e limite de
  taxa, ping 1 s/queda 8 s, host oculto simula por Worker, interpolação ~100 ms, previsão do próprio
  carro com reconciliação, largada com "pronto", /api/turn com Origin e rate limit.
- Som: item 53 republicado (3 takes fiéis pelo Whisper, F0 207–223 Hz); modo leve de áudio (toque,
  nível baixo, ≤ 4 núcleos); motor com ruído único e camadas caladas fora do grafo; master ≤ −1 dBFS;
  medição de picote (som/picote.json: 0 buracos com CPU 4x); suspend/resume com `interrupted` do iOS.
- Jogabilidade: curva de 90° perde 2–7% (antes 15–28%); rampa de esterço digital; câmera aérea pela
  direção da pista (máx. 4,5 m); volante de toque relativo ao dedo; CPU dosa munição; mureta leve.
- Estabilidade/desempenho: dispose dos carros/sombra/PMREM, Effects.reset(), senha escolhe slot com
  confirmação, CONTINUAR após apagar, validSave, contexto WebGL perdido/restaurado, resolução dinâmica
  pelo quadro desenhado, queda automática de nível, opção Economia de bateria.
- Visual/carros: explosão colorida com decal queimado e fumaça escura, poças com textura, Sundog
  escondido no cockpit, faixa VOLTA sob o retrovisor, câmera encaixada na largada; pisos de Chem VI,
  New Mojave, Nho e Inferno; suspensão (grupo `chassis` separado); Air Blade e Battle Trak retocados.
- Campanha: CAR_POTENTIAL (máximos em escada), Estabilizadores do Havac, rivais por tier, revenda,
  compra com confirmação, tela de campeão e volta à garagem, calendário da divisão.
- Pistas: relevo.json transcrito em 6 pistas (uma por planeta) com poças nas casas do mapa.
- Interface: fila ociosa de miniaturas (idleQueue.ts), toBlob, troca de cor só muda o src, barras
  normalizadas 2–10 com FORTE/FRACO, miniaturas de armas no estilo dos carros, versão sem "+".

Pendências (altas primeiro):
- Visual: piso de Chem VI ainda marrom (luz quente/poeira/metal puxam); aviso da música no centro
  sobre a contagem; minimapa pobre; anel ciano enorme na perseguição. (O avaliador disse faltar
  capturas de Nho/Inferno/cockpit/explosão, mas elas existem: 05*, 06*, 50*, 51*.)
- Pistas: relevo transcrito só em 6 de 36; escamas de Inferno claras no cockpit; capturas não mostram
  as pistas transcritas.
- Carros: curso da suspensão passa da folga do para-lama (item 51); Air Blade no máximo mais lento que
  o Marauder no máximo; barras contradizem o visual (Battle Trak com poder de fogo FRACO); vitrine
  traseira igual à frontal; Air Blade longe do alvo.
- Jogabilidade: DERRAPAR vira freio (sobra 13–21% da velocidade); visão à frente curta na aérea;
  pouca disputa na liderança; Scatter domina.
- Campanha: paredão em Nho A; teste de economia circular; Inferno sem evolução; peças do Dirt Devil
  quase não rendem; fim de campanha sem celebração.
- Interface: rota de planetas da Nova Campanha abre vazia; item 55 (vão volante/armas ~17 px no
  844x390); miniaturas de armas ainda toscas; barras exageram (Dirt Devil 2/10, contra item 18);
  FORTE/FRACO sobre as barras; aviso da música no centro no celular.
- Desempenho: item 52 só manual; queda de nível recompila shaders no meio da corrida; hud.message()
  força layout por passo; picos p95 no médio/alto.
- Som: motor em giro médio/alto 100% síntese (item 21); emoção do item 53 só por métrica; picote
  sem medição em aparelho real.
- Online: sem reconexão; placar não final; host sai → convidados sem resultado; previsão sem colisões;
  toque curto de tiro perdido; canal confiável com head-of-line; sem indicador de ping.
- QA: sem saída se o WebGL não voltar (e fase 'finished' trava); reiniciar/sair na campanha sem custo;
  renderizador de miniaturas nunca liberado na corrida; faltam testes (largada atrás da linha, ré etc.).

# Rodada 9 (2026-09-24) — loop "/rodada-avaliadores campanha" (volta 1)

Grupos chamados: Jogo (Jogabilidade, Pistas, Campanha) + QA, pelo argumento "campanha".
Evidências só das partes jogo,telas (novo: evidencias.mjs aceita lista de partes).
Antes da avaliação: itens 59–61 (viagem entre planetas, garagem compacta, corrida atual/total) e
item 62 novo (carro para e escurece ao cruzar a chegada, fora da disputa).
Notas: Jogabilidade 7,4 · Pistas 6,6 · Campanha 7 · QA 7,1 (nenhum aprovado; nenhum bloqueante).

Pendências (altas primeiro):
- Jogabilidade: DERRAPAR ainda freia (13–21%); Scatter domina; carros terminados amontoados na linha;
  pouca troca de liderança em ~7 pistas; visão à frente curta na aérea; corridas longas (85–98 s).
- Pistas: relevo inventado em 30/36 pistas; New Mojave fora do original (muro verde-oliva com tachas
  amarelas, deserto de dia); piso de Inferno claro; semente do cenário pelo tamanho do id; capturas
  sem salto/vão/warp/poça; largada de inferno-2 preta com minimapa antigo; largura única.
- Campanha: final da campanha sem celebração (item 58); pico em Bogmire e Inferno sem evolução;
  Marauder por $9.000 na 1ª corrida; sobra de dinheiro no Difícil; peças do Dirt Devil não rendem;
  capturas da viagem não mostram o carro voando; reiniciar/sair sem custo; rota da Nova Campanha
  sem planetas.
- QA: reiniciar/sair anula repescagem; WebGL perdido trava 'finished' e host online, sem saída;
  míssil/Sundog miram o fantasma; óleo gira o fantasma; viagem/resultados com motores e locutor
  rodando atrás; clone escuro compila shader na chegada; miniaturas não liberadas na corrida; faltam
  testes de regras (largada atrás da linha, ré, rampa); elástico conta humano terminado; playoff da
  senha sem teto; viagem perdida ao recarregar.

Feito na rodada 9 (4 agentes em paralelo):
- Chegada (item 62): carro para, escurece (cópias escuras em cache, mesmos defines), estaciona na
  borda alternando lados e sem sobrepor; imune a míssil/Sundog/óleo/pickups; elástico ignora.
- Jogabilidade: DERRAPAR mantém 76–86% no grampo de 180°; scatter 4 minas, 1 acerto por leque;
  duelo pela liderança só entre CPUs (média 5,1 → 6,7 trocas); câmera aérea 8 m à frente.
- Pistas: sem relevo inventado; 14/36 transcritas (2+ por planeta); New Mojave muro oliva + dia;
  Inferno escama negra; semente do cenário por hash; Nho com 7 m de meia largura; 3 voltas em 4
  pistas longas; minimapa atualizado na montagem; capturas de saltos/warps/poças.
- Campanha: final com pódio, troféu, fogos, rota acendendo e créditos; viagem com rastro e clarão;
  degrau de dificuldade suave (Bogmire Normal 0,3 s); Inferno B≠A e bônus do J. B. Slash; revenda
  30%, Marauder na Chem VI A; Dirt Devil com peças baratas; teto de dinheiro; desistir conta como
  último; cenas pendentes no save; playoff limitado.
- Estabilidade: sem WebGL a simulação segue e surge "Recarregar"; resultados congelam a corrida e o
  som; renderizador de miniaturas liberado na corrida; testes de largada/ré/posições (bug de ré
  na linha corrigido em race.ts).

# Rodada 10 (2026-09-25) — todos os grupos (pedido do usuário: mais 3 rodadas com todos), volta 1/3

Evidências completas (tudo; parte ui refeita após corrigir as capturas do final).
Notas: Visual 6,9 · Carros 7 · Jogabilidade 7,7 · Pistas 6,9 · Campanha 7,6 · Interface 7,4 ·
Desempenho 6,5 · Som 7 · Online 5 · QA 6,8 (nenhum aprovado; nenhum bloqueante).

Pendências altas: explosões sem volume, bloom/nitro estourando, avisos no centro, piso fora do alvo;
Air Blade longe do alvo, Air Blade no máximo < Marauder, carros de fábrica iguais; Plasma fraco;
22 pistas planas, sem evidência de salto; motor sintético em giro médio/alto, fogos do final fracos,
emoção do locutor; bateria só manual, queda de nível recompila, hud.message força layout, 90/100 Hz;
online sem reconexão, host sai derruba todos, placar não final, previsão sem colisão; item 55 (vão
16 px), barras enganosas, miniaturas de armas; carro terminado para no meio da pista (28/36),
recarregar a página escapa da desistência.

Feito na rodada 10 (9 agentes em paralelo):
- Visual: explosão com bola de fogo, destroços, onda de choque e fumaça; bloom com teto; avisos
  fora do centro (faixa sob a posição / canto inferior esquerdo); piso com chapa e juntas; anel do
  jogador menor fora da aérea; minimapa novo; etiquetas limitadas; chamas apagadas após a chegada.
- Carros: Air Blade refeito (casco-barbatana única, bandeja larga, pneus +20%); progressão estrita
  DD<MA<AB<BT<HV; estilos de fábrica distintos; vitrine com câmera própria e espaçada; mísseis
  visíveis; suspensão por Linkage e folga do para-lama.
- Jogabilidade: estacionamento na borda 0/432 no meio; plasma 25 de dano (Chem VI 4,3 explosões);
  míssil em cone e Sundog 1,2 s (acerto 50–55%); corridas mistas; óleo 25 s; sem AltLeft.
- Pistas: relevo em 35/36 (bogmire-5 sem, drakonis-4 e newmojave-6 planas); salto com queda (Gv);
  capturas de salto; Inferno e Nho mais escuros.
- Campanha/QA: corrida em andamento no save (recarregar conta como último); pausa sabe se largou;
  "Desistir e ir para a próxima"; sem custo com WebGL perdido; teto de dinheiro e revenda ≤80%;
  viagem e final refeitos (pódio com rivais); capturas de resultados/chefe/repescagem.
- Interface: vão ≥32 px (item 55), barras em escala real, miniaturas de armas novas, TIRO à direita,
  capturas da garagem/loja no celular.
- Desempenho: economia de bateria automática; queda de nível sem recompilar; hud.message sem layout;
  90/100 Hz fluidos; menu desenha só quando muda; pools e menos alocações; powerPreference.
- Som: fogos e multidão no final; grave do motor segue a rotação; cadeia de arena no locutor;
  efeitos com sub; nitro com estalos; silêncio dos resultados também online.
- Online: reconexão com ficha de sessão; host sai → placar com nota; placar ao vivo e final oficial;
  colisão na previsão; contadores de toque; canal sem ordem; ping no HUD e na sala.

# Rodada 11 (2026-09-25) — todos os grupos, volta 2/3

Notas: Visual 6,8 · Carros 6,2 · Jogabilidade 6,8 · Pistas 7 · Campanha 7,8 · Interface 7,4 ·
Desempenho 7,2 · Som 6,6 · Online 7 · QA 6,4 (nenhum aprovado; nenhum bloqueante).

Pendências altas: bola de fogo vira mancha vermelha; câmera chase atravessa rivais; nitro do Havac
em cones sólidos; piso fora do alvo (Bogmire/Nho/Drakonis); corridas mistas: Battle Trak 51% e
Havac 1/72; progressão no máximo BT≈AB; vitrine com explosão; minas/scatter certeiros; capturas de
salto e chegada falharam (script); sem teste de salto curto; viadutos ausentes (bogmire-5/2,
inferno-4); miniatura da pista vazia na garagem do chefe; engasgo de ~2 s após a largada; resolução
dinâmica inócua no alto; queda de nível sem desligar bloom; sub-grave demais nos efeitos e pouco
destaque na mixagem; motor sintético; emoção do locutor; placar online some após pausa; recarregar
não reconecta; recarregar entre chegada e resultados conta como último; pausa não se refaz quando o
WebGL cai/volta.

Feito na rodada 11 (9 agentes em paralelo):
- Visual: fogo laranja com brilho; câmera chase esconde rival colado e sobe; piso metálico em
  Bogmire/Nho/Drakonis; destroços em chapa na cor do carro; faíscas em risco; anel de choque fino;
  sol de New Mojave suave; crateras rebaixadas.
- Carros: progressão com ≥0,19 s entre degraus; vitrine limpa em reta e capturas 21_carro_*;
  Air Blade vermelho com barbatana em foice e asas com diedro; chamas em gradiente; VISUAL_SCALE medido.
- Jogabilidade: corridas mistas 20/17/13/28/22 % (antes BT 51, Havac 1); mina 0,46 e scatter 0,51
  acerto/carga; Sundog 22; vácuo real; trocas de liderança 6,6 → 9,8; IA usa DERRAPAR; captura 52 refeita.
- Pistas: teste de salto curto (ápice ≤1,42 m); capturas de salto refeitas; viadutos (bogmire-4/5/6);
  warp vermelho e zebra no J; cruzamento de nho-2 legível; Inferno mais escuro.
- Campanha/QA: chegada aplicada na hora; pausa refeita quando o vídeo cai/volta; desistir leva à
  garagem se a temporada muda; campaignFlow.ts e storage.test.ts; Inferno paga como Nho; cargas no
  teto e preço escalado; selo de prêmios reduzidos; Fácil calibrado; id de campanha.
- Interface: miniatura da pista na hora; garagem/loja/corrida rápida compactas no celular; TIRO a
  16 px do ACEL com deslizar; barras pelo dano real; miniaturas de blindagem/plasma/slipsauce.
- Desempenho: warmup de tudo; resolução dinâmica com piso efetivo; bloom na escada de queda;
  EngineSound.stop(); menu/pausa sem quadros; buffer circular; bateria sem getBattery.
- Som: golpes +6,6 a +11 dB sobre a cama; motor com grave e menos periódico; locutor regerado mais
  gritado; rivais audíveis; hino no final; plasma seco.
- Online: placar não some; recarregar reentra; previsão com poças/óleo; leave confiável; conexão
  instável; retorno local do tiro; testes de fluxo e previsão.
