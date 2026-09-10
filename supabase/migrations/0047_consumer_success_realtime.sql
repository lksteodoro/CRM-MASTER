-- Tempo real no inbox do Consumer Success.
--
-- Com as tabelas na publicação do Realtime, a resposta do cliente aparece na
-- tela no instante em que o webhook grava — sem depender do recarregamento
-- periódico. O Realtime respeita o RLS: cada usuário só recebe as linhas que
-- já poderia ler pela `has_agency_tool_access('consumer_success')`.
--
-- REPLICA IDENTITY FULL: sem isso o Realtime não consegue avaliar o RLS nos
-- eventos de UPDATE/DELETE (chega só a chave primária).

alter table public.cs_messages replica identity full;
alter table public.cs_groups replica identity full;

alter publication supabase_realtime add table public.cs_messages;
alter publication supabase_realtime add table public.cs_groups;
