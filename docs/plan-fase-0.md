# Isoforge — motor isométrico 2:1 para browser: plano de implementação


**Goal:** um motor de jogos isométricos (projeção 2:1 fixa, câmera que **não** rotaciona a tela) que roda 100% offline no browser em tela cheia, com simulação determinística a 60 Hz, save em `localStorage`, arte gerada por script, e uma fatia jogável de ARPG que prova o motor.

**Architecture:** Canvas 2D com atlas de pixel art e blit por tile, tudo inline num único `.html` (sem módulos ES, sem fetch, sem dependência) — medido com folga de ~30× sobre o orçamento de quadro. O renderizador é uma **fronteira substituível** (`Renderer`), então trocar por WebGL2 depois é trocar implementação, não reescrever o motor. Simulação em passo fixo de 60 Hz com acumulador; mundo derivado de uma seed determinística; save = seed + deltas.

**Tech Stack:** JavaScript ES5+/ES2018 sem bundler, Canvas 2D, `localStorage`, Fullscreen API, CSS custom properties; Python 3 + PIL para gerar o atlas; Playwright/CDP para a auditoria.

**Diretório:** `~/Projetos/isoforge/` (renomeável em uma linha — nada aponta para o nome).

---

## 0. Decisões travadas (respondidas antes de começar)

| questão | decisão |
|---|---|
| Arquitetura | **A** — Canvas 2D, arquivo único, dirigido por dados, com a fronteira `Renderer` isolada para permitir migrar a WebGL2 depois |
| Distribuição | **Arquivo único `.html`**, abre com dois cliques, offline |
| Arte | **Script PIL determinístico** gerando o atlas, embutido em data-URI |
| Fatia | **+ um inimigo com IA (idle/chase/attack) e combate simples** |
| Conceito | **Cripta** — masmorra em salas e corredores |

## 0.1 Fase 0 executada e auditada (20/20)

`isoforge.html` (46 KB, `node --check` limpo), auditado por `tools/audit_phase0.py` em navegador real:

| medida | resultado |
|---|---|
| fps | 60,2 (p50 16,7 ms, p95 16,8 ms) |
| custo de desenho | **p95 0,4–0,7 ms** por quadro |
| culling em 1280×633 | **841 desenhados = 841 visíveis**, 0 furos, 0 sobra |
| dpr 2 (2560×1266) | escala de pixel inteira, mesma área de mundo, 841 = 841 |
| projeção 2:1 ida-e-volta | erro máximo 0 em 2.000 amostras |
| determinismo | 2 execuções de 600 passos, hashes idênticos |
| emenda | passo 600 ≡ passo 0 (hash de posição igual) |
| velocidade | 4,2 tiles/s exatos (61 tiques × 0,07) |
| colisão | empurrar contra bloco diagonal não entra no tile; desliza |
| layout | 1280×633 e 390×844 sem overflow, HUD dentro da tela |
| console | limpo em todos os fluxos |

**Três defeitos reais encontrados pela auditoria (e corrigidos):**

1. Osciladores inicializados fora de fase (`x = home` em vez de `home + A·cos(0)`): o passo 600 caía no extremo oposto e o primeiro quadro teleportava meia amplitude. Corrigido com `wandererPosition(w, tick)` como fonte única.
2. Culling iterava o retângulo do losango: 4.489 tiles para 2.104 visíveis (2,1× de desperdício). Agora há teste exato de diamante por tile, com limites estritos para que desenhados == visíveis exatamente.
3. Rodapé de controles estourava em 390 px (agora quebra linha e centraliza).

**Limitação do ambiente de auditoria (não do jogo):** em aba de fundo o navegador suspende `requestAnimationFrame` (`visibilityState: "hidden"`), então o loop parece morto (0 quadros, 0 tiques). O `audit_phase0.py` traz a página para frente e assere `visible` antes de medir.

## 0.2 Pivô: o motor é de TEXTO (arte ASCII), não de pixel art

Requisito que chegou depois: **tudo em arte ASCII**, como no protótipo do navio pirata
(`@session:default/20261012_070611_0915e6`, variante HUGE: 214×69 caracteres, rampa de 91
caracteres, cor por célula). O motor foi reescrito; o arquivo não tem mais canvas nem imagem
nenhuma (o próprio `build.py` falha o build se encontrar `<canvas` ou `data:image`).

**Medição que decidiu o caminho** (grid 214×69 = 14.766 células, mesma fonte, mesmo navegador):

| rota de render | p50 | p95 |
|---|---|---|
| DOM: linhas de texto com corridas de cor | **2,1 ms** | **3,9 ms** |
| canvas: atlas de glifos × cores, 14.766 blits | 9,4 ms | 49,4 ms |

E com a arte real da cripta (185 cores, 60 corridas por linha): 2,54 ms e 135 KB de HTML por
quadro. Ou seja: **texto no DOM é 4× mais rápido na mediana e 12× no p95** — o caminho do navio
não é só o mais bonito, é o mais rápido. Não existe canvas no motor.

**O que sobreviveu ao pivô, sem uma linha alterada:** a simulação (passo fixo, determinismo,
emenda do loop), o A*, a colisão, o save, o gerador por seed e **a matemática de culling/oclusão**
— a projeção 2:1 passou a ser medida em células em vez de pixels (tile 10×3 células = 66×33 px
com fonte de 11 px: a mesma proporção do tile 64×32 do Diablo 2).

**O que mudou:** `atlas.js` + `canvas_renderer.js` saíram; entraram `text_renderer.js` (grade de
caracteres, primitivas de polígono/linha em células, corridas de cor, cache por linha),
`art.js` (a cripta desenhada em glifos) e `world_view.js` (caminhada dos tiles visíveis + ordem
de pintura). O HUD passou a ser **box-drawing desenhado na mesma grade** — sem overlay de DOM.

**Números da versão de texto (auditados, 26/26):**

| medida | resultado |
|---|---|
| grade em 1440×900 | 184 × 69 células (fonte 13,0 px) |
| fps | 59,9 (p50 16,7 ms · p95 17,6 ms) |
| render p95 parado | **1,6 ms** |
| render p95 andando | **4,3 ms** |
| escrita no DOM parado | **0 bytes** (0 de 69 linhas) |
| escrita no DOM andando | 16 KB de 176 KB (6 de 69 linhas) |
| culling | tiles desenhados == tiles que tocam a tela (diff 0, sem furo) |
| clique | célula clicada == tile do destino (projeção inversa exata) |
| arquivo | 61,7 KB, sem canvas, sem imagem, sem `http` |

**Quatro defeitos reais que a auditoria pegou durante o pivô:**

1. Cor do piso variando por célula (mesmo quantizada) → corridas de 1 célula, 162 spans por linha,
   335 KB por quadro e **30 fps**. Passou a ser uma cor por tile (mais o degrau de cima e o de
   baixo): corridas de 5–9 células.
2. `pre.innerHTML` com a grade inteira a cada quadro: o navegador parseia e re-layouta 176 KB
   mesmo quando nada mudou (era o custo real; o render em JS era só 7,8 ms). Cada linha virou um
   elemento próprio, e só as linhas que mudaram são escritas.
3. Hash FNV-1a (uint32) guardado em `Int32Array`: a comparação `===` falhava para todo valor ≥ 2³¹,
   então ~55% das linhas eram reconstruídas à toa. `Uint32Array` resolve.
4. O HUD mostrava spans/kb por quadro no painel principal — valores que mudam sempre, então a grade
   nunca ficava quieta. Métricas por quadro foram para o painel de detalhes (tecla H).

---

## 1. Medições que decidiram a arquitetura

Feitas **antes** do plano, neste Mac, Chromium 155 (headless), página aberta por `file://`:

| medida | valor |
|---|---|
| tiles visíveis em 1920×1080 (tile 64×32, 2:1) | 2.078 |
| Canvas2D, `drawImage` por tile, dpr 1 | **0,56 ms/quadro** |
| Canvas2D, `drawImage` por tile, dpr 2 (backing 3840×2160) | **0,88 ms/quadro** |
| Canvas2D, blit de chunks 512×512 pré-assados | 0,01 ms/quadro |
| `localStorage` em `file://` | escreve, lê e **persiste após reload** (chave `sobreviveu_1791803235789` voltou idêntica) |
| `OffscreenCanvas` / Fullscreen API / IndexedDB / `crypto.getRandomValues` | todos disponíveis |

**Consequência:** desenhar 2.000 tiles custa 3–5% de um quadro de 16,7 ms. O renderizador **não é o gargalo**; chunk bake e WebGL são otimização prematura. O teto real do projeto vai estar em lógica (IA, pathfinding, colisão) e em quantidade de sprites animados, não no chão.

**Ressalvas honestas:** (a) headless Chromium ≠ Chrome/Safari/Firefox do desktop — a Fase 0 re-mede no navegador de verdade antes de qualquer otimização; (b) os números são com tiles já em cache de GPU; (c) `file://` no Safari é historicamente o elo fraco de storage — plano B de uma linha na seção 7.

---

## 2. Opções de arquitetura (decisão #1)

### A — Canvas 2D, arquivo único, dirigido por dados — **recomendada**
- **Entrega:** um `.html` de ~1–1,5 MB com o atlas em data-URI; abre com dois cliques; offline por natureza (nunca faz requisição).
- **Custo medido:** 0,56 ms/quadro de render a 1080p.
- **Fluxo de trabalho:** editar e recarregar. Sem build, sem servidor, sem `npm`.
- **Teto:** luz dinâmica, blend aditivo em volume, 500+ sprites animados simultâneos, 4K a 120 Hz. Nada disso está na fatia.
- **Risco:** se o jogo crescer para "mil inimigos na tela", a migração para B é obrigatória (mas barata, pela fronteira do renderizador).

### B — WebGL2 cru (instanced quads + atlas de textura)
- Um draw call para o chão inteiro, sprites por instância, culling no vertex shader, luz por paleta/tint no fragment.
- **Custo real:** 1.500–2.500 linhas de infraestrutura (shaders, atlas, batches, ordenação por instância, debug sem ferramenta) **antes** do primeiro inimigo andar.
- **Quando vale:** alvo de centenas de sprites com luz e efeitos, ou 4K/120 Hz como requisito.

### C — Vite + TypeScript + biblioteca (three.js/PixiJS)
- Melhor para meses de trabalho, muitos módulos, testes, editor e mais de um jogo no mesmo motor.
- **Custo:** deixa de abrir com dois cliques; exige servidor local e service worker para o offline; o ciclo editar→ver fica mais longo; biblioteca embutida incha o arquivo.
- **Quando vale:** motor genérico de verdade, com equipe e editor de mapa.

**Recomendação:** **A agora**, com a fronteira `Renderer` isolada desde o primeiro commit. B fica a uma troca de arquivo de distância se a medição da Fase 4 pedir.

---

## 3. Camadas do motor

| módulo | arquivo | responsabilidade | garantia verificável |
|---|---|---|---|
| Loop | `src/core/loop.js` | passo fixo 60 Hz, acumulador, clamp de catch-up (máx. 5 passos), alpha de interpolação, medidor p50/p95 | 600 passos = mesmo hash de estado em duas execuções; passo 600 ≡ passo 0 |
| Iso | `src/core/iso.js` | projeção 2:1 `sx=(x−y)·32, sy=(x+y)·16` e **inversa** para o pick do mouse; AABB do losango; câmera com clamp de borda; **matriz fixa, zero rotação** | ida-e-volta de 1.000 pontos com erro < 0,5 tile; clique nas 4 bordas acerta o tile |
| RNG | `src/core/rng.js` | mulberry32; todo o mundo sai de `seed` | mesma seed → mesmo mundo, sempre |
| Grid | `src/world/grid.js` | tiles, bitmap de andável, colisão de círculo contra tiles, deslize em parede, blocos de parede que ocupam tile inteiro (altura no estilo D2, não altura contínua) | não atravessa parede em 10.000 passos de teste; desliza sem travar em quina |
| Path | `src/world/path.js` | A* 8-direções sem cortar quina, custo por terreno (lama/água), fila de waypoints, recálculo ao clicar | 200 caminhos por seed: chega ou falha legitimamente; p95 < 2 ms |
| Gen | `src/world/gen.js` | gerador por seed (salas+corredores p/ cripta, autômato celular p/ caverna) | 100 seeds: flood fill cobre 100% dos tiles andáveis |
| ECS | `src/ecs/*` | componentes em arrays planos (Transform, Velocity, Sprite, Health, Collider, AI, Item) + sistemas (input, movimento, colisão, IA, combate, morte/loot, animação, depth sort) | nenhuma alocação por quadro no caminho quente (medido por contador) |
| Render | `src/render/*` | contrato `Renderer` (`drawTile/drawSprite/drawRect/present/setCamera`), `Canvas2DRenderer`, `culling.js` (losango visível), `atlas.js` (decode do data-URI) | tiles desenhados == esperado pelo losango; zero desenho fora do viewport |
| HUD | `src/ui/*` | HTML/CSS sobreposto: orbes, hotbar, grade de inventário, minimapa, tooltip, log, pausa. Textos em pt-BR, ids/`data-*` em inglês | legível em 390 px; `scrollWidth-clientWidth == 0` no body |
| Save | `src/persist/*` | `isoforge:v1` versionado, save = seed + deltas + posição + inventário + relógio, autosave por evento e a cada 30 s, migração por versão, export/import JSON | round-trip save→load com hash de estado idêntico, inclusive após fechar e reabrir o arquivo |
| Ferramentas | `tools/gen_art.py`, `tools/gen_map.py`, `tools/verify_e2e.py` | atlas pixel art determinístico (PIL), geração/validação de mapa, auditoria de fps e fluxos | `verify_e2e.py` sai com código 0 e relatório JSON versionado |

### Ordem de desenho (painter's algorithm)
`ground → decal → sombra → entidades ordenadas por (x+y, depois x) → paredes/ocluidores → fx → overlay de debug`

### Contrato de performance
- Sim 60 Hz fixo (16,67 ms lógicos/quadro), render desacoplado com interpolação.
- Alvo: **p95 < 8 ms** de quadro com 2.000 tiles + 40 inimigos animados a 1080p. Piso aceito: 30 fps (pedido do usuário) com margem de 4×.
- HUD mostra fps instantâneo e p95 da janela móvel — o número fica visível o tempo todo, não só no relatório.

### Regras de arte
- Tile 64×32; sprite alinhado à **base** do losango, pivô no centro da base; sombra elíptica em camada separada (para poder desenhar sob a entidade).
- Personagem: 8 direções × 8 quadros, estados parado/andando/atacando/morto.
- Paredes 64×96, props 64×64 com pivô na base.
- `imageSmoothingEnabled = false`; renderizar no dpr cheio e apresentar com `image-rendering: pixelated`. Contorno escuro de 1 px em tudo que é sprite (legibilidade sobre piso claro).

---

## 4. Tarefas (bite-sized, cada uma com verificação)

### Fase 0 — fundação verificada no navegador real
- **T1** `~/Projetos/isoforge/` + `git init` + `README.md` com o contrato de performance. Verificar: `git status` limpo.
- **T2** `src/index.html`: canvas em tela cheia, medidor de fps, listener de `resize`/`dpr`. Verificar: abre por `file://`, mostra 60 fps e o dpr correto.
- **T3** `loop.js` com passo fixo + hash FNV-1a por passo. Verificar: duas execuções de 600 passos → hashes iguais; passo 600 ≡ passo 0.
- **T4** `iso.js`: projeção e inversa. Verificar: 1.000 idas-e-voltas com erro < 0,5 tile; clique nas 4 bordas acerta o tile.
- **T5** `camera.js` + `culling.js`. Verificar: contagem de tiles desenhados == esperado; zero desenho fora do viewport.
- **T6** *re-medir no Chrome e no Safari reais* (não headless) e gravar os números no README. Se Safari falhar em `file://`, aplicar o plano B da seção 7.

### Fase 1 — mundo
- **T7** Atlas placeholder de 2 tiles + `Canvas2DRenderer`. Verificar: piso desenhado, sem costura entre tiles.
- **T8** `grid.js` + colisão + movimento provisório por WASD. Verificar: 10.000 passos sem atravessar parede; desliza em quina.
- **T9** Click-to-move com A*. Verificar: 200 caminhos por seed; p95 < 2 ms.
- **T10** `gen.js` por seed. Verificar: 100 seeds conectadas por flood fill.
- **T11** Paredes e props com depth sort. Verificar: oclusão correta em amostragem de posições.

### Fase 2 — arte gerada
- **T12** `gen_art.py`: pisos (grama/terra/pedra), paredes, props; saída em atlas único + data-URI. Verificar: script re-executado gera bytes idênticos (determinismo).
- **T13** Personagem 8 direções × 8 quadros + sombras. Verificar: animação emenda (quadro 8 → quadro 1 sem salto de pixel; hash do quadro igual).
- **T14** Orçamento de tamanho: **teto de 1,5 MB** para o HTML final. Medir e cortar se passar.

### Fase 3 — fatia jogável
- **T15** Inimigo com IA (idle/chase/attack) + separação entre entidades.
- **T16** Combate: alcance, cooldown, dano, morte, respawn, feedback de dano.
- **T17** Loot + inventário em grade (stack, tooltip, equipar/soltar).
- **T18** HUD completo: orbes, hotbar, minimapa, log.
- **T19** Save/load `localStorage` + autosave + export/import. Verificar: round-trip com hash idêntico.

### Fase 4 — auditoria ("confira tudo antes")
- **T20** `verify_e2e.py`: 600 quadros com 40 inimigos → p50/p95 em JSON. Alvo p95 < 8 ms.
- **T21** Fluxos: novo jogo → andar → lutar → lootar → salvar → recarregar → estado idêntico; tela cheia; janela 800×600; viewport 390 px; console sem erro. Verificar: relatório com os quatro viewports.
- **T22** Relatório final: o que foi medido, o que ficou fora, próximo passo.

---

## 5. Critérios de aceite

1. Abre por `file://` com dois cliques e roda offline — verificado com registro de rede vazio durante toda a sessão.
2. p95 de quadro < 8 ms com 2.000 tiles + 40 inimigos animados em 1920×1080 (piso pedido: 30 fps; margem medida ~4×).
3. Simulação determinística: hash igual em duas execuções; passo 600 ≡ passo 0.
4. Save/load round-trip com hash de estado idêntico, inclusive após fechar e reabrir o arquivo.
5. Câmera **nunca** rotaciona a tela: matriz de projeção fixa, provada por teste (o vetor de tela de um tile N do jogador é sempre o mesmo).
6. HUD sem overflow em 390 px; nenhum erro de console em nenhum fluxo.
7. Código em inglês (ids, `data-*`, chaves de JSON, comentários, commits); texto visível em português.

---

## 6. Riscos e tradeoffs

- **Headless ≠ desktop:** os 0,56 ms são do Chromium headless. Fase 0 re-mede em Chrome e Safari reais antes de otimizar qualquer coisa.
- **Balde único de storage em `file://`:** todas as páginas locais compartilham o mesmo `localStorage` (confirmado: as chaves do meu probe apareceram no bucket `file://`). Namespace obrigatório `isoforge.v1.*` para não colidir com os outros artefatos locais dele (`mosaico-dos-afetos.html`, `relatorio-uncover.html`, `navio-pirata-ascii`).
- **`localStorage` ~5 MB:** save é seed + deltas (leve). Se entrar áudio/imagem de save, migra para IndexedDB.
- **Pixel art gerada por script** tem cara de gerada. Se o visual travar, o caminho é `imagegen` por peça + PIL compondo o atlas (decisão #2).
- **"Engine completa" é escopo infinito:** este plano entrega motor + uma fatia jogável. Editor de mapa, luz dinâmica, PWA instalável e multiplayer ficam **nomeados como fora** — não entram por acidente.

---

## 7. Plano B (se o Safari falhar em `file://`)

Servir por `python3 -m http.server 8000` a partir de `~/Projetos/isoforge/` (uma linha, nada no motor muda) e, opcionalmente, virar PWA instalável com manifest + service worker. Custo: perde o "dois cliques" e ganha ícone no dock + offline com cache explícito.

---

## 8. Questões abertas (perguntadas antes de começar)

1. Arquitetura: A (Canvas 2D arquivo único) / B (WebGL2 cru) / C (Vite+TS+biblioteca).
2. Distribuição: arquivo único por dois cliques / PWA servida localmente / arquivo único agora e PWA depois.
3. Arte: script PIL determinístico embutido / procedural no boot por código / `imagegen` para sprites + PIL para compor.
4. Escopo da primeira fatia: só motor (câmera, colisão, pathfind) / + um inimigo e combate / + loot, inventário e save.
5. Conceito da fatia: cripta (masmorra fechada) / ruínas ao ar livre / vila e feira (sem combate).
