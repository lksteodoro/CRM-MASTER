-- =============================================================================
-- 0014 — Adiciona "vitoria" (fanfarra ascendente) às opções de som do telão
--
-- Visual "Arena" pedido pelo usuário trouxe um efeito sonoro próprio
-- (arpejo de 5 notas). Em vez de substituir as opções existentes
-- (sino/aplausos/caixa), vira uma 4ª opção configurável.
-- =============================================================================

alter table public.client_ranking_settings
  drop constraint client_ranking_settings_sound_choice_check,
  add constraint client_ranking_settings_sound_choice_check
    check (sound_choice in ('sino', 'aplausos', 'caixa', 'vitoria'));
