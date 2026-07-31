create extension if not exists btree_gist with schema extensions;

create table public.match_seasons (
  user_id uuid not null,
  profile_id uuid not null,
  id uuid not null default gen_random_uuid(),
  external_id text not null check (length(btrim(external_id)) > 0),
  name text not null check (length(btrim(name)) > 0),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, id),
  foreign key (user_id, profile_id)
    references public.game_profiles(user_id, id) on delete cascade,
  unique (user_id, profile_id, external_id),
  check (starts_on <= ends_on),
  exclude using gist (
    user_id with =,
    profile_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create table public.match_heroes (
  user_id uuid not null,
  profile_id uuid not null,
  id uuid not null default gen_random_uuid(),
  external_id text not null check (length(btrim(external_id)) > 0),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, id),
  foreign key (user_id, profile_id)
    references public.game_profiles(user_id, id) on delete cascade,
  unique (user_id, profile_id, external_id)
);

create unique index match_seasons_profile_name_unique
  on public.match_seasons(user_id, profile_id, lower(btrim(name)));
create index match_seasons_profile_range_idx
  on public.match_seasons(user_id, profile_id, starts_on, ends_on);
create unique index match_heroes_profile_name_unique
  on public.match_heroes(user_id, profile_id, lower(btrim(name)));
create index match_heroes_profile_name_idx
  on public.match_heroes(user_id, profile_id, name);

create trigger match_seasons_touch_updated_at
before update on public.match_seasons
for each row execute function public.touch_match_updated_at();
create trigger match_heroes_touch_updated_at
before update on public.match_heroes
for each row execute function public.touch_match_updated_at();

alter table public.match_records
  add column hero_external_id text;

alter table public.match_records
  add constraint match_records_hero_reference
  foreign key (user_id, profile_id, hero_external_id)
  references public.match_heroes(user_id, profile_id, external_id)
  on update cascade
  deferrable initially deferred;

create index match_records_profile_hero_idx
  on public.match_records(user_id, profile_id, hero_external_id, played_on);

comment on table public.match_seasons is '每个游戏账号的赛季闭区间；同一账号内日期不可重叠';
comment on table public.match_heroes is '每个游戏账号的英雄字典；名称不区分大小写唯一';
comment on column public.match_records.hero_external_id is '引用同一游戏账号下英雄的客户端 ID；旧记录为空';

alter table public.match_seasons enable row level security;
alter table public.match_heroes enable row level security;

create policy "Users manage own match seasons" on public.match_seasons
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users manage own match heroes" on public.match_heroes
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.match_seasons, public.match_heroes from anon;
grant select, insert, update, delete on table
  public.match_seasons, public.match_heroes to authenticated;

drop function if exists public.save_match_document(uuid, jsonb, bigint);

create function public.save_match_document(
  p_profile_id uuid,
  p_document jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_revision bigint;
  item jsonb;
  saved_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected revision must be a non-negative integer';
  end if;
  if not exists (
    select 1 from public.game_profiles
    where user_id = current_user_id and id = p_profile_id
  ) then
    raise exception 'Game profile not found';
  end if;
  if jsonb_typeof(coalesce(p_document->'seasons', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_document->'heroes', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_document->'records', '[]'::jsonb)) <> 'array'
  then
    raise exception 'seasons, heroes and records must be arrays';
  end if;

  insert into public.match_settings (
    user_id, profile_id, initial_score, win_points, loss_points, revision
  )
  values (current_user_id, p_profile_id, 100, 10, 10, 0)
  on conflict (user_id, profile_id) do nothing;

  select revision into current_revision
  from public.match_settings
  where user_id = current_user_id and profile_id = p_profile_id
  for update;

  if current_revision <> p_expected_revision then
    raise exception using
      message = format(
        'revision_conflict expected=%s actual=%s',
        p_expected_revision,
        current_revision
      ),
      errcode = '40001';
  end if;

  update public.match_settings
  set initial_score = coalesce((p_document->>'initialScore')::integer, 100),
      win_points = greatest(coalesce((p_document->>'winPoints')::integer, 10), 0),
      loss_points = greatest(coalesce((p_document->>'lossPoints')::integer, 10), 0),
      revision = current_revision + 1
  where user_id = current_user_id and profile_id = p_profile_id;

  delete from public.match_records
  where user_id = current_user_id and profile_id = p_profile_id;
  delete from public.match_seasons
  where user_id = current_user_id and profile_id = p_profile_id;
  delete from public.match_heroes
  where user_id = current_user_id and profile_id = p_profile_id;

  for item in
    select value from jsonb_array_elements(coalesce(p_document->'seasons', '[]'::jsonb))
  loop
    insert into public.match_seasons (
      user_id, profile_id, external_id, name, starts_on, ends_on
    ) values (
      current_user_id, p_profile_id,
      item->>'id', btrim(item->>'name'),
      (item->>'startDate')::date, (item->>'endDate')::date
    );
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_document->'heroes', '[]'::jsonb))
  loop
    insert into public.match_heroes (
      user_id, profile_id, external_id, name
    ) values (
      current_user_id, p_profile_id,
      item->>'id', btrim(item->>'name')
    );
  end loop;

  for item in
    select value from jsonb_array_elements(coalesce(p_document->'records', '[]'::jsonb))
  loop
    insert into public.match_records (
      user_id, profile_id, external_id, played_on, match_order,
      team_size, result, lane, points_change, hero_external_id
    ) values (
      current_user_id, p_profile_id,
      coalesce(nullif(item->>'id', ''), gen_random_uuid()::text),
      (item->>'date')::date,
      coalesce((item->>'order')::integer, saved_count + 1),
      (item->>'teamSize')::integer,
      (item->>'result')::smallint,
      case when item ? 'lane' and item->>'lane' is not null
        then (item->>'lane')::smallint else null end,
      coalesce(
        (item->>'points')::integer,
        case when (item->>'result')::smallint = 1
          then coalesce((p_document->>'winPoints')::integer, 10)
          else -coalesce((p_document->>'lossPoints')::integer, 10)
        end
      ),
      nullif(item->>'heroId', '')
    );
    saved_count := saved_count + 1;
  end loop;

  return current_revision + 1;
end;
$$;

create or replace function public.transfer_match_document(
  p_from_profile_id uuid,
  p_to_profile_id uuid
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if p_from_profile_id = p_to_profile_id then return; end if;
  if not exists (
    select 1 from public.game_profiles
    where user_id = current_user_id and id in (p_from_profile_id, p_to_profile_id)
    group by user_id having count(*) = 2
  ) then raise exception 'Game profile not found'; end if;

  set constraints all deferred;
  delete from public.match_records
    where user_id = current_user_id and profile_id = p_to_profile_id;
  delete from public.match_seasons
    where user_id = current_user_id and profile_id = p_to_profile_id;
  delete from public.match_heroes
    where user_id = current_user_id and profile_id = p_to_profile_id;
  delete from public.match_settings
    where user_id = current_user_id and profile_id = p_to_profile_id;

  update public.match_settings set profile_id = p_to_profile_id
    where user_id = current_user_id and profile_id = p_from_profile_id;
  update public.match_seasons set profile_id = p_to_profile_id
    where user_id = current_user_id and profile_id = p_from_profile_id;
  update public.match_heroes set profile_id = p_to_profile_id
    where user_id = current_user_id and profile_id = p_from_profile_id;
  update public.match_records set profile_id = p_to_profile_id
    where user_id = current_user_id and profile_id = p_from_profile_id;
end;
$$;

revoke all on function public.save_match_document(uuid, jsonb, bigint) from public;
grant execute on function public.save_match_document(uuid, jsonb, bigint) to authenticated;
revoke all on function public.transfer_match_document(uuid, uuid) from public;
grant execute on function public.transfer_match_document(uuid, uuid) to authenticated;
