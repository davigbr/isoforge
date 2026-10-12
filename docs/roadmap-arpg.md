# Roadmap: o que falta no motor para um ARPG estilo Diablo 2

Plano de trabalho, em ordem de dependência. Regra que vale para cada item: o
**motor** recebe sistema reutilizável por qualquer jogo isométrico; o **jogo**
recebe conteúdo. Item que só serve à cripta não entra aqui.

Decisões assumidas (recomendadas pelo autor do plano, revisáveis):

1. **Fatia vertical primeiro** — clicar no monstro, a rota ser calculada, encostar,
   bater, ele morrer e largar um item que se pega. Prova os itens 1, 2 e parte do 6
   numa fatia jogável, em vez de oito sessões sem nada jogável.
2. **Tempo de golpe real** (preparar → acertar → recuperar), medido em tiques
   inteiros. É o que dá peso ao combate; trocar isso depois desbalanceia o que já
   existe.
3. **Som sintetizado no navegador** (WebAudio, zero arquivo) em vez de gravações
   embutidas: mantém o arquivo único e o offline de verdade.

## P0 — sem isso não existe o jogo

| # | item | onde | estado | tamanho |
|---|---|---|---|---|
| 1 | **Achar caminho e seguir** — rota por volta dos obstáculos, recalculada quando algo bloqueia | motor | **entregue** | 1 sessão |
| 2 | **Combate e criaturas com números** — entidade (vida, time, raio, camada), acerto/erro, dano com modificadores, morte/remoção, tempos de golpe, esperas e recargas em tiques, índice espacial para consultas de vizinhança | motor | — | 1–2 |
| 3 | **Save confiável** — esquema versionado, escrita atômica, migração, corrupção tolerada; salva personagem e progresso, nunca o mapa (o mapa sai da semente) | motor | — | 1 |
| 4 | **Sorteio separado por finalidade** — geradores distintos para loot, IA e variação de dano, senão gastar um número num sistema desalinha os outros | motor | — | ¼ |

## P1 — o que faz *parecer* um ARPG

| # | item | onde | tamanho |
|---|---|---|---|
| 5 | **Interface clicável na grade de texto** — inventário em grade, barra de habilidades, dica ao passar o mouse, arrastar item, abas, listas | motor | 2 |
| 6 | **Itens: álgebra e contêineres** — soma/multiplicação de modificadores, resistências, equipar/desequipar recalculando, pilha; as tabelas de afixos são do jogo | motor + jogo | 2 |
| 7 | **IA de inimigos** — parado/patrulha/persegue/ataca/foge, percepção por visão e linha de visão, grupos | jogo | 2 |
| 8 | **Névoa de guerra e mapa explorado** — bitmap de explorado, escurecimento, minimapa em texto, linha de visão para tochas e ataques à distância | motor | 1 |
| 9 | **Objetos maiores que um tile** — 2×2, 3×3, com sombra e oclusão corretas | motor | 1 |

## P2 — polimento e peso do conteúdo

| # | item | onde | tamanho |
|---|---|---|---|
| 10 | **Som sintetizado** (WebAudio, sem arquivo) com liberação após gesto do usuário | motor | 1 |
| 11 | **Arte amostrada de imagem** — pipeline do barco: desenhar no PIL, extrair caractere e cor por célula; silhueta real para monstros e itens | ferramenta | 1–2 |
| 12 | **Projéteis e efeitos de área** — flechas, cones, explosões, empurrão | motor | 1 |
| 13 | **Atos, quests, NPCs, cidade, waypoints** | jogo | semanas |
| 14 | **Níveis, experiência, árvore de habilidades, dificuldades** | jogo | semanas |

## Fora de escopo (e por quê)

- **Multiplayer**: o motor é um arquivo offline com estado no navegador; sincronizar
  jogadores é outro projeto.
- **Toque no celular**: grade de texto com dedo é sofrível; a cripta é de desktop.
- **Elevação de terreno**: o Diablo 2 é essencialmente plano; não paga o esforço.
  Se um dia for necessário, a projeção já é isolada numa função.

## Como cada item é entregue

Um item por vez, e cada um só é considerado pronto com a auditoria de ponta a ponta
verde nos **dois** jogos (a arena de exemplo, que prova que o motor não é soldado na
cripta, e a cripta). Teste unitário e de integração não são usados: a verificação é
no navegador, contra o artefato real, e verificação de bytes/versão fica no build.
