-- Make the append-only commerce ledger authoritative for merchant audit views.

-- Refuse to bless a malformed legacy snapshot or overwrite a different event
-- already stored at the same ledger position.
do $$
begin
  if exists(
    select 1
    from public.commerce_sessions as session
    cross join lateral jsonb_array_elements(coalesce(session.snapshot->'audit', '[]'::jsonb)) with ordinality as entry(event, ordinal)
    where (entry.event->>'sequence')::bigint is distinct from entry.ordinal
      or entry.event->>'previousHash' is distinct from case
        when entry.ordinal = 1 then 'GENESIS'
        else session.snapshot->'audit'->(entry.ordinal::integer - 2)->>'hash'
      end
  ) then
    raise exception 'invalid_snapshot_audit_chain';
  end if;

  if exists(
    select 1
    from public.commerce_audit_events as ledger
    join public.commerce_sessions as session on session.id = ledger.session_id
    cross join lateral jsonb_array_elements(coalesce(session.snapshot->'audit', '[]'::jsonb)) as entry(event)
    where (entry.event->>'sequence')::bigint = ledger.sequence
      and ledger.event is distinct from entry.event
  ) then
    raise exception 'audit_backfill_conflict';
  end if;
end $$;

-- Backfill every event currently embedded in a session snapshot. Existing
-- identical rows are retained; a conflicting row was rejected above.
insert into public.commerce_audit_events(session_id, sequence, event)
select session.id, (entry.event->>'sequence')::bigint, entry.event
from public.commerce_sessions as session
cross join lateral jsonb_array_elements(coalesce(session.snapshot->'audit', '[]'::jsonb)) as entry(event)
where not exists(
  select 1 from public.commerce_audit_events as ledger
  where ledger.session_id = session.id
    and ledger.sequence = (entry.event->>'sequence')::bigint
);

create or replace function public.create_commerce_session(
  p_session_id text,
  p_merchant_id text,
  p_phase text,
  p_version bigint,
  p_origin text,
  p_buyer_run_id text,
  p_snapshot jsonb,
  p_initial_event jsonb
)
returns void language plpgsql security definer set search_path=public as $$
begin
  if (p_initial_event->>'sequence')::bigint is distinct from 1 or p_initial_event->>'previousHash' is distinct from 'GENESIS' then
    raise exception 'invalid_initial_audit_event';
  end if;
  if (p_initial_event->>'schemaVersion')::bigint is distinct from 1
    or (p_initial_event->>'sessionVersion')::bigint is distinct from p_version then
    raise exception 'invalid_initial_audit_version';
  end if;
  if (p_snapshot->>'version')::bigint is distinct from p_version
    or jsonb_array_length(coalesce(p_snapshot->'audit', '[]'::jsonb)) <> 1
    or p_snapshot->'audit'->0->>'hash' is distinct from p_initial_event->>'hash' then
    raise exception 'invalid_initial_snapshot';
  end if;
  insert into commerce_sessions(id, merchant_id, phase, version, origin, buyer_run_id, snapshot)
  values(p_session_id, p_merchant_id, p_phase, p_version, p_origin, p_buyer_run_id, p_snapshot);
  insert into commerce_audit_events(session_id, sequence, event)
  values(p_session_id, 1, p_initial_event);
end $$;

create or replace function public.apply_commerce_transition(p_session_id text,p_expected_version bigint,p_next_phase text,p_snapshot jsonb,p_events jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_snapshot jsonb;
  v_event jsonb;
  v_sequence bigint;
  v_head_hash text;
begin
  select sequence, event->>'hash' into v_sequence, v_head_hash
  from commerce_audit_events where session_id=p_session_id order by sequence desc limit 1 for update;
  v_sequence := coalesce(v_sequence, 0);
  v_head_hash := coalesce(v_head_hash, 'GENESIS');
  if jsonb_array_length(coalesce(p_events, '[]'::jsonb)) = 0 then raise exception 'audit_event_required'; end if;
  if (p_snapshot->>'version')::bigint is distinct from p_expected_version + 1 then raise exception 'snapshot_version_mismatch'; end if;

  update commerce_sessions set phase=p_next_phase,version=p_expected_version+1,snapshot=p_snapshot,
    origin=coalesce(p_snapshot->>'origin','shopper_ui'),buyer_run_id=nullif(p_snapshot->>'buyerRunId',''),updated_at=now()
  where id=p_session_id and version=p_expected_version returning snapshot into v_snapshot;
  if v_snapshot is null then raise exception 'stale_session_version'; end if;

  for v_event in select value from jsonb_array_elements(p_events) loop
    if (v_event->>'sequence')::bigint is distinct from v_sequence + 1 then raise exception 'audit_sequence_mismatch'; end if;
    if v_event->>'previousHash' is distinct from v_head_hash then raise exception 'audit_link_mismatch'; end if;
    if (v_event->>'schemaVersion')::bigint is distinct from 1
      or (v_event->>'sessionVersion')::bigint is distinct from p_expected_version + 1 then
      raise exception 'audit_version_mismatch';
    end if;
    insert into commerce_audit_events(session_id,sequence,event) values(p_session_id,v_sequence + 1,v_event);
    v_sequence := v_sequence + 1;
    v_head_hash := v_event->>'hash';
  end loop;

  if jsonb_array_length(coalesce(p_snapshot->'audit','[]'::jsonb)) <> v_sequence
    or p_snapshot->'audit'->(v_sequence::integer - 1)->>'hash' is distinct from v_head_hash then
    raise exception 'audit_snapshot_mismatch';
  end if;
  return jsonb_build_object('snapshot',v_snapshot);
end $$;

create or replace function public.process_commerce_webhook(p_session_id text,p_expected_version bigint,p_event_id text,p_event_type text,p_payload_digest text,p_snapshot jsonb,p_event jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_snapshot jsonb;
  v_sequence bigint;
  v_head_hash text;
begin
  if exists(select 1 from commerce_webhook_receipts where event_id=p_event_id) then
    select snapshot into v_snapshot from commerce_sessions where id=p_session_id;
    return jsonb_build_object('duplicate',true,'snapshot',v_snapshot);
  end if;
  select sequence, event->>'hash' into v_sequence, v_head_hash
  from commerce_audit_events where session_id=p_session_id order by sequence desc limit 1 for update;
  v_sequence := coalesce(v_sequence, 0);
  v_head_hash := coalesce(v_head_hash, 'GENESIS');
  if (p_event->>'sequence')::bigint is distinct from v_sequence + 1 then raise exception 'audit_sequence_mismatch'; end if;
  if p_event->>'previousHash' is distinct from v_head_hash then raise exception 'audit_link_mismatch'; end if;
  if (p_event->>'schemaVersion')::bigint is distinct from 1
    or (p_event->>'sessionVersion')::bigint is distinct from p_expected_version + 1 then
    raise exception 'audit_version_mismatch';
  end if;
  if (p_snapshot->>'version')::bigint is distinct from p_expected_version + 1
    or jsonb_array_length(coalesce(p_snapshot->'audit','[]'::jsonb)) <> v_sequence + 1
    or p_snapshot->'audit'->(v_sequence::integer)->>'hash' is distinct from p_event->>'hash' then
    raise exception 'audit_snapshot_mismatch';
  end if;

  update commerce_sessions set phase=p_snapshot->>'phase',version=p_expected_version+1,snapshot=p_snapshot,updated_at=now()
  where id=p_session_id and version=p_expected_version returning snapshot into v_snapshot;
  if v_snapshot is null then raise exception 'stale_session_version'; end if;
  insert into commerce_webhook_receipts(event_id,session_id,event_type,payload_digest,processing_result)
  values(p_event_id,p_session_id,p_event_type,p_payload_digest,jsonb_build_object('phase',p_snapshot->>'phase'));
  insert into commerce_audit_events(session_id,sequence,event) values(p_session_id,v_sequence + 1,p_event);
  return jsonb_build_object('duplicate',false,'snapshot',v_snapshot);
end $$;

revoke all on function public.create_commerce_session(text,text,text,bigint,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.apply_commerce_transition(text,bigint,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.process_commerce_webhook(text,bigint,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_commerce_session(text,text,text,bigint,text,text,jsonb,jsonb) to service_role;
grant execute on function public.apply_commerce_transition(text,bigint,text,jsonb,jsonb) to service_role;
grant execute on function public.process_commerce_webhook(text,bigint,text,text,text,jsonb,jsonb) to service_role;
