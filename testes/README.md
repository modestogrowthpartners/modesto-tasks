# Testes

Playwright com um Supabase dublê. Sem rede, sem banco real.

```
node testes/jornada.mjs                    # jornada de ponta a ponta
node testes/cliente.mjs                    # o que o cliente vê e o que não vê
node testes/nps.mjs                        # MGP NPS: discovery, revisão e painel
node testes/regressao.mjs /caminho/absoluto/index.html > snap.json   # retrato das 14 telas
node testes/xss.mjs       /caminho/absoluto/index.html               # injeção por nome e por avatar
```

O `regressao` e o `xss` abrem o arquivo por `file://`, então o caminho
precisa ser **absoluto**. Com caminho relativo o Playwright tenta
`file://undefined/` e o erro que aparece (`ERR_INVALID_URL`) não diz que o
problema é esse. O `jornada` e o `cliente` servem por HTTP e não precisam
de argumento.

## `stub.js`

Reproduz o contrato que o `index.html` usa: `from`, `rpc`, `auth`,
`storage`, `channel` e `functions.invoke`. Persiste mensagens no
`localStorage`, e é por isso que a jornada roda por HTTP e não por
`file://`: em `file://` o Chromium desliga o `localStorage` e o teste de
persistência não valeria nada.

Desde a rodada do MGP NPS, `update` e `delete` esperam o filtro. Antes eles
gravavam dentro da própria chamada, e `.update(v).eq('id', x)` chega nesta
ordem: quando a gravação acontecia, `eq` ainda não tinha entrado e a escrita
caía em **todas** as linhas da tabela. Os testes passavam gravando na linha
errada. Agora a escrita só acontece quando alguém pede o resultado, com os
filtros montados, que é como o Supabase se comporta. Consequência prática:
`update` e `delete` que ninguém aguarda não gravam nada.

O comportamento do Kronos é escolhido em tempo de teste:

```js
window.__KRONOS_MODO = 'texto' | 'confirmar' | 'sem_chave' | 'fora'
window.__KRONOS_EXEC_FALHA = 1     // força o banco a recusar a execução
window.__KRONOS_PUBLICAR_FALHA = 1 // força falha ao publicar no canal
```

## `regressao.mjs`

Percorre as 14 telas e grava tamanho do HTML, título, classes do body,
barra de baixo e atalhos. Serve para comparar antes e depois de um
refactor: o que não deveria mudar tem que sair idêntico.

## `nps.mjs`

A jornada do MGP NPS, alternando entre a equipe e o cliente na mesma página:
a equipe envia o Pré-Discovery e o Client Discovery, o cliente responde, a
revisão de 60 dias nasce com a continuidade do discovery já preenchida, o
cliente recebe o retorno na hora e a equipe lê o painel. Confere também o
cálculo do MGPI contra a planilha `Modesto_CIP_MGPR_V1`, pilar por pilar, e
que o retorno ao cliente não mostra nota nem classificação.

## O que os testes NÃO cobrem

- O caminho real com o Supabase de produção. Tudo aqui é dublê.
- A chamada real à Edge Function e à API da Anthropic.
- Tempo real, presença e upload de anexo.
