-- REGRESSÃO CAUSADA PELA PRIMEIRA MIGRAÇÃO DESTA SÉRIE, e conserto aqui.
--
-- chat_rls_fix_e_rpcs derrubou a policy messages_update_reagir, que era
-- um `using(true) with check(true)` e deixava qualquer pessoa reescrever
-- o corpo de qualquer mensagem. Derrubar estava certo.
--
-- O que passou batido: a versão publicada em modestopartners.com.br
-- ainda reage com UPDATE direto em messages. Sem aquela policy, reagir na
-- mensagem de outra pessoa passou a afetar zero linhas, EM SILÊNCIO: a
-- reação aparecia na tela e não era gravada.
--
-- A saída não é devolver a policy aberta. É permitir o UPDATE e travar,
-- por gatilho, tudo que não seja reação. Continua valendo como defesa em
-- profundidade depois que o front novo, que usa mg_toggle_reaction,
-- estiver no ar.
create or replace function public.messages_so_reacao_de_terceiro()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then return new; end if;          -- contexto de servidor
  if new.author_id is not distinct from auth.uid() then
    return new;                                            -- o dono edita o que quiser
  end if;
  if new.body        is distinct from old.body
  or new.author_id   is distinct from old.author_id
  or new.author_name is distinct from old.author_name
  or new.channel_id  is distinct from old.channel_id
  or new.kind        is distinct from old.kind
  or new.reply_to    is distinct from old.reply_to
  or new.anexos      is distinct from old.anexos
  or new.created_at  is distinct from old.created_at then
    raise exception 'nesta mensagem você só pode alterar as reações'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_messages_so_reacao on public.messages;
create trigger trg_messages_so_reacao
  before update on public.messages
  for each row execute function public.messages_so_reacao_de_terceiro();

drop policy if exists msg_upd_reacao on public.messages;
create policy msg_upd_reacao on public.messages
  for update using (public.can_see_channel(channel_id))
              with check (public.can_see_channel(channel_id));

revoke all on function public.messages_so_reacao_de_terceiro() from public, anon, authenticated;

-- Nota: a primeira versão deste gatilho liberava quem é admin, e com a
-- policy acima isso deixava um administrador reescrever mensagem alheia.
-- Corrigido: a regra vale para todo mundo. Apagar mensagem de outro
-- (msg_del) já cobre o que um admin de fato precisa.
