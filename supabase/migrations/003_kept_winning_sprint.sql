alter table public.agent_runs add column if not exists input_digest text;
alter table public.agent_runs add column if not exists prompt_version text;
alter table public.agent_runs add column if not exists catalog_version text;
create index if not exists agent_runs_validated_cache_idx
  on public.agent_runs(input_digest, created_at desc)
  where purpose = 'investigation' and mode = 'gemini_agent' and status = 'completed';

alter table public.external_actions add column if not exists notification_medium text;
alter table public.external_actions add column if not exists notification_status text;
alter table public.external_actions add column if not exists masked_recipient text;
alter table public.external_actions add column if not exists notification_accepted_at timestamptz;
