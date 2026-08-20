-- Credenciais Infobip por organização. A chave é cifrada pela Edge Function e
-- esta tabela não possui política de acesso direto pelo navegador.
create table if not exists public.infobip_api_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_url text not null check (base_url ~* '^https://'),
  api_key_ciphertext text not null,
  api_key_hint text not null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_infobip_api_settings_updated_at on public.infobip_api_settings;
create trigger trg_infobip_api_settings_updated_at
  before update on public.infobip_api_settings
  for each row execute function public.fn_set_updated_at();

alter table public.infobip_api_settings enable row level security;
revoke all on public.infobip_api_settings from anon, authenticated;

