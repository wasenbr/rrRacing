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
