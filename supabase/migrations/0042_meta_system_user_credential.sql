-- =============================================================================
-- 0042 — Credencial de usuário de sistema como alternativa ao OAuth
--
-- A agência pode conectar de duas formas, e as duas são aceitas pela Meta:
--
--   OAUTH        → login do Facebook, token de usuário de longa duração.
--   SYSTEM_USER  → token de usuário de sistema gerado na Business Manager.
--                  É o mecanismo oficial para integração servidor-a-servidor,
--                  não expira sozinho e não depende de ninguém continuar logado.
--
-- O que diferencia um token legítimo de uma violação não é ser colado à mão, e
-- sim duas coisas: ele precisa ter sido emitido para ESTE aplicativo (token de
-- outro app, como o do Graph API Explorer, é uso de credencial de terceiro) e
-- não pode ficar no navegador. A validação do app_id acontece na Edge Function
-- antes de gravar; o armazenamento continua sendo o cofre em `private`.
-- =============================================================================

alter table public.meta_oauth_connections
  add column if not exists credential_source text not null default 'OAUTH';

alter table public.meta_oauth_connections
  drop constraint if exists meta_oauth_connections_credential_source_valid;
alter table public.meta_oauth_connections
  add constraint meta_oauth_connections_credential_source_valid
  check (credential_source in ('OAUTH', 'SYSTEM_USER'));

comment on column public.meta_oauth_connections.credential_source is
  'OAUTH = login do Facebook. SYSTEM_USER = token de usuário de sistema da BM, validado contra o app_id da agência antes de ser aceito.';

-- Guarda quando a credencial foi validada pela última vez contra a Meta, para
-- que a tela mostre uma conexão "confirmada há X" em vez de apenas "ativa".
alter table public.meta_oauth_connections
  add column if not exists verified_at timestamptz;
