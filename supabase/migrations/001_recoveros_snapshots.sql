create table if not exists public.recoveros_snapshots (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.recoveros_snapshots enable row level security;

comment on table public.recoveros_snapshots is
  'Server-only RecoverOS state snapshots; access uses the Supabase service role.';
