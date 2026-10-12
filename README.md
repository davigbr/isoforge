# Isoforge

Motor de jogo isométrico 2:1 em **arte de texto** para o browser. Roda offline por
`file://`, sem dependência, sem bundler, sem servidor. A tela é uma grade de
caracteres com cor por célula; não há canvas nem imagem em lugar nenhum.

Este repositório é o **motor**. Os jogos ficam em projetos próprios e consomem o
build daqui (`dist/`), como `~/Projetos/cripta/`.

```
src/core/config.js           configuração + geometria derivada (tamanho de tile etc.)
src/core/rng.js              mulberry32 determinístico
src/core/iso.js              projeção 2:1 em células, malha do quadro, culling
src/core/loop.js             passo fixo 60 Hz, hash FNV-1a, métricas de quadro
src/core/persist.js          localStorage com namespace
src/render/text_renderer.js  a grade de caracteres: plot, polígono, linha, present
src/render/world_view.js     ordem de desenho + culling, arte vinda do jogo
src/sim/grid.js              a grade-mundo: bitmap andável, conectividade, spawn
src/sim/actor.js             locomoção com colisão por eixo + câmera que segue
src/sim/headless.js          invariantes sem browser (determinismo, emenda, culling)
src/ui/hud.js                painéis em box-drawing, conteúdo vindo do jogo
src/engine.js                a superfície pública + o contrato de teste
examples/arena/              um jogo completo em um arquivo, prova do corte
tools/audit_engine.py        auditoria de invariantes, roda contra qualquer jogo
docs/engine.md               referência da API
```

## Build

```sh
python3 build.py                    # -> dist/isoforge.engine.js + .css + VERSION
python3 build.py --example arena    # -> examples/arena/arena.html (motor + jogo)
```

O build valida a sintaxe com `node --check` (erro de sintaxe dentro do arquivo
único falha **em silêncio** no browser) e **morre** se a saída ganhar `<canvas>`,
`data:image`, `http://` ou import de módulo: o texto e o offline são requisito, não
preferência.

O artefato é um script simples, e não um módulo ES, porque `file://` recusa
imports (CORS) e o jogo tem de abrir com dois cliques.

## Auditoria

```sh
PYTHONPATH= ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_engine.py
PYTHONPATH= ... tools/audit_engine.py --html ~/Projetos/cripta/cripta.html
PYTHONPATH= ... tools/audit_engine.py --negative-control   # prova que a checagem pode falhar
```

28 checagens num Chromium de verdade — projeção, determinismo, emenda, culling
exato, custo por quadro, malha rígida, rolagem suave, arte estável, HUD sobreposto,
cópia desenhável, layout em 1280 e 390 px. Lista completa em `docs/engine.md`.

O prefixo `PYTHONPATH=` é obrigatório neste ambiente: a variável aponta para o
`site-packages` de outro Python e quebra a importação do Playwright.

## O que é um jogo

`examples/arena/game.js`: ~200 linhas, um arquivo, nenhum arquivo do motor tocado.
Ele também prova que a geometria é parâmetro — a arena pede tiles de 8×2 células e
paredes de 2 células, onde a cripta usa 10×3 e 4.

## Geometria configurável (e uma armadilha que ela revelou)

`Isoforge.configure({ tileCellsW, tileCellsH, wallHeightCells, latticeQuantum, ... })`.
O tamanho do tile é parâmetro, não constante: 10×3 numa fonte ~0.6em dá exatamente
2:1 em pixels (a proporção do tile 64×32 do Diablo 2).

Foi pedir 8×2 na arena que apareceu um defeito real do motor: a margem do retângulo
de culling estava fixa em 3 tiles, valor certo para 10×3 e insuficiente para 8×2
(um tile na borda ficava de fora — o desenhado saía exatamente um a menos que o
geométrico). Agora `iso.requiredTileMargin()` deriva a margem da geometria, e a
checagem "margem do culling" que existe por causa disso está em `docs/engine.md`.

## Decisões que sustentam o motor

| decisão | por quê |
|---|---|
| texto em vez de canvas | medido na mesma grade 214×69: DOM com corridas de cor p50 2,1 ms / p95 3,9 ms; canvas com atlas de glifos p50 9,4 ms / p95 49,4 ms |
| conteúdo numa malha grossa + `transform` | a câmera anda ~42 células/s; reconstruir a grade a cada célula custava 5,5 MB/s de HTML. Agora: 0 reconstruções completas, ~28 KB/quadro |
| HUD como segunda grade, sem transform | o HUD na grade do mundo deslizava junto e tremia; medido: 0 px de deriva do HUD contra 43 px do mundo |
| hash de arte por tile + offset local | com a célula na tela, a pedra fervia a cada passo da malha |
| margem de culling derivada da geometria | margem fixa de 3 tiles estava certa para 10×3 e errada para 8×2 |
| `fps` pela mediana | `1000/frameMs` do último quadro reporta 0 num loop saudável |
| `stop()` cancela o handle do rAF | sem isso, `stop()`+`start()` deixa duas correntes de quadro e o contador dobra (medido: 468 quadros em 5 s) |

## Regras do projeto

- Código em inglês (identificadores, `data-*`, chaves, comentários, commits);
  texto visível ao jogador fica na tabela de cópia do jogo.
- Zero dependência, zero módulo ES, zero `fetch`: abrir por `file://` com dois cliques.
- Regenerável: todo artefato sai de um script.
- Nada de conteúdo de jogo no motor: se a cripta pode mudar sem tocar aqui, o corte
  está certo.

## Estado

Motor em 0.3.0, auditoria 27/27 na arena de exemplo. O plano da fase 0 e as decisões
originais estão em `.hermes/plans/2026-10-12_080752-isoforge-motor-isometrico.md`.
Pendente no motor: arte amostrada de cena PIL para templates de caractere (a âncora
existe no build), A* de verdade e camada de entidades mais rica — os dois últimos
provavelmente pedem um `sim/` próprio do jogo, não do motor.
