-- Lote de templates por WABA/remetente, CTA variável e auditoria da categoria Meta.
alter table public.infobip_senders
  add column if not exists waba_id text,
  add column if not exists waba_label text;

alter table public.infobip_template_models
  add column if not exists button_text text,
  add column if not exists button_url text;

alter table public.infobip_template_models
  drop constraint if exists infobip_template_models_button_text_check,
  add constraint infobip_template_models_button_text_check
    check (button_text is null or char_length(trim(button_text)) between 1 and 25),
  drop constraint if exists infobip_template_models_button_url_check,
  add constraint infobip_template_models_button_url_check
    check (button_url is null or button_url ~* '^https://');

alter table public.infobip_template_submissions
  add column if not exists destination_url text,
  add column if not exists requested_category text,
  add column if not exists provider_category text,
  add column if not exists category_changed boolean not null default false,
  add column if not exists status_checked_at timestamptz;

alter table public.infobip_template_submissions
  drop constraint if exists infobip_template_submissions_destination_url_check,
  add constraint infobip_template_submissions_destination_url_check
    check (destination_url is null or destination_url ~* '^https://'),
  drop constraint if exists infobip_template_submissions_requested_category_check,
  add constraint infobip_template_submissions_requested_category_check
    check (requested_category is null or requested_category in ('MARKETING','UTILITY','AUTHENTICATION')),
  drop constraint if exists infobip_template_submissions_provider_category_check,
  add constraint infobip_template_submissions_provider_category_check
    check (provider_category is null or provider_category in ('MARKETING','UTILITY','AUTHENTICATION'));

create index if not exists infobip_submissions_provider_status_idx
  on public.infobip_template_submissions (organization_id, provider_status, requested_at desc);
