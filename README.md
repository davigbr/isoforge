# Isoforge

**Motor de jogos isométricos em arte ASCII** (projeção 2:1 fixa, **sem rotação de tela**) para o
browser. Roda offline, abre com dois cliques e não tem dependência nenhuma. O arquivo entregue não
tem canvas nem imagem: a tela inteira é **uma grade de caracteres com cor por célula**, no mesmo
pipeline do protótipo do navio pirata.

Plano completo: `.hermes/plans/2026-10-12_080752-isoforge-motor-isometrico.md`

## Como rodar

```bash
python3 build.py          # gera isoforge.html a partir de src/
open isoforge.html        # ou dois cliques no Finder
```

`isoforge.html` é o único artefato que importa: um arquivo, offline, sem servidor. `src/` é a fonte
modular; nunca editar o HTML gerado à mão. O build **falha de propósito** se o resultado tiver
`<canvas`, `data:image` ou `http` — é o que garante "tudo em ASCII".

**O jogo roda 100% no browser.** Python aparece em três lugares, nenhum deles na execução:

- `build.py` — concatena `src/` no HTML único e valida a sintaxe com `node --check` (erro de
  sintaxe dentro do arquivo único falha em silêncio no browser: a página fica em branco).
- `tools/looktest_iso_ascii.py` — teste de olhar: a mesma cripta em duas escalas de tile, amostrada
  pelo pipeline do navio (PIL em 4× → média de área → rampa por luminância com gama 1.9 → cor por
  célula).
- `tools/audit_text.py` — a auditoria: navegador de verdade (Playwright) para medir fps, culling,
  determinismo, clique e layout.

```bash
PYTHONPATH= ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_text.py
```

(O prefixo `PYTHONPATH=` é obrigatório neste ambiente: a variável aponta para o `site-packages` de
outro Python e quebra a importação do Playwright/PIL.)

## Controles

`W A S D`/setas andar · clique no chão caminha até o tile · `F` tela cheia · `H` detalhes ·
`R` nova semente · `G` regerar a mesma (prova visual do determinismo).

## Arquitetura (texto)

| módulo | papel |
|---|---|
| `src/core/iso.js` | projeção 2:1 em **células** (10×3 células por tile = 66×33 px), inversa exata, câmera, clamp, culling |
| `src/core/loop.js` | passo fixo de 60 Hz, acumulador, medidor p50/p95, hash FNV-1a |
| `src/world/grid.js` | grade andável, variante de piso, flood fill da maior região |
| `src/sim/sim.js` | simulação determinística + pontos de entrada da auditoria |
| `src/render/text_renderer.js` | grade de caracteres, polígono/linha em células, corridas de cor, **cache por linha** |
| `src/render/art.js` | a cripta em glifos (piso, parede, pilar, tocha, ossada, herói, monstro, cursor) |
| `src/render/world_view.js` | caminha os tiles visíveis e pinta na ordem de pintura (x+y, desempate x) |
| `src/ui/hud.js` | HUD de **box-drawing dentro da grade** (sem overlay de DOM) |

## Contrato de performance

- Simulação em passo fixo de 60 Hz; render desacoplado com interpolação.
- Alvo: **p95 de quadro < 25 ms** e **render p95 < 8 ms**. Medido: parado render p95 **1,6 ms**;
  andando **4,3 ms**; p95 de quadro **17,6 ms**.
- O custo de DOM é proporcional ao que mudou na tela: **0 bytes por quadro parado**, 16 KB de 176 KB
  andando (6 de 69 linhas). Andar não reescreve a grade inteira — a câmera desloca uma fração de
  célula por quadro, então só as linhas onde a fase de arredondamento vira mudam.
- Regra que sustenta tudo isso: **corrida de cor longa é o que barateia um quadro de texto**. Cor
  por célula (mesmo quantizada) quebra a corrida a cada célula; cor por tile dá corridas de 5–9.
- `localStorage` em `file://` foi verificado: escreve, lê e persiste após reload. Namespace
  obrigatório: `isoforge.v1.*` (todas as páginas locais dividem o mesmo balde de storage).

## Resultado da auditoria (26/26)

| medida | resultado |
|---|---|
| grade em 1440×900 | 184 × 69 células (fonte 13,0 px) |
| fps | 59,9 (p50 16,7 ms · p95 17,6 ms) |
| culling | tiles desenhados == tiles que tocam a tela, sem furo |
| determinismo | hashes idênticos em 2 execuções de 600 passos |
| emenda | passo 600 ≡ passo 0 |
| velocidade | 4,2 tiles/s exatos |
| clique | célula clicada == tile do destino |
| layout | sem barra de rolagem em 1440×900, 1280×633 e 390×844 |
| arquivo | 61,7 KB, sem canvas, sem imagem, sem rede |

## Regras do projeto

- Código em inglês (ids, `data-*`, chaves de JSON, comentários, commits); texto visível ao jogador em
  português.
- Nada de dependência, módulo ES, `fetch` ou backend: o jogo precisa funcionar por `file://`.
- Regenerável: todo artefato sai de um script (`build.py`, `tools/audit_text.py`,
  `tools/looktest_iso_ascii.py`).

## Estado

Fase 0 concluída e auditada, **já no modo texto**. Falta: arte gerada por PIL amostrada para
templates de caractere (`assets/art.json`, âncora `ART_TEMPLATES` já no build), A* de verdade,
gerador de cripta em salas e corredores, um inimigo com IA e combate.
