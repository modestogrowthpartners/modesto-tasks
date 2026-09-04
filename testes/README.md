# Testes

Playwright com um Supabase dublê. Sem rede, sem banco real.

```
node testes/jornada.mjs     # 23 casos de ponta a ponta
node testes/regressao.mjs <arquivo.html> > snap.json   # retrato das 14 telas
node testes/xss.mjs <arquivo.html>                     # injeção por nome e por avatar
```

## `stub.js`

Reproduz o contrato que o `index.html` usa: `from`, `rpc`, `auth`,
`storage`, `channel` e `functions.invoke`. Persiste mensagens no
`localStorage`, e é por isso que a jornada roda por HTTP e não por
`file://`: em `file://` o Chromium desliga o `localStorage` e o teste de
persistência não valeria nada.

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

## O que os testes NÃO cobrem

- O caminho real com o Supabase de produção. Tudo aqui é dublê.
- A chamada real à Edge Function e à API da Anthropic.
- Tempo real, presença e upload de anexo.
