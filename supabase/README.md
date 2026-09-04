# Backend do MGP Tasks

O que roda fora do `index.html`. Até agora isto vivia só dentro do painel
do Supabase, sem versão e sem revisão. Agora está aqui.

Projeto: `eeqaabwsheaiwyhujcqj`

## `functions/luquinhas`

A Edge Function do assistente. É o Claude com as ferramentas da
plataforma, e o desenho dela sustenta duas garantias que não dependem de
boa vontade do modelo:

1. **Ela herda a permissão de quem chamou.** O cliente Supabase é criado
   com a chave pública mais o `Authorization` da pessoa. Não existe
   `service_role` na função. Se alguém não pode criar uma demanda na mão,
   também não cria pelo Luquinhas: quem recusa é a RLS.

2. **Escrita nunca acontece dentro da conversa com o modelo.** O modelo
   só PROPÕE. A execução é uma segunda chamada, no modo `executar`,
   disparada depois que a pessoa clicou em Confirmar na tela. Por isso o
   "criei a demanda" não pode ser inventado: quem relata o resultado é o
   banco.

### Segredos

| Segredo | Obrigatório | Para quê |
|---|---|---|
| `ANTHROPIC_API_KEY` | sim | sem ela a função responde `sem_chave` e a tela diz isso, em vez de fingir |
| `LUQUINHAS_MODEL` | não | troca o modelo; o padrão é `claude-sonnet-5` |

`SUPABASE_URL` e `SUPABASE_ANON_KEY` já vêm do ambiente.

Definir em: Project Settings → Edge Functions → Secrets.

### Publicar

```
supabase functions deploy luquinhas --project-ref eeqaabwsheaiwyhujcqj
```

## `migrations/`

Doze migrações, na ordem em que foram aplicadas. As quatro primeiras
saíram do histórico do próprio banco; as demais são as desta rodada.

| Arquivo | O que resolve |
|---|---|
| `..._chat_rls_fix_e_rpcs` | o 403 do chat, o excluir mensagem que falhava calado, e a policy de UPDATE aberta que deixava qualquer um reescrever mensagem alheia |
| `..._chat_conversa_direta_e_privada` | conversa direta era legível por qualquer admin |
| `..._diretorio_canonico_de_usuarios` | cliente não conseguia resolver nome nem foto de ninguém |
| `..._anexo_de_chat_para_cliente` | cliente anexar arquivo, só na pasta da própria empresa |
| `..._mgp_chat_conversas_e_threads` | threads, conversa direta sem duplicar, busca de mensagem |
| `..._mgp_luquinhas_memoria_e_auditoria` | memória e auditoria do assistente, e a publicação da resposta no canal |
| `..._mgp_perfis_sem_escalacao_e_auditoria` | escalada de papel, último admin, auditoria, limite de avatar |
| `..._mgp_perfis_gatilhos_so_para_sessao_de_usuario` | correção: os gatilhos acima trancavam a administração fora de sessão |
| `..._mgp_fecha_execute_das_funcoes` | função de gatilho deixou de ser endpoint em `/rest/v1/rpc` |
| `..._mgp_diretorio_com_data_de_entrada` | "membro desde" com data real, e canais em comum |
| `..._mgp_responsaveis_por_id` | vínculo de responsável por id, e o rename que não órfã mais as demandas |
| `..._mgp_perfil_do_lucas` | o Lucas tinha login desde julho e nunca teve perfil |

## Pendências conhecidas

- **Confirmação de senha vazada está desligada** no Auth. Ligar em
  Authentication → Password security.
- **"Allow new users to sign up"** precisa ser conferido. Se estiver
  ligado, qualquer pessoa cria conta com a chave anon, que está no HTML.
- **Bucket `documents` sem limite de tamanho** de arquivo.
- **Remover acesso não remove o login.** Hoje apaga a linha em `profiles`,
  mas o usuário continua no Auth e o perfil é recriado no próximo login.
  A saída correta é uma Edge Function com `service_role`.
- **Duas contas órfãs no Auth**, sem perfil: `patricia@modestogrowth.com.br`
  (nunca logou) e `vanessa.modesto@modestogrowth.com.br` (a Vanessa tem
  duas contas; o perfil está na `.com`, sem o `.br`).
