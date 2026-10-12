# Isoforge

Motor de jogos isométricos (projeção 2:1 fixa, **sem rotação de tela**) para o
browser. Roda offline, abre com dois cliques e não tem dependência nenhuma.

Plano completo: `.hermes/plans/2026-10-12_080752-isoforge-motor-isometrico.md`

## Como rodar

```bash
python3 build.py          # gera isoforge.html a partir de src/
open isoforge.html        # ou dois cliques no Finder
```

`isoforge.html` é o único artefato que importa: um arquivo, offline, sem
servidor. `src/` é a fonte modular; nunca editar o HTML gerado à mão.

**O jogo roda 100% no browser** (JavaScript + Canvas 2D). Python aparece em
dois lugares, nenhum deles na execução do jogo:

- `build.py` — fora de linha, concatena `src/` no HTML único e valida a sintaxe
  com `node --check` (erro de sintaxe dentro do arquivo único falha em silêncio
  no browser: a página fica em branco).
- `tools/audit_phase0.py` — a auditoria: dirigindo um navegador de verdade
  (Playwright) para medir fps, culling, determinismo e layout.

```bash
PYTHONPATH= ~/.hermes/hermes-agent/venv/bin/python3 tools/audit_phase0.py
```

(O prefixo `PYTHONPATH=` é obrigatório neste ambiente: a variável aponta para o
`site-packages` de outro Python e quebra a importação do Playwright/PIL.)

## Resultado da Fase 0 (20/20 verificações)

| medida | resultado |
|---|---|
| fps | 60,2 (p50 16,7 ms · p95 16,8 ms) |
| custo de desenho | p95 0,4–0,7 ms por quadro |
| culling | 841 desenhados = 841 visíveis, sem furo nem sobra |
| dpr 2 | escala de pixel inteira, mesma área de mundo |
| projeção | erro máximo 0 (2.000 amostras ida-e-volta) |
| determinismo | hashes idênticos em 2 execuções de 600 passos |
| emenda | passo 600 ≡ passo 0 |
| velocidade | 4,2 tiles/s exatos |
| layout | 1280×633 e 390×844 sem overflow |

Relatórios: `reports/phase0-audit.json`, `reports/phase0-screen.png`.

## Contrato de performance

- Simulação em passo fixo de 60 Hz (16,67 ms lógicos por quadro), render
  desacoplado com interpolação.
- Alvo: **p95 de quadro < 8 ms** com 2.000 tiles + 40 inimigos animados a
  1080p. Piso aceito: 30 fps.
- Medições de referência (Chromium 155 headless, `file://`, dpr 1):
  2.078 tiles visíveis custam **0,56 ms/quadro** por `drawImage`;
  em dpr 2 (backing 3840×2160), **0,88 ms/quadro**.
- `localStorage` em `file://` foi verificado: escreve, lê e persiste após
  reload. Namespace obrigatório: `isoforge.v1.*` (todas as páginas locais
  dividem o mesmo balde de storage).

## Regras do projeto

- Código em inglês (ids, `data-*`, chaves de JSON, comentários, commits);
  texto visível ao jogador em português.
- Nada de dependência, module ES, `fetch` ou backend: o jogo precisa funcionar
  por `file://`.
- Regenerável: todo artefato sai de um script (`build.py`, depois
  `tools/gen_art.py`).

## Estado

Fase 0 — fundação (loop determinístico, projeção, câmera, culling, HUD).
Fases 1–4 no plano.
