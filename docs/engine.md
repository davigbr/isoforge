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
`solidBorder(grid)` · `keepLargestRegion(grid)` · `findOpenCell(grid, rng)`.
O gerador (caverna, salas, arena) é do jogo: o motor não sabe que mundo é este.

### `loop` — passo fixo
`createLoop({ step, render })` · `hash32Init/Mix/Finish` ·
`FIXED_STEP_MS` em `debug.constants.stepMs`. A simulação nunca lê o relógio; o
render recebe `alpha` para interpolar.

### `actor` — locomoção
`canStand` · `moveWithCollision` · `moveByInput` · `stepTowardTarget` ·
`clearTarget` · `followCamera`. Colisão separada por eixo (desliza na parede).

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
`culling(cols, rows, camX, camY, grid, margem)`.

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
13. layout sem barra de rolagem em 1280×633 e 390×844, culling ainda exato depois;
14. console e `window.onerror` limpos.

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
- **`PYTHONPATH` no ambiente Hermes aponta para `site-packages` de outro Python** e
  quebra `playwright`/`PIL` em venv: rode `PYTHONPATH= /venv/bin/python3 script.py`.
