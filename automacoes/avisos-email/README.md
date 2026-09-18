# Avisos por e-mail

Quando alguém vira owner de uma demanda, entra como responsável, é marcado
com @ na descrição ou numa anotação, ou quando uma demanda vai para
Impeditivo/Aprovação ou Feito, a pessoa recebe o aviso na plataforma (toast
na hora e sino) e por e-mail.

## Como funciona

1. Um gatilho em `tasks` grava a linha em `task_mentions` (é a mesma tabela
   que o @ já usava; o que muda é a coluna `origem`: `owner`,
   `responsavel`, `status`, `descricao`, `anotacao`).
2. Um gatilho em `task_mentions` grava uma linha em `email_fila`, já com o
   e-mail do alvo, o assunto e o corpo prontos, e o link direto para a
   demanda (`https://modestopartners.com.br/#demanda=<id>`).
3. O `apps-script.gs` desta pasta lê a fila a cada 5 minutos e envia pelo
   Gmail da conta que rodar o script. Marca `enviado_em`; se falhar, conta
   a tentativa e guarda o erro; desiste na quinta.

Quem agiu não recebe aviso da própria ação.

Aviso com mais de 6 horas na fila é marcado como expirado e não sai: se o
script ficar parado, ou for instalado com backlog, ninguém recebe uma
enxurrada atrasada. Os gatilhos no banco já estão ligados; a fila acumula
até o script entrar.

## Instalar

1. Abra o projeto do Apps Script do relatório semanal (ou crie um) e cole o
   `apps-script.gs` como um arquivo novo.
2. Confira as propriedades `SUPABASE_URL` e `SUPABASE_KEY` (service_role).
   Se o projeto do relatório já as tem, não há o que fazer.
3. Rode `enviarAvisos()` uma vez na mão e autorize o Gmail.
4. Rode `instalarAcionadorDeAvisos()` uma vez.

## Por que Apps Script e não uma Edge Function

Porque não exige contratar nem verificar nada: o Gmail da conta já existe e
o projeto do Apps Script já roda o relatório semanal com a mesma chave. O
custo é a latência de até 5 minutos e a cota diária do Gmail. Se um dia isso
apertar, o caminho é uma Edge Function chamada por `pg_net` no gatilho, com
um provedor como o Resend e o domínio verificado; a fila continua a mesma.
