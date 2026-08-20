-- LIMPEZA DA IMPORTAÇÃO CSV DE MATRÍCULAS
-- Execute no Supabase SQL Editor somente se deseja desfazer a importação.
-- O filtro pelo external_sale_id evita apagar vendas criadas por webhook ou manualmente.

begin;

create temporary table csv_import_cleanup_contacts on commit drop as
select distinct contact_id
from public.sales
where external_sale_id like 'csv-matriculas-pos-eng-%';

-- Remove as vendas criadas pelo CSV.
delete from public.sales
where external_sale_id like 'csv-matriculas-pos-eng-%';

-- Remove vínculos de lead criados pelas versões anteriores do importador.
delete from public.lead_events
where source = 'csv_import'
   or external_id like 'csv-lead-%';

-- Remove somente contatos usados pelo CSV que ficaram sem nenhuma referência.
delete from public.contacts c
where c.id in (select contact_id from csv_import_cleanup_contacts)
  and not exists (select 1 from public.sales s where s.contact_id = c.id)
  and not exists (select 1 from public.lead_events l where l.contact_id = c.id);

commit;

-- Vendedores não são removidos automaticamente: alguns podem já existir ou
-- estar associados a outras vendas. Se necessário, revise-os manualmente.
