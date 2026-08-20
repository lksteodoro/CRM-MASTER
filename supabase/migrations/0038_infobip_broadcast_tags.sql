-- As transmissões passam a apontar para audiências já cadastradas no People
-- da Infobip. Nenhuma lista de contatos é enviada ou armazenada no CRM.
alter table public.infobip_broadcast_items
  alter column file_name drop not null,
  alter column file_url drop not null,
  alter column lead_count drop not null;

alter table public.infobip_broadcast_items
  add column if not exists infobip_tag_id text,
  add column if not exists infobip_tag_name text,
  add column if not exists infobip_tag_people_count integer;

alter table public.infobip_broadcast_items
  add constraint infobip_broadcast_items_tag_people_count_check
  check (infobip_tag_people_count is null or infobip_tag_people_count >= 0) not valid;

create index if not exists infobip_broadcast_items_tag_idx
  on public.infobip_broadcast_items (organization_id, infobip_tag_id);

comment on column public.infobip_broadcast_items.infobip_tag_id is
  'Identificador da tag no People da Infobip; a audiência não é copiada para este banco.';
comment on column public.infobip_broadcast_items.infobip_tag_name is
  'Nome da tag exibido no rascunho para auditoria operacional.';
