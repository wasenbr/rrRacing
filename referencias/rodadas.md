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
