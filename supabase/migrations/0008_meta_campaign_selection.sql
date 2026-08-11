-- =============================================================================
-- 0008 — Seleção de campanhas por projeto
--
-- Um cliente pode usar a mesma conta de anúncios para vários projetos
-- (ex: "Pós Engenharia" e "Pós IA" compartilhando a mesma act_...). Sem uma
-- forma de dizer quais campanhas pertencem a qual projeto, sincronizar
-- misturaria tudo. `selected_campaign_ids` guarda a escolha manual feita em
-- Configurações; null ou vazio = sincroniza a conta inteira (comportamento
-- anterior, para quem usa uma conta por projeto).
-- =============================================================================

alter table public.meta_integrations
  add column if not exists selected_campaign_ids text[] not null default '{}';
