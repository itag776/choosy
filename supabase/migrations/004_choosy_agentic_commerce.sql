-- Additive Track 01 schema. Track 03 tables remain untouched for rollback.
create table if not exists public.category_profiles (
  category text primary key,
  merchant_id text not null references public.merchants(id),
  label text not null,
  version text not null,
  question_schema jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_products (
  id text primary key,
  merchant_id text not null references public.merchants(id),
  sku text not null unique,
  category text not null references public.category_profiles(category),
  kind text not null check (kind in ('primary','addon')),
  brand text not null,
  name text not null,
  description text not null,
  image_url text not null,
  promoted boolean not null default false,
  active boolean not null default true,
  tags text[] not null default '{}',
  attributes jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_variants (
  id text primary key,
  product_id text not null references public.catalog_products(id) on delete cascade,
  sku text not null unique,
  label text not null,
  price_paise bigint not null check (price_paise > 0),
  stock integer not null check (stock >= 0),
  attributes jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_sessions (
  id text primary key,
  merchant_id text not null references public.merchants(id),
  phase text not null,
  version bigint not null default 1,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.commerce_sessions(id) on delete cascade,
  model text not null,
  mode text not null,
  input_digest text not null,
  prompt_version text not null,
  catalog_version text not null,
  output jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists commerce_agent_cache_idx on public.commerce_agent_runs(input_digest, created_at desc) where mode = 'gemini_agent';

create table if not exists public.commerce_checkout_actions (
  id text primary key,
  session_id text not null references public.commerce_sessions(id),
  cart_id text not null,
  cart_digest text not null check (length(cart_digest)=64),
  quote_digest text not null check (length(quote_digest)=64),
  idempotency_key text not null unique,
  reference_id text not null unique,
  amount_paise bigint not null check (amount_paise > 0),
  provider_id text,
  status text not null,
  request_digest text not null check (length(request_digest)=64),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_webhook_receipts (
  event_id text primary key,
  session_id text not null references public.commerce_sessions(id),
  event_type text not null,
  payload_digest text not null check (length(payload_digest)=64),
  processing_result jsonb not null,
  received_at timestamptz not null default now()
);

create table if not exists public.commerce_audit_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.commerce_sessions(id) on delete cascade,
  sequence bigint not null,
  event jsonb not null,
  created_at timestamptz not null default now(),
  unique(session_id, sequence)
);

create or replace function public.apply_commerce_transition(p_session_id text,p_expected_version bigint,p_next_phase text,p_snapshot jsonb,p_events jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_snapshot jsonb; v_event jsonb;
begin
  update commerce_sessions set phase=p_next_phase,version=p_expected_version+1,snapshot=p_snapshot,updated_at=now()
  where id=p_session_id and version=p_expected_version returning snapshot into v_snapshot;
  if v_snapshot is null then raise exception 'stale_session_version'; end if;
  for v_event in select value from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) loop
    insert into commerce_audit_events(session_id,sequence,event) values(p_session_id,(v_event->>'sequence')::bigint,v_event) on conflict(session_id,sequence) do nothing;
  end loop;
  return jsonb_build_object('snapshot',v_snapshot);
end $$;

create or replace function public.process_commerce_webhook(p_session_id text,p_expected_version bigint,p_event_id text,p_event_type text,p_payload_digest text,p_snapshot jsonb,p_event jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_snapshot jsonb;
begin
  if exists(select 1 from commerce_webhook_receipts where event_id=p_event_id) then select snapshot into v_snapshot from commerce_sessions where id=p_session_id; return jsonb_build_object('duplicate',true,'snapshot',v_snapshot); end if;
  update commerce_sessions set phase=p_snapshot->>'phase',version=p_expected_version+1,snapshot=p_snapshot,updated_at=now() where id=p_session_id and version=p_expected_version returning snapshot into v_snapshot;
  if v_snapshot is null then raise exception 'stale_session_version'; end if;
  insert into commerce_webhook_receipts(event_id,session_id,event_type,payload_digest,processing_result) values(p_event_id,p_session_id,p_event_type,p_payload_digest,jsonb_build_object('phase',p_snapshot->>'phase'));
  insert into commerce_audit_events(session_id,sequence,event) values(p_session_id,(p_event->>'sequence')::bigint,p_event) on conflict(session_id,sequence) do nothing;
  return jsonb_build_object('duplicate',false,'snapshot',v_snapshot);
end $$;

alter table public.category_profiles enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_variants enable row level security;
alter table public.commerce_sessions enable row level security;
alter table public.commerce_agent_runs enable row level security;
alter table public.commerce_checkout_actions enable row level security;
alter table public.commerce_webhook_receipts enable row level security;
alter table public.commerce_audit_events enable row level security;

drop trigger if exists commerce_audit_append_only on public.commerce_audit_events;
create trigger commerce_audit_append_only before update or delete on public.commerce_audit_events for each row execute function public.prevent_evidence_mutation();
drop trigger if exists commerce_webhooks_append_only on public.commerce_webhook_receipts;
create trigger commerce_webhooks_append_only before update or delete on public.commerce_webhook_receipts for each row execute function public.prevent_evidence_mutation();

revoke all on function public.apply_commerce_transition(text,bigint,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.process_commerce_webhook(text,bigint,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_commerce_transition(text,bigint,text,jsonb,jsonb) to service_role;
grant execute on function public.process_commerce_webhook(text,bigint,text,text,text,jsonb,jsonb) to service_role;

insert into public.merchants(id,name,environment) values('merchant_choosy_demo','Choosy Demo Store','test_mode') on conflict(id) do update set name=excluded.name,environment=excluded.environment;
insert into public.category_profiles(category,merchant_id,label,version,question_schema) values
('phones','merchant_choosy_demo','Phones','phones-v1','[{"key":"os"},{"key":"priority"},{"key":"size"}]'),
('headphones','merchant_choosy_demo','Headphones','headphones-v1','[{"key":"formFactor"},{"key":"environment"},{"key":"feature"},{"key":"connectivity"}]'),
('running-shoes','merchant_choosy_demo','Running shoes','running-shoes-v1','[{"key":"size"},{"key":"terrain"},{"key":"distance"},{"key":"cushioning"}]')
on conflict(category) do update set label=excluded.label,version=excluded.version,question_schema=excluded.question_schema;

insert into public.catalog_products(id,merchant_id,sku,category,kind,brand,name,description,image_url,promoted,tags,attributes) values
('prod_ph-a1','merchant_choosy_demo','PH-A1','phones','primary','Aster','Aster One','Balanced 5G phone with two-day battery life.','/products/phones.png',true,array['android','balanced','standard','battery','everyday'],'{"demoData":true}'),
('prod_ph-a2','merchant_choosy_demo','PH-A2','phones','primary','Aster','Aster One Pro','Camera-first Android phone with fast performance.','/products/phones.png',false,array['android','camera','performance','standard','photography'],'{"demoData":true}'),
('prod_ph-n1','merchant_choosy_demo','PH-N1','phones','primary','Northstar','Northstar Mini','Compact phone designed for one-handed use.','/products/phones.png',false,array['android','compact','balanced','everyday'],'{"demoData":true}'),
('prod_ph-n2','merchant_choosy_demo','PH-N2','phones','primary','Northstar','Northstar Max','Large-display performance phone with long battery life.','/products/phones.png',false,array['android','large','battery','performance','gaming'],'{"demoData":true}'),
('prod_ph-l1','merchant_choosy_demo','PH-L1','phones','primary','Luma','Luma 16','Compact camera-led phone.','/products/phones.png',false,array['ios','camera','compact','balanced','photography'],'{"demoData":true}'),
('prod_ph-l2','merchant_choosy_demo','PH-L2','phones','primary','Luma','Luma 16 Air','Thin large-screen phone for creative work.','/products/phones.png',true,array['ios','large','battery','camera','everyday'],'{"demoData":true}'),
('prod_hd-o1','merchant_choosy_demo','HD-O1','headphones','primary','Orbit','Orbit Quiet','Wireless over-ear headphones with adaptive ANC.','/products/headphones.png',true,array['over-ear','wireless','noise cancellation','commute','office'],'{"demoData":true}'),
('prod_hd-o2','merchant_choosy_demo','HD-O2','headphones','primary','Orbit','Orbit Studio','Detailed wired desk headphones.','/products/headphones.png',false,array['over-ear','wired','call quality','office','balanced'],'{"demoData":true}'),
('prod_hd-p1','merchant_choosy_demo','HD-P1','headphones','primary','Pulse','Pulse Air','Secure-fit wireless gym earbuds.','/products/headphones.png',false,array['earbuds','wireless','gym','call quality'],'{"demoData":true}'),
('prod_hd-p2','merchant_choosy_demo','HD-P2','headphones','primary','Pulse','Pulse Play','Low-latency gaming earbuds.','/products/headphones.png',false,array['earbuds','wireless','low latency','gaming'],'{"demoData":true}'),
('prod_hd-s1','merchant_choosy_demo','HD-S1','headphones','primary','Serein','Serein ANC','Premium travel headphones.','/products/headphones.png',false,array['over-ear','wireless','noise cancellation','commute','call quality'],'{"demoData":true}'),
('prod_hd-s2','merchant_choosy_demo','HD-S2','headphones','primary','Serein','Serein Flex','Wired zero-lag in-ear monitors.','/products/headphones.png',false,array['earbuds','wired','low latency','gaming','gym'],'{"demoData":true}'),
('prod_sh-v1','merchant_choosy_demo','SH-V1','running-shoes','primary','Vela','Vela Daily','Durable balanced daily trainer.','/products/running-shoes.png',true,array['road','balanced','under 5 km','5–10 km','walking / casual'],'{"demoData":true}'),
('prod_sh-v2','merchant_choosy_demo','SH-V2','running-shoes','primary','Vela','Vela Cloud','Soft high-stack road trainer.','/products/running-shoes.png',false,array['road','soft','5–10 km','10 km+'],'{"demoData":true}'),
('prod_sh-r1','merchant_choosy_demo','SH-R1','running-shoes','primary','Ridge','Ridge Trail','Protective trail shoe.','/products/running-shoes.png',false,array['trail','balanced','5–10 km','10 km+'],'{"demoData":true}'),
('prod_sh-r2','merchant_choosy_demo','SH-R2','running-shoes','primary','Ridge','Ridge Hybrid','Road-to-trail daily shoe.','/products/running-shoes.png',false,array['mixed','balanced','under 5 km','5–10 km'],'{"demoData":true}'),
('prod_sh-k1','merchant_choosy_demo','SH-K1','running-shoes','primary','Kite','Kite Tempo','Responsive lightweight trainer.','/products/running-shoes.png',true,array['road','responsive','5–10 km','10 km+'],'{"demoData":true}'),
('prod_sh-k2','merchant_choosy_demo','SH-K2','running-shoes','primary','Kite','Kite Ease','Soft shoe for short runs and walking.','/products/running-shoes.png',false,array['road','soft','under 5 km','walking / casual'],'{"demoData":true}'),
('prod_ac-p1','merchant_choosy_demo','AC-P1','phones','addon','Choosy','30W compact charger','Compact fast charger.','/products/phones.png',false,array['phones','battery','charging'],'{"demoData":true}'),
('prod_ac-p2','merchant_choosy_demo','AC-P2','phones','addon','Choosy','Everyday protective case','Slim protective case.','/products/phones.png',false,array['phones','protection','everyday'],'{"demoData":true}'),
('prod_ac-h1','merchant_choosy_demo','AC-H1','headphones','addon','Choosy','Travel hard case','Structured travel case.','/products/headphones.png',false,array['headphones','commute','protection'],'{"demoData":true}'),
('prod_ac-h2','merchant_choosy_demo','AC-H2','headphones','addon','Choosy','Comfort ear-tip set','Multiple comfort ear-tip sizes.','/products/headphones.png',false,array['headphones','earbuds','gym'],'{"demoData":true}'),
('prod_ac-s1','merchant_choosy_demo','AC-S1','running-shoes','addon','Choosy','Performance running socks','Breathable anti-blister socks.','/products/running-shoes.png',false,array['running-shoes','road','trail'],'{"demoData":true}'),
('prod_ac-s2','merchant_choosy_demo','AC-S2','running-shoes','addon','Choosy','Reflective run band','Lightweight low-light run band.','/products/running-shoes.png',false,array['running-shoes','road','safety'],'{"demoData":true}')
on conflict(id) do update set name=excluded.name,description=excluded.description,image_url=excluded.image_url,promoted=excluded.promoted,tags=excluded.tags,attributes=excluded.attributes;

insert into public.catalog_variants(id,product_id,sku,label,price_paise,stock,attributes) values
('var_ph-a1-std','prod_ph-a1','PH-A1-STD','Standard',2499900,8,'{}'),('var_ph-a2-std','prod_ph-a2','PH-A2-STD','Standard',4199900,8,'{}'),('var_ph-n1-std','prod_ph-n1','PH-N1-STD','Standard',3299900,8,'{}'),('var_ph-n2-std','prod_ph-n2','PH-N2-STD','Standard',5299900,8,'{}'),('var_ph-l1-std','prod_ph-l1','PH-L1-STD','Standard',5899900,8,'{}'),('var_ph-l2-std','prod_ph-l2','PH-L2-STD','Standard',6899900,8,'{}'),
('var_hd-o1-std','prod_hd-o1','HD-O1-STD','Standard',1299900,8,'{}'),('var_hd-o2-std','prod_hd-o2','HD-O2-STD','Standard',899900,8,'{}'),('var_hd-p1-std','prod_hd-p1','HD-P1-STD','Standard',699900,8,'{}'),('var_hd-p2-std','prod_hd-p2','HD-P2-STD','Standard',999900,8,'{}'),('var_hd-s1-std','prod_hd-s1','HD-S1-STD','Standard',1699900,8,'{}'),('var_hd-s2-std','prod_hd-s2','HD-S2-STD','Standard',499900,8,'{}'),
('var_ac-p1-std','prod_ac-p1','AC-P1-STD','Standard',149900,20,'{}'),('var_ac-p2-std','prod_ac-p2','AC-P2-STD','Standard',99900,20,'{}'),('var_ac-h1-std','prod_ac-h1','AC-H1-STD','Standard',119900,20,'{}'),('var_ac-h2-std','prod_ac-h2','AC-H2-STD','Standard',69900,20,'{}'),('var_ac-s1-std','prod_ac-s1','AC-S1-STD','Standard',79900,20,'{}'),('var_ac-s2-std','prod_ac-s2','AC-S2-STD','Standard',59900,20,'{}')
on conflict(id) do update set price_paise=excluded.price_paise,stock=excluded.stock,attributes=excluded.attributes;

insert into public.catalog_variants(id,product_id,sku,label,price_paise,stock,attributes)
select 'var_'||lower(p.sku)||'-'||replace(lower(s.size),' ',''),p.id,p.sku||'-'||replace(s.size,' ',''),s.size,
  case p.sku when 'SH-V1' then 649900 when 'SH-V2' then 849900 when 'SH-R1' then 799900 when 'SH-R2' then 749900 when 'SH-K1' then 949900 else 549900 end,
  6,jsonb_build_object('size',s.size)
from public.catalog_products p cross join (values('UK 7'),('UK 8'),('UK 9'),('UK 10')) s(size)
where p.category='running-shoes' and p.kind='primary'
on conflict(id) do update set price_paise=excluded.price_paise,stock=excluded.stock,attributes=excluded.attributes;
