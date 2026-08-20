-- Biblioteca e envios em lote de templates WhatsApp pela Infobip.
create table public.infobip_senders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  label text not null check (char_length(trim(label)) between 1 and 100),
  sender text not null check (sender ~ '^[1-9][0-9]{9,15}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sender)
);

create table public.infobip_template_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  name_pattern text not null default 'CLIENTE-DATA-X' check (char_length(trim(name_pattern)) between 1 and 120),
  language text not null default 'pt_BR' check (language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  category text not null default 'MARKETING' check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  body_text text not null check (char_length(trim(body_text)) between 1 and 1024),
  variable_examples jsonb not null default '[]'::jsonb check (jsonb_typeof(variable_examples) = 'array'),
  header_type text not null default 'NONE' check (header_type in ('NONE','IMAGE','VIDEO')),
  header_media_url text check (header_media_url is null or header_media_url ~* '^https://'),
  footer_text text check (footer_text is null or char_length(footer_text) <= 60),
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (header_type = 'NONE' or header_media_url is not null)
);

create table public.infobip_template_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id() references public.organizations(id) on delete cascade,
  model_id uuid not null references public.infobip_template_models(id) on delete cascade,
  sender_id uuid references public.infobip_senders(id) on delete set null,
  sender text not null,
  resolved_name text not null check (resolved_name ~ '^[a-z0-9_]{1,512}$'),
  status text not null default 'QUEUED' check (status in ('QUEUED','SENDING','SENT','FAILED')),
  provider_template_id text,
  provider_status text,
  provider_response jsonb,
  error_message text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  sent_at timestamptz
);

create index infobip_senders_client_idx on public.infobip_senders (organization_id, client_id, active);
create index infobip_models_client_idx on public.infobip_template_models (organization_id, client_id, updated_at desc);
create index infobip_submissions_model_idx on public.infobip_template_submissions (organization_id, model_id, requested_at desc);

create trigger trg_infobip_senders_updated_at before update on public.infobip_senders
  for each row execute function public.fn_set_updated_at();
create trigger trg_infobip_models_updated_at before update on public.infobip_template_models
  for each row execute function public.fn_set_updated_at();

alter table public.infobip_senders enable row level security;
alter table public.infobip_template_models enable row level security;
alter table public.infobip_template_submissions enable row level security;

create policy infobip_senders_admin_all on public.infobip_senders for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());
create policy infobip_models_admin_all on public.infobip_template_models for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());
create policy infobip_submissions_admin_all on public.infobip_template_submissions for all to authenticated
  using (private.is_admin() and organization_id = private.current_organization_id())
  with check (private.is_admin() and organization_id = private.current_organization_id());
