alter table public.commerce_sessions add column if not exists origin text not null default 'shopper_ui' check (origin in ('shopper_ui','external_agent'));
alter table public.commerce_sessions add column if not exists buyer_run_id text;

create table if not exists public.commerce_buyer_runs (
  id text primary key,
  status text not null check (status in ('planning','awaiting_approval','approved','checkout_ready','paid','blocked','failed')),
  goal text not null check (char_length(goal) between 10 and 500),
  snapshot jsonb not null,
  session_id text references public.commerce_sessions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commerce_buyer_runs_session_idx on public.commerce_buyer_runs(session_id);
alter table public.commerce_buyer_runs enable row level security;
revoke all on public.commerce_buyer_runs from public, anon, authenticated;

create or replace function public.apply_commerce_transition(p_session_id text,p_expected_version bigint,p_next_phase text,p_snapshot jsonb,p_events jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_snapshot jsonb; v_event jsonb;
begin
  update commerce_sessions set phase=p_next_phase,version=p_expected_version+1,snapshot=p_snapshot,
    origin=coalesce(p_snapshot->>'origin','shopper_ui'),buyer_run_id=nullif(p_snapshot->>'buyerRunId',''),updated_at=now()
  where id=p_session_id and version=p_expected_version returning snapshot into v_snapshot;
  if v_snapshot is null then raise exception 'stale_session_version'; end if;
  for v_event in select value from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) loop
    insert into commerce_audit_events(session_id,sequence,event) values(p_session_id,(v_event->>'sequence')::bigint,v_event) on conflict(session_id,sequence) do nothing;
  end loop;
  return jsonb_build_object('snapshot',v_snapshot);
end $$;
revoke all on function public.apply_commerce_transition(text,bigint,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_commerce_transition(text,bigint,text,jsonb,jsonb) to service_role;
