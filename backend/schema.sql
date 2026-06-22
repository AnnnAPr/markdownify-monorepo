-- Markdownify — Supabase schema
create table if not exists app_metrics (
  id              int primary key default 1,
  total_requests  bigint not null default 0,
  cache_hits      bigint not null default 0,
  successes       bigint not null default 0,
  failures        bigint not null default 0,
  tokens_saved    bigint not null default 0,
  word_count      bigint not null default 0,
  unique_ips      bigint not null default 0,
  page_views      bigint not null default 0,
  ip_stats        jsonb  not null default '{}'::jsonb
);

insert into app_metrics (id)
values (1)
on conflict (id) do nothing;


-- 2. Atomic counter increment
create or replace function increment_metric(field_name text, increment_by bigint)
returns void
language plpgsql
as $$
begin
  execute format(
    'update app_metrics set %I = %I + $1 where id = 1',
    field_name, field_name
  ) using increment_by;
end;
$$;


-- 3. Atomic ip_stats update
create or replace function update_ip_stats(p_ip text, p_type text)
returns void
language plpgsql
as $$
declare
  current_count bigint;
begin
  -- Get current count for IP + action type
  select coalesce((ip_stats -> p_ip ->> p_type)::bigint, 0)
  into current_count
  from app_metrics
  where id = 1
  for update;   -- lock row

  update app_metrics
  set
    ip_stats  = jsonb_set(
                  coalesce(ip_stats, '{}'::jsonb),
                  array[p_ip, p_type],
                  to_jsonb(current_count + 1),
                  true
                ),
    unique_ips = (
                  select count(distinct key)
                  from jsonb_object_keys(
                    jsonb_set(
                      coalesce(ip_stats, '{}'::jsonb),
                      array[p_ip, p_type],
                      to_jsonb(current_count + 1),
                      true
                    )
                  ) as key
                )
  where id = 1;
end;
$$;
