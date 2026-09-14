# Controle de Pacing: o que o arquivo revelou

Lido em 14/09/2026 a partir de `[Interno para teste] de Controle Pacing`
(`1bxa-S9p8dU57_Y3j1tCiiPEmpl5LQH-D5J5Bg8BIbow`, Google Sheets, dono Elias
Braga), exportado para `.xlsx` e aberto com openpyxl.

22 abas, exatamente as que a especificação previa. O que segue é o que só
apareceu ao abrir.

## 1. O arquivo usa all_conversions, e o prompt proíbe

A aba `AMK Google` tem este cabeçalho:

| Coluna | Rótulo |
|---|---|
| B | `Cost (Spend)` |
| C | `Impressions` |
| D | `Clicks` |
| E | `CTR` |
| F | **`All conv.`** |
| G | **`All Conv. rate`** |
| H | `Total conv. value` |

O prompt do agente manda usar `conversions` e nunca `all_conversions`, porque
`all_conversions` mistura a compra real com ligação e visita a página. O arquivo
hoje é alimentado com `All conv.`.

Os dois não podem estar certos ao mesmo tempo. Ou o arquivo passa a receber
`conversions` e o histórico de setembro fica em régua diferente do resto do mês,
ou o prompt cede e o CPA de todas as contas continua otimista.

**Decisão de humano.** O agente não troca isso sozinho.

## 2. Amakha: a receita consolidada não soma

`D19` da aba AMAKHA PARIS, que é "Receita realizada TOTAL", aponta para
`=AF68`, e `AF68` é `=SUM(AF37:AF67)`.

**23 das 31 células de `AF37:AF67` estão vazias.** Não têm fórmula nenhuma.

As colunas vizinhas dependem dela: `AG` (ticket médio consolidado) é
`=IFERROR(AF/AC,0)` e `AH` (ROAS consolidado) é `=IFERROR(AF/Y,0)`.

O efeito em cadeia, só na Amakha:

| Célula | O que é | Estado |
|---|---|---|
| `D19` | Receita realizada total | subestimada |
| `D20` | % da meta atingido | subestimado |
| `D21` | Projeção de receita | subestimada |
| `D22` | Gap projetado vs meta | inflado |
| `D26` | ROAS total | subestimado |
| `D27` | STATUS NEGÓCIO | tende a "ABAIXO DA META" sem ser verdade |

E isso sobe para o `PAINEL`, que lê `'AMAKHA PARIS'!D19` na coluna de receita
realizada.

É exclusivo da Amakha. Nas outras abas a coluna está preenchida e `D19` é
`=B19+C19`, que é a forma correta:

| Aba | `AF37:AF67` vazias | `D19` |
|---|---:|---|
| AMAKHA PARIS | 23 de 31 | `=AF68` |
| ALLIANCE BR | 1 de 31 | `=B19+C19` |
| MEU RODAPE | 1 de 31 | `=SUM(W37:W67)` |
| RUMINAR | 0 de 31 | `=B19+C19` |
| D&G | 0 de 31 | `=B19+C19` |
| BARBIE | 0 de 31 | `=B19+C19` |

Isto é diferente dos 378 `#VALUE!` já conhecidos. Lá a fórmula existe e devolve
erro em dia futuro. Aqui a fórmula **não existe**, e o erro é silencioso: a
célula fica em branco, a soma ignora, e o número sai menor sem sinal nenhum.

## 3. Amakha: 29 fórmulas testam uma coluna e devolvem outra

`G37` está correta:

```
=(IF('AMK Google'!F2="","",'AMK Google'!F2))
```

`G38` até `G67`, não:

```
=(IF('AMK Google'!E3="","",'AMK Google'!F3))
```

O teste olha `E` (CTR) e o valor vem de `F` (conversões). Dia com CTR vazio
zera a conversão do dia mesmo havendo conversão registrada, e `G` alimenta
`H` (taxa de conversão), `I` (CPA) e `AC` (conversões consolidadas).

29 das 31 linhas estão assim. Parece arrasto de fórmula a partir de uma linha
já errada.

## 4. Correção no mapa da Ruminar

A especificação dizia que `RUM Meta` soma duas contas nas colunas `G:K` e
`N:R`. Os blocos reais são **`G:K` e `M:Q`**.

`A:E` é o consolidado, e já é fórmula: `B2` é `=IF(H2="","",H2+N2)`. O agente
escreve nos dois blocos de origem e não toca em `A:E`.

## 5. Alliance BR e LATAM não se separam no Meta

`ALI Meta` tem um bloco só (`A:E`), não dois. As duas abas de cliente leem a
mesma coluna, então o gasto de Meta da Alliance é um número único para BR e
LATAM somados. Separar exige mudar o arquivo.

## 6. Quem recebe o quê

O `PAINEL` nomeia responsável por conta, e a `INSTRUCOES` nomeia o
escalonamento. São papéis diferentes:

| Conta | Responsável |
|---|---|
| AMAKHA PARIS, ALLIANCE BR, ALLIANCE LATAM, RUMINAR, D&G | Everton |
| MEU RODAPE, WONDR EXPERIENCE, BARBIE, DABELA SITE, DABELA REVENDA | Phellip |

`INSTRUCOES` L21 e `PAINEL` L2 dizem a mesma coisa: vermelho escala para o
**Lucas**.

Então "mandar para o Everton" cobre 5 das 10 contas. As outras 5 são do
Phellip, e o vermelho de qualquer uma delas é do Lucas.

## 7. A matriz de realocação, que ainda não estava no agente

`INSTRUCOES` L23 a L26, e já implementada em fórmula nas linhas 29 a 32 de cada
aba de cliente:

| ROAS vs meta | Pacing | Recomendação |
|---|---|---|
| acima | abaixo de 1,00 | **RECEBER VERBA**, performa e sobra budget |
| acima | 1,00 ou mais | **MANTER**, performa mas budget no limite |
| abaixo | acima de 1,00 | **REDUZIR**, gasta acima do ritmo sem entregar |
| abaixo | sob controle | **REVISAR CAMPANHAS**, problema de estrutura, não de verba |

Sem meta de ROAS preenchida a fórmula devolve "— preencher meta de ROAS —".

## 8. Não existe fila de alertas

Nenhuma aba `ALERTAS`, `ALERTA`, `AJUSTES` ou `ALERTS` entre as 22. Então o
Apps Script não lê alerta deste arquivo: ou ele lê o `PAINEL` direto, ou vive
em outro lugar.

Enquanto isso não for esclarecido, o agente para a entrega e avisa, em vez de
criar uma aba que ninguém lê.

## 9. Mapa de escrita confirmado

Aba bruta, linha 2 é o dia 1. Linha do dia N é `N+1`.
Aba de cliente, linha 37 é o dia 1. Linha do dia N é `36+N`.

| Aba bruta | Colunas |
|---|---|
| `AMK Google` | B custo, C impressões, D cliques, E CTR, F conversões, G taxa, H receita |
| `AMK Meta` | B gasto, C impressões, D link clicks, E compras, F valor das compras |
| `ALI Meta` | B gasto, C impressões, D link clicks, E leads |
| `RUM Meta` | `G:K` conta 1, `M:Q` conta 2, `A:E` consolidado por fórmula |

## 10. Conferência de orçamento

Amakha: `B6` = 36.000 Google, `C6` = 34.000 Meta, total 70.000 BRL. Bate com o
`meta_mes` do `contas.json`. Meta de ROAS 3,0 e meta de CPA 90 nos dois
veículos.

## 11. O bloco META muda de coluna dependendo da aba

Conferido de duas formas independentes: pelo cabeçalho da linha 36 e pelo mapa
de células amarelas.

| Campo (Meta) | Maioria das abas | **MEU RODAPE e BARBIE** |
|---|---|---|
| Inv. Planejado | `M` | `N` |
| Inv. Realizado | `N` | `O` |
| Impressões | `O` | `P` |
| Cliques | `P` | `Q` |
| Conversões | `R` | `S` |
| Receita | `U` | `V` |

Um deslocamento de uma coluna. É por isso que essas duas abas vão até `AI` e as
outras param em `AH`.

Escrever o gasto de Meta na coluna `N` do Meu Rodapé colocaria o número em
**Investimento Planejado**, não em Realizado. O erro não dá erro: o pacing
simplesmente passa a comparar o planejado com ele mesmo.

**Regra: ler o cabeçalho da linha 36 da aba antes de escrever, sempre.** Nunca
assumir a coluna por analogia com outra aba.

## 12. Onde ficam as células amarelas

Amarelo é `FFFFF2CC`. As abas de dados brutos **não têm célula amarela
nenhuma**: o amarelo vive só nas abas de cliente.

Por aba de cliente, cerca de 380 células amarelas:

| Faixa | O que é |
|---|---|
| linhas 6 a 8, colunas do bloco | budget do mês e cabeçalho de controle |
| linhas 37 a 67 | o registro diário, uma linha por dia |

Nas contas em modo fórmula, a célula amarela **já contém fórmula** apontando
para a aba bruta (ex: `AMAKHA PARIS!D37` é
`=(IF('AMK Google'!C2="","",'AMK Google'!C2))`). Amarelo ali significa "campo de
entrada do processo", não "digite aqui por cima".

Sobrescrever essas com número mata o vínculo com a aba bruta para o mês inteiro.
Nas contas em modo manual (Meu Rodapé, Barbie, Wondr, Dabela) a amarela tem
número mesmo, e é onde se escreve.

## 13. O conector do Drive não escreve célula

Verificado nas ferramentas disponíveis:

| Ferramenta | O que faz |
|---|---|
| `update_file` | **só metadados**: título e pasta. Não toca em conteúdo |
| `create_file` | cria arquivo **novo**. Não edita existente, não cria aba |
| `read_file_content`, `download_file_content` | leitura |

Não há conector de Google Sheets com escrita de célula no registro desta conta.
Busca por "google sheets", "spreadsheet write" e "planilha" devolve Smartsheet,
Tiller, Aleph e Rockhopper, nenhum deles ligado a esta planilha.

**Consequência:** o agente não consegue preencher as células amarelas nem criar
a aba `ALERTAS` neste arquivo. Ele lê tudo e calcula tudo, mas a escrita precisa
de outro braço.

O braço natural é o **Apps Script**, que tem `SpreadsheetApp` nativo. Desenho
proposto: o agente grava um JSON do dia numa pasta do Drive (`create_file`
funciona), e o Apps Script lê esse JSON, preenche as amarelas, monta a aba
`ALERTAS` e dispara o aviso.
