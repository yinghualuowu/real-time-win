-- Avoid reporting optimistic concurrency conflicts as PostgreSQL serialization failures.
-- SQLSTATE 40001 is commonly retried automatically, which can amplify stale saves into
-- repeated RPC calls and high database CPU.
create or replace function public.save_match_document(
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
  next_revision bigint;
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

  update public.match_settings
  set initial_score = coalesce((p_document->>'initialScore')::integer, 100),
      win_points = greatest(coalesce((p_document->>'winPoints')::integer, 10), 0),
      loss_points = greatest(coalesce((p_document->>'lossPoints')::integer, 10), 0),
      revision = revision + 1
  where user_id = current_user_id
    and profile_id = p_profile_id
    and revision = p_expected_revision
  returning revision into next_revision;

  if not found then
    select revision into current_revision
    from public.match_settings
    where user_id = current_user_id and profile_id = p_profile_id;

    raise exception using
      message = format(
        'revision_conflict expected=%s actual=%s',
        p_expected_revision,
        current_revision
      ),
      errcode = 'P0001';
  end if;

  -- Keep the existing full-document replacement semantics.
  delete from public.match_records
  where user_id = current_user_id and profile_id = p_profile_id;
  delete from public.match_seasons
  where user_id = current_user_id and profile_id = p_profile_id;
  delete from public.match_heroes
  where user_id = current_user_id and profile_id = p_profile_id;

  insert into public.match_seasons (
    user_id, profile_id, external_id, name, starts_on, ends_on
  )
  select
    current_user_id,
    p_profile_id,
    item->>'id',
    btrim(item->>'name'),
    (item->>'startDate')::date,
    (item->>'endDate')::date
  from jsonb_array_elements(
    coalesce(p_document->'seasons', '[]'::jsonb)
  ) as entries(item);

  insert into public.match_heroes (
    user_id, profile_id, external_id, name
  )
  select
    current_user_id,
    p_profile_id,
    item->>'id',
    btrim(item->>'name')
  from jsonb_array_elements(
    coalesce(p_document->'heroes', '[]'::jsonb)
  ) as entries(item);

  insert into public.match_records (
    user_id, profile_id, external_id, played_on, match_order,
    team_size, result, lane, points_change, hero_external_id
  )
  select
    current_user_id,
    p_profile_id,
    coalesce(nullif(item->>'id', ''), gen_random_uuid()::text),
    (item->>'date')::date,
    coalesce((item->>'order')::integer, ordinality::integer),
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
  from jsonb_array_elements(
    coalesce(p_document->'records', '[]'::jsonb)
  ) with ordinality as entries(item, ordinality);

  return next_revision;
end;
$$;

revoke all on function public.save_match_document(uuid, jsonb, bigint) from public;
grant execute on function public.save_match_document(uuid, jsonb, bigint) to authenticated;
