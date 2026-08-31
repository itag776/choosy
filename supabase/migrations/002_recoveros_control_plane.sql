create extension if not exists pgcrypto;

create table if not exists public.merchants (
  id text primary key,
  name text not null,
  environment text not null default 'replay',
  created_at timestamptz not null default now()
);

create table if not exists public.merchant_policies (
  merchant_id text primary key references public.merchants(id) on delete cascade,
  source_text text not null,
  compiled_rules jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.recovery_runs (
  id text primary key,
  merchant_id text not null references public.merchants(id),
  phase text not null,
  version bigint not null default 1,
  fixture_version text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_attempts (
  id text not null,
  run_id text not null references public.recovery_runs(id) on delete cascade,
  customer_id text not null,
  amount_paise bigint not null check (amount_paise > 0),
  method text not null,
  issuer text not null,
  status text not null,
  error_reason text,
  error_source text,
  error_step text,
  consent boolean not null,
  contacts_last_24h integer not null default 0,
  created_at timestamptz not null,
  primary key (run_id, id)
);

-- Earlier preview migrations keyed fixture attempts globally. Re-key by run so
-- simultaneous judge sessions cannot overwrite each other's replay rows.
alter table public.payment_attempts drop constraint if exists payment_attempts_pkey;
alter table public.payment_attempts add constraint payment_attempts_pkey primary key (run_id, id);

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.recovery_runs(id) on delete cascade,
  purpose text not null,
  model text not null,
  mode text not null,
  status text not null,
  response_id text,
  tool_events jsonb not null default '[]'::jsonb,
  output jsonb not null,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.external_actions (
  id text primary key,
  run_id text not null references public.recovery_runs(id) on delete cascade,
  type text not null,
  idempotency_key text not null unique,
  reference_id text not null unique,
  provider_id text,
  status text not null,
  amount_paise bigint not null check (amount_paise > 0),
  request_digest text not null,
  response jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_receipts (
  event_id text primary key,
  run_id text not null references public.recovery_runs(id) on delete cascade,
  event_type text not null,
  signature_valid boolean not null default true,
  payload_digest text not null,
  processing_result jsonb not null,
  received_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.recovery_runs(id) on delete cascade,
  sequence bigint not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);

create table if not exists public.approval_receipts (
  id text primary key,
  run_id text not null references public.recovery_runs(id) on delete cascade,
  approval_type text not null check (approval_type in ('canary', 'promotion')),
  actor_id text not null,
  actor_role text not null check (actor_role = 'operator'),
  reason text not null,
  approved_version bigint not null,
  policy_digest text not null check (length(policy_digest) = 64),
  cohort_digest text not null check (length(cohort_digest) = 64),
  receipt_digest text not null unique check (length(receipt_digest) = 64),
  created_at timestamptz not null
);

create or replace function public.apply_run_transition(
  p_run_id text,
  p_expected_version bigint,
  p_next_phase text,
  p_state_patch jsonb,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
  v_event jsonb;
  v_approval jsonb;
begin
  update recovery_runs
  set phase = p_next_phase,
      version = p_expected_version + 1,
      snapshot = p_state_patch,
      updated_at = now()
  where id = p_run_id and version = p_expected_version
  returning snapshot into v_snapshot;

  if v_snapshot is null then
    raise exception 'stale_run_version';
  end if;

  for v_event in select value from jsonb_array_elements(coalesce(p_events, '[]'::jsonb))
  loop
    insert into audit_events(run_id, sequence, event)
    values (p_run_id, (v_event->>'sequence')::bigint, v_event)
    on conflict (run_id, sequence) do nothing;
  end loop;

  for v_approval in select value from jsonb_array_elements(coalesce(p_state_patch->'approvals', '[]'::jsonb))
  loop
    insert into approval_receipts(
      id, run_id, approval_type, actor_id, actor_role, reason, approved_version,
      policy_digest, cohort_digest, receipt_digest, created_at
    ) values (
      v_approval->>'id', p_run_id, v_approval->>'type', v_approval->>'actorId',
      v_approval->>'actorRole', v_approval->>'reason', (v_approval->>'approvedVersion')::bigint,
      v_approval->>'policyDigest', v_approval->>'cohortDigest', v_approval->>'receiptDigest',
      (v_approval->>'createdAt')::timestamptz
    ) on conflict (id) do nothing;
  end loop;

  return jsonb_build_object('snapshot', v_snapshot);
end;
$$;

create or replace function public.process_razorpay_webhook(
  p_run_id text,
  p_expected_version bigint,
  p_event_id text,
  p_event_type text,
  p_payload_digest text,
  p_state_patch jsonb,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot jsonb;
begin
  if exists(select 1 from webhook_receipts where event_id = p_event_id) then
    select snapshot into v_snapshot from recovery_runs where id = p_run_id;
    return jsonb_build_object('duplicate', true, 'snapshot', v_snapshot);
  end if;

  update recovery_runs
  set phase = p_state_patch->>'phase',
      version = p_expected_version + 1,
      snapshot = p_state_patch,
      updated_at = now()
  where id = p_run_id and version = p_expected_version
  returning snapshot into v_snapshot;

  if v_snapshot is null then
    raise exception 'stale_run_version';
  end if;

  insert into webhook_receipts(event_id, run_id, event_type, payload_digest, processing_result)
  values (p_event_id, p_run_id, p_event_type, p_payload_digest, jsonb_build_object('phase', p_state_patch->>'phase'));

  insert into audit_events(run_id, sequence, event)
  values (p_run_id, (p_event->>'sequence')::bigint, p_event)
  on conflict (run_id, sequence) do nothing;

  return jsonb_build_object('duplicate', false, 'snapshot', v_snapshot);
end;
$$;

alter table public.merchants enable row level security;
alter table public.merchant_policies enable row level security;
alter table public.recovery_runs enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.agent_runs enable row level security;
alter table public.external_actions enable row level security;
alter table public.webhook_receipts enable row level security;
alter table public.audit_events enable row level security;
alter table public.approval_receipts enable row level security;

create or replace function public.prevent_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'evidence_is_append_only';
end;
$$;

drop trigger if exists audit_events_append_only on public.audit_events;
create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.prevent_evidence_mutation();

drop trigger if exists approval_receipts_append_only on public.approval_receipts;
create trigger approval_receipts_append_only
before update or delete on public.approval_receipts
for each row execute function public.prevent_evidence_mutation();

revoke all on function public.apply_run_transition(text, bigint, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.process_razorpay_webhook(text, bigint, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_run_transition(text, bigint, text, jsonb, jsonb) to service_role;
grant execute on function public.process_razorpay_webhook(text, bigint, text, text, text, jsonb, jsonb) to service_role;

comment on function public.apply_run_transition is 'Optimistic, atomic run transition with append-only audit events.';
comment on function public.process_razorpay_webhook is 'Atomically deduplicates a Razorpay event and applies a monotonic run transition.';
comment on table public.approval_receipts is 'Authenticated, digest-bound operator approvals. Update and delete are blocked.';
