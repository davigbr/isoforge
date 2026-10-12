# Isoforge — API

Motor isométrico 2:1 em arte de texto, para o browser, offline. Esta é a
referência da superfície pública: tudo que um jogo pode usar, e nada além.

```
Isoforge = (function () { "use strict"; <módulos>; return engineSurface(); })();
```

Nada mais do motor é global. Os módulos conversam por nomes simples dentro dessa
closure, o que mantém os laços quentes livres de consulta a propriedade e ainda
assim entrega um único namespace para fora.

## Índice

1. [Receita: um jogo em 8 passos](#receita-um-jogo-em-8-passos)
2. [Configuração](#configuração)
3. [Contrato de teste (`window.ISO`)](#contrato-de-teste-windowiso)
4. [Superfície](#superfície)
5. [Invariantes que a auditoria cobra](#invariantes-que-a-auditoria-cobra)
6. [Armadilhas medidas](#armadilhas-medidas)

## Receita: um jogo em 8 passos

```js
Isoforge.configure({ tileCellsW: 10, tileCellsH: 3, wallHeightCells: 4 });

var grid  = Isoforge.grid.createGrid(64, 64);          // 1. mundo
var scene = { grid: grid, entities: [], step: step };  // 2. cena (a sua simulação)
var renderer    = Isoforge.text.createTextRenderer(document.getElementById("screen"));
var hudRenderer = Isoforge.text.createTextRenderer(document.getElementById("hud"), { bleed: 0 });
var view = Isoforge.view.createWorldView(renderer, art);            // 3. arte
var hud  = Isoforge.hud.createHud(hudRenderer, layout);             // 4. painéis
var loop = Isoforge.loop.createLoop({ step: step, render: render }); // 5. loop
```

6. O `render(alpha)` faz: `renderer.setOrigin(lattice, camera)` →
   `renderer.beginFrame()` → `view.draw(scene, camera, alpha, hover)` →
   `hudRenderer.beginFrame()` → `hud.draw(state)` → `hudRenderer.lockToViewport()`
   → `renderer.present()` → `hudRenderer.present()`.
7. Input: teclado e mouse do jogo escrevem em `scene` (o motor não conhece tecla).
8. `window.ISO = Isoforge.createContract({ ... })` — o contrato abaixo, validado
   no boot; faltando membro, o jogo nem sobe.

Exemplo completo e jogável: `examples/arena/game.js` (~200 linhas, um arquivo).

## Configuração

`Isoforge.configure(opcoes)` — chamar **antes** de criar renderer, grid e loop.
Os derivados são recalculados na hora.

| chave | padrão | o que decide |
|---|---|---|
| `tileCellsW` / `tileCellsH` | 10 / 3 | tamanho do tile em células. 10×3 numa fonte ~0.6em dá exatamente 2:1 em pixels (a proporção do tile 64×32 do Diablo 2). 20×6 dobra o detalhe por tile |
| `wallHeightCells` | 4 | altura com que um bloco sólido é desenhado acima do tile |
| `latticeQuantum` | 8 | células de deslocamento da câmera entre duas reconstruções da grade; a sangria é metade disso |
| `defaultTargetRows` | 69 | densidade da grade (linhas que preenchem a tela) |
| `minTargetRows` / `maxTargetRows` | 40 / 170 | limites do controle ao vivo de densidade |
| `minFontPx` / `maxFontPx` | 5.5 / 22 | limites da fonte derivada da densidade |

`Isoforge.config()` devolve uma cópia da configuração corrente; o acesso à
geometria derivada é por `Isoforge.iso.diamondHalfW()`, `.diamondHalfH()`,
`.wallHeightCells()`, `.latticeBleed()` — funções, para o código de arte ler a
configuração viva em vez de uma cópia tirada no boot.

## Contrato de teste (`window.ISO`)

`Isoforge.createContract(parts)` valida e devolve o objeto de teste. É o que a
auditoria dirige; um jogo que não o exponha não sobe.

| membro | para que serve |
|---|---|
| `mode`, `version`, `seed` | identificação: `"text"`, versão do motor, semente da partida |
| `scene` | a cena: `{ grid, entities, step(input), stateHash(bool), getTick() }` |
| `camera`, `grid` | câmera e grade correntes |
| `renderer`, `hudRenderer` | as duas grades de caracteres |
| `metrics()` | `{ cols, rows, cellW, cellH, fontPx, bufferCols, bufferRows, latticeQuantum, latticeBleed }` |
| `gridText()`, `hudText()` | leitura do que está desenhado, em texto |
| `cellAt(x, y)` | `{ glyph, color }` de uma célula da grade do mundo |
| `tileCell(tx, ty)` | índice da célula em que o centro do tile caiu no quadro corrente |
| `clientPointForTile(tx, ty)` | inversa exata: ponto de tela no centro do tile |
| `teleport(x, y)` | põe o ator na posição e centraliza a câmera |
| `setDestination(x, y)` | **ordena** ao ator controlável ir até o ponto (sem isso a auditoria não pode provar que o jogo contorna parede) |
| `actorPosition()` | onde o ator controlável está agora |
| `stepScene(input)` | **avança a cena um passo como o loop faz**, clamp da câmera incluso |
| `setRows(n)`, `getRows()` | densidade ao vivo |
| `renderOnce()` | desenha sem avançar a simulação (prova de quadro parado) |
| `reseed(n)` | começa outra partida com outra semente |
| `loop` | `{ stats, resetStats(), start(), stop(), isRunning() }` |
| `headless` | `Isoforge.headless({ createScene })` — invariantes sem browser |
| `debug` | `{ errors, renderStats(), worldStats(), constants, hoveredTile }` |

## Superfície

### `text` — grade de caracteres
`createTextRenderer(pre, { bleed })` · `glyphIndex` · `rampIndexAt` · `glyphs` ·
`spaceIndex` · `pickStep` · `boostColor` · `rgb` · `shade` · `mixColor` ·
`hexColor` · `hashNoise`

O renderer expõe `resize(w, h, rows)`, `beginFrame()`, `plot`, `fillRect`,
`text`, `fillPolygon`, `strokeLine`, `inDiamond`, `glyphAt`, `colorAt`,
`gridText()`, `setOrigin(lattice, camera)`, `lockToViewport()`, `present()`,
`metrics()` e `stats`. Renderizador é peça trocável: o jogo fala só com esses
métodos.

### `iso` — projeção 2:1 em células
`worldToCellX/Y` · `cellToWorldX/Y` (inversa exata) · `createCamera` ·
`viewHalfExtents` · `visibleTileBounds` · `requiredTileMargin` · `clampCamera` ·
`snappedCameraCell` · `coarseLatticeCell` · `tileCenterCellInLattice` ·
`latticeToWorld` · `bufferCellToWorld` · `tileTouchesViewport` · acessores de
geometria (`diamondHalfW`, `diamondHalfH`, `wallHeightCells`, `latticeBleed`).

### `grid` — o mundo
`createGrid(w, h)` devolve `{ width, height, walkable, isWalkableAt,
isWalkableTile, setWalkable, floorVariant, countWalkable }`.
`solidBorder(grid)` · `keepLargestRegion(grid)` · `findOpenCell(grid, rng)` ·
`findOpenCellNear(grid, cx, cy, folga)` (busca em anéis a partir de um ponto — é o
que um spawn quer, para não nascer fora da faixa que a câmera pode percorrer).
O gerador (caverna, salas, arena) é do jogo: o motor não sabe que mundo é este.

**Resolução é parâmetro.** `tileCellsW/H` decidem quantas células uma peça ocupa:
10×3 e 20×6 dão a MESMA proporção 2:1 em pixels (a célula é 1,67:1), com o dobro do
detalhe por peça no segundo. `wallHeightCells` e `latticeQuantum` acompanham (o
quântico precisa ser maior que a célula, e a sangria é metade dele). O motor não
muda: projeção, canto do losango, margem do culling, faixa da câmera e o teste de
seleção derivam de `configure()`. O que muda é a ARTE do jogo, que precisa de um
fator de escala nos próprios deslocamentos — mais caracteres por peça só existem se
alguém os posicionar.

### `loop` — passo fixo
`createLoop({ step, render })` · `hash32Init/Mix/Finish` ·
`FIXED_STEP_MS` em `debug.constants.stepMs`. A simulação nunca lê o relógio; o
render recebe `alpha` para interpolar.

### `actor` — locomoção
`canStand` · `moveWithCollision` · `moveByInput` · `stepTowardTarget` ·
`setPath` · `dropPath` · `followPath` · `navigate` · `clearTarget` · `followCamera`.
Colisão separada por eixo (desliza na parede). `followPath` percorre uma rota
(ponto a ponto, sem passar do waypoint); `navigate` calcula a rota e já começa a
andar. Teclado e `teleport` têm de **descartar a rota**, senão ela retoma depois.

### `path` — rotas no grid
`find(grid, x0, y0, x1, y1, opcoes)` · `hasLineOfSight` · `nearestWalkable` ·
`signature(pontos)`. A* com custos **inteiros** (reto 1000, diagonal 1414): o
desempate por índice faz a mesma pergunta dar sempre a mesma rota, que é o que a
auditoria exige. Um destino dentro de parede não é recusado: vai para o piso
andável mais próximo (`nearestWalkable`), que é o que um clique no cenário pede.
Separado de `actor`: jogo por turnos ou planejamento quer a busca sem a locomoção.

### `combat` — golpe, dano e vizinhança
`createSwing({windup, hit, recovery, cooldown})` · `beginSwing` · `stepSwing` (devolve
`"hit"` no **único** tique em que o golpe cai) · `swingProgress` · `totalSwingTicks` ·
`rollDamage({min, max, add, mods, resist}, rng)` · `applyDamage(stats, n)` ·
`inReach(atacante, alvo, alcance, grid)` (alcance **e** linha de visão: golpe não
atravessa parede) · `facingFor(atacante, alvo)` (lado da TELA para onde o corpo vira) ·
`createRegistry(bucket)` (índice espacial: "quem está perto" em O(1) por consulta).
Tempos em **tiques**, não milissegundos: é a única unidade que replaya idêntico. Dano em
números inteiros com ordem fixa (base → aditivos → multiplicativos → resistência →
arredonda uma vez).

### `view` — ordem de desenho e culling
`createWorldView(renderer, art)`. O `art` é uma tabela de callbacks:
`floor`, `block`, `prop: { nome: fn }`, `propAt(tx, ty, grid)`,
`entity: { kind: fn }`, `entityFallback`, `cursor`, `cursorColor`,
`cursorBlockedColor`, `margin`. O motor conhece ordem e culling; não conhece arte.

### `hud` — painéis
`createHud(renderer, layout)`, com
`colors: { line, background, title, label, value }`,
`panels(metrics, state) -> [{ x, y, width, height, title, rows: [{label, value}] }]`
e `hint(metrics, state) -> string`. O motor desenha a moldura; o conteúdo é dado.

### `persist` — localStorage com namespace
`createStore(nome)` · `get/set/remove/keys/available`. Todas as páginas locais
dividem um único balde em `file://`: sem namespace o save colide com qualquer
outro artefato da máquina.

### `rng` — determinismo
`createRng(seed)` (mulberry32) · `randomSeed()` · `quantize(v)` (1/1000 de tile,
a resolução do save) · `clamp(v, lo, hi)`.

### `headless` — invariantes sem browser
`createHeadless({ createScene })` · `determinism(seed, passos)` ·
`loopClosure(seed, passos)` · `projectionRoundTrip(n)` ·
`culling(cols, rows, camX, camY, grid, margem)` · `paths(seed, casos)`.

## Invariantes que a auditoria cobra

`tools/audit_engine.py` roda contra qualquer jogo construído sobre o motor
(por padrão `examples/arena/arena.html`):

1. boot obedecendo ao contrato, sem erro no console, aba visível;
2. build sem `<canvas>`, sem imagem, sem rede;
3. projeção 2:1 ida-e-volta com erro 0 em 2000 amostras;
4. determinismo (mesma semente + mesma entrada = mesmo hash, 600 passos, 2 rodadas);
5. emenda do loop (passo 600 ≡ passo 0);
6. culling exato: desenhados == geométricos, sem furo, no centro e na borda do mundo;
7. quadro parado escreve **zero** bytes no DOM e reconstrói **zero** linhas;
8. andando: 60 fps, p95 dentro do orçamento, **zero engasgo** (quadro > 2 vsyncs);
9. malha rígida: a distância em células entre tiles fixos não varia;
10. rolagem suave: deslocamento de conteúdo em células inteiras + passo sub-célula
    na maioria dos quadros;
11. arte estável: o mesmo tile pinta as mesmas células depois de a câmera andar;
12. HUD parado enquanto o mundo rola por baixo;
13. cópia do jogo: toda string declarada em `window.ISO.text` é desenhável pelo
    conjunto de glifos (um acento sem glifo vira espaço em silêncio);
14. layout sem barra de rolagem em 1280×633 e 390×844, culling ainda exato depois;
15. console e `window.onerror` limpos;
16. rotas: nenhum waypoint dentro de parede, destino bloqueado vai para o piso ao
    lado, e a mesma pergunta dá sempre a mesma rota (impressão digital no relatório);
17. rota atrás de parede: a auditoria **primeiro acha** um destino cuja linha reta
    está bloqueada (senão a prova seria vazia) e depois dirige o ator só pelo
    contrato até lá, amostrando a cada tique que ele nunca está dentro da parede;
18. câmera: partindo do **spawn** (não do meio do mundo, que esconde o defeito), o
    ator anda uma rota real em cada eixo e a câmera tem de acompanhar — o que exige
    que o spawn esteja dentro da faixa de clamp e que o mundo dê folga à vista;
19. combate, contra fixtures do próprio motor: um golpe cai **uma vez**, no tique em
    que o preparo acaba; o golpe não reinicia em pleno golpe nem durante a espera;
    dano replaya por semente e muda com ela; golpe não atravessa parede (e o controle
    mostra que só o alcance permitiria); o índice espacial devolve exatamente o que
    está no raio e descarta o que cai fora do grid; um golpe nunca causa dano além da
    vida e um corpo morto não leva golpe; sorteios com nome são independentes.

São **43 checagens** no jogo de exemplo (60 na cripta, contando as do jogo).

`--negative-control` quebra a malha numa cópia da página e exige que a checagem
9 **falhe** ali. Um teste que nunca falhou não prova nada.

## Armadilhas medidas

Cada uma custou uma rodada de investigação; estão aqui para não custarem de novo.

- **Aba oculta suspende `requestAnimationFrame`**: o loop parece morto (0 quadros).
  Traga a aba para frente e asserte `visibilityState` antes de medir.
- **`fps` tem de vir da mediana**, nunca de `1000/frameMs` do último quadro: dois
  callbacks de rAF caem no mesmo milissegundo e um loop saudável reporta 0.
- **`stop()` precisa cancelar o handle do rAF.** Sem isso, um `start()` logo depois
  deixa duas correntes de quadro: metade dos intervalos vira 0 ms e o contador de
  quadros dobra (medido: 468 quadros numa janela de 5 s).
- **Contagem desenhada e contagem geométrica têm de ser lidas com o loop parado**,
  logo depois de um render: a câmera andando entre as duas leituras aparece como
  "culling errado por 1 tile".
- **A margem do retângulo de culling é derivada da geometria**, não fixa: a sangria
  é medida em células e o retângulo em tiles. Uma margem de 3 tiles estava certa
  para 10×3 e errada para 8×2 (um tile da borda ficava de fora).
- **Em arte procedural, o hash é tile + offset local da forma**, nunca a posição da
  célula na tela: com a célula na tela a pedra ferve quando a câmera anda.
- **A travessia de arte animada/entidades contamina o teste de estabilidade**: pare
  o loop antes de amostrar, ou o corpo que anda por cima da amostra parece arte
  instável.
- **Tremor vertical só existe quando o passo do tile em células não é inteiro**
  (10×3 → 1,5): com passo inteiro (8×2 → 1) toda malha é rígida e a checagem passa
  trivialmente. Diga isso no relatório em vez de fingir prova.
- **Custos de rota em inteiro, e desempate explícito.** Com `float` duas rotas
  diferentes empatam por acidente e a "mesma" pergunta passa a dar respostas
  diferentes entre rodadas; o A* usa 1000/1414 e desempata pelo índice do tile.
- **Rota pendente sobrevive ao teclado e ao `teleport`.** Se o jogo não chamar
  `dropPath` quando o jogador assume o controle (tecla) ou quando reposiciona o
  ator, a rota velha retoma do nada e o corpo anda para trás no quadro seguinte.
- **Um teste de rota só prova algo se o destino estiver atrás de parede.** A
  auditoria procura um destino com linha reta bloqueada e só então dirige; num
  mundo sem paredes ela falha alto em vez de passar em silêncio.
- **Um spawn aleatório pode nascer fora da faixa da câmera.** A faixa em que a
  câmera pode andar é `mundo − vista`: num mundo 64×64 com vista de 46 tiles ela tem
  17,8 tiles por eixo, e o spawn sorteado caiu fora dela — a tela travava no limite e
  parecia ter parado de acompanhar o jogador (relato de quem jogou). Nasça perto do
  **centro** (`findOpenCellNear`), que está sempre dentro da faixa quando ela existe.
- **Testar a câmera a partir do centro do mundo esconde esse defeito**: passou no
  mundo que tinha o bug. O teste tem de partir de onde o jogo põe o jogador, e a folga
  exigida tem de ser derivada da vista (metade dela), não um número solto de tiles.
- **Editar `src/` do motor sem reconstruir `dist/` deixa o jogo vendorado rodando um
  motor velho — e nem a checagem de versão nem a de hash pegam isso**, porque a versão
  não mudou. O jogo quebra no boot (`Isoforge.combat is undefined`) e quem acusa é o
  navegador, não o build. Reconstruir `dist/` E subir a versão são o mesmo passo, sempre
  que a API pública muda.
- **Fixture de teste também pode estar errada.** Nesta rodada: um alvo falso a 2 tiles
  (fora do alcance, então o personagem andava em vez de golpear), uma grade nova usada
  como chão (o `createGrid` nasce sólido, e a checagem de linha de visão falhou por isso
  e não por linha de visão), e uma re-sondagem de golpe que já tinha recuperado (então
  "recusou" veio falso). Antes de acusar o código, conferir o cenário do teste.
- **Checagem com janela fixa em células assume um tamanho de tile.** Ao dobrar o tile
  (10×3 → 20×6) três checagens quebraram sozinhas: a janela da arte (±5/±4 células)
  passou a invadir os tiles vizinhos, a busca do tile a amostrar (16 tiles de distância)
  passou a sair da tela, e o piso de "glifos distintos" (20) caiu para 16 mesmo com a
  mesma paleta. Regra: derive a janela, a busca e o piso da GEOMETRIA
  (`diamondHalfW/H`, `visibleTileBounds`, `metrics`), nunca de números medidos no tile
  de 10. O piso de variedade é piso, não meta.
- **Laço de desenho tem de andar em célula INTEIRA.** O meio-lado do losango é
  fracionário (9,5 num tile de 20): varrer `dx` de 9,5 em 9,5 põe metade das amostras em
  `.5`, e a célula pintada passa a depender do arredondamento da posição da malha — o
  mesmo tile pinta células diferentes depois de a câmera andar. Use
  `Math.ceil(meioLado)` no limite e deixe o teste do losango rejeitar o canto.
- **A luz dimensionada pela escala vaza para o tile vizinho.** Com raio 12 células num
  tile de 6 de altura, a tocha pinta dentro da vizinhança — e como ela só toca célula
  ainda vazia, se a tocha sai da tela ela para de pintar ali. Não é arte instável, mas
  parece: amostre a pegada do PRÓPRIO tile, não o quarteirão.
- **`PYTHONPATH` no ambiente Hermes aponta para `site-packages` de outro Python** e
  quebra `playwright`/`PIL` em venv: rode `PYTHONPATH= /venv/bin/python3 script.py`.
- **Caractere sem glifo vira espaço em silêncio.** O conjunto de glifos precisa
  cobrir a língua da cópia do jogo (acentos, hífen tipográfico −, aspas curvas): a
  interface em português exibia "resolu o" e "ch o" e nenhum teste pegava, porque
  em revisão de código a string estava certa. `Isoforge.text.missingGlyphs(text)`
  responde o que não seria desenhado, e a auditoria varre `window.ISO.text` com ele.
- **Os módulos do jogo compartilham o escopo**: `var ISO = Isoforge.iso` num arquivo
  e `window.ISO = <contrato>` em outro são o MESMO binding, e o alias é
  sobrescrito no boot (a arte quebrava no primeiro quadro com "handleHalfW is not a
  function"). O build do jogo envolve tudo num IIFE; só o contrato é global.
- **Um check que falha por carga da máquina não é regressão**: o critério de engasgo
  (≤1% dos quadros acima de dois vsyncs) mede 0 em 154 quadros numa rodada limpa e
  até 2% com outro Chromium rodando ao lado. Re-rode antes de investigar.
