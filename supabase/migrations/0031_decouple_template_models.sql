-- Modelos são globais da organização. Cliente/remetente só é escolhido ao produzir o lote.
alter table public.infobip_template_models alter column client_id drop not null;
alter table public.infobip_senders alter column client_id drop not null;

drop index if exists public.infobip_senders_client_idx;
drop index if exists public.infobip_models_client_idx;
create index if not exists infobip_senders_org_active_idx
  on public.infobip_senders (organization_id, active, waba_label, label);
create index if not exists infobip_models_org_updated_idx
  on public.infobip_template_models (organization_id, updated_at desc);
