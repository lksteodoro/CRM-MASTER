-- =============================================================================
-- 0049 — Consumer Success: participantes dos grupos
--
-- Guarda nome + foto de quem manda mensagem nos grupos, pra mostrar o avatar
-- redondo ao lado de cada mensagem (igual ao WhatsApp). A foto vem da Evolution
-- (endpoint fetchProfilePictureUrl) e é atualizada sob demanda pela Edge
-- Function `cs-evolution`; o webhook só registra o participante e o nome.
-- =============================================================================

create table public.cs_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default private.current_organization_id()
    references public.organizations(id) on delete cascade,
  jid text not null,
  name text,
  avatar_url text,
  avatar_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, jid)
);

create index idx_cs_participants_org on public.cs_participants (organization_id);

alter table public.cs_participants enable row level security;

create policy cs_participants_tool_all on public.cs_participants
  for all to authenticated
  using (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  )
  with check (
    private.has_agency_tool_access('consumer_success')
    and organization_id = private.current_organization_id()
  );

grant select, insert, update, delete on public.cs_participants to authenticated;

drop trigger if exists trg_cs_participants_updated_at on public.cs_participants;
create trigger trg_cs_participants_updated_at before update on public.cs_participants
  for each row execute function public.fn_set_updated_at();

-- Registra (ou atualiza o nome de) um participante. Chamado pelo webhook com
-- service role; SECURITY DEFINER + search_path fixo pra não depender de RLS nem
-- do search_path do chamador. Nunca apaga um nome já conhecido com um vazio.
create or replace function public.cs_touch_participant(
  p_organization_id uuid,
  p_jid text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_jid is null or length(trim(p_jid)) = 0 then
    return;
  end if;

  insert into public.cs_participants (organization_id, jid, name)
  values (p_organization_id, p_jid, nullif(trim(coalesce(p_name, '')), ''))
  on conflict (organization_id, jid) do update
    set name = coalesce(
          nullif(trim(coalesce(excluded.name, '')), ''),
          public.cs_participants.name
        ),
        updated_at = now();
end;
$$;

revoke execute on function public.cs_touch_participant(uuid, text, text) from public, anon, authenticated;

-- Realtime: novas fotos aparecem sozinhas no inbox.
alter table public.cs_participants replica identity full;
alter publication supabase_realtime add table public.cs_participants;
