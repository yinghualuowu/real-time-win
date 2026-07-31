alter table public.match_settings
  add column if not exists revision bigint not null default 0
  check (revision >= 0);

comment on column public.match_settings.revision is
  '整份对局文档的乐观并发版本；每次成功保存递增';

drop function if exists public.save_match_document(uuid, jsonb);

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
  if jsonb_typeof(coalesce(p_document->'records', '[]'::jsonb)) <> 'array' then
    raise exception 'records must be an array';
  end if;

  insert into public.match_settings (
    user_id, profile_id, initial_score, win_points, loss_points, revision
  )
  values (current_user_id, p_profile_id, 100, 10, 10, 0)
  on conflict (user_id, profile_id) do nothing;

  select revision
  into current_revision
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

  for item in
    select value
    from jsonb_array_elements(coalesce(p_document->'records', '[]'::jsonb))
  loop
    insert into public.match_records (
      user_id, profile_id, external_id, played_on, match_order,
      team_size, result, lane, points_change
    )
    values (
      current_user_id,
      p_profile_id,
      coalesce(nullif(item->>'id', ''), gen_random_uuid()::text),
      (item->>'date')::date,
      coalesce((item->>'order')::integer, saved_count + 1),
      (item->>'teamSize')::integer,
      (item->>'result')::smallint,
      case
        when item ? 'lane' and item->>'lane' is not null
          then (item->>'lane')::smallint
        else null
      end,
      coalesce(
        (item->>'points')::integer,
        case
          when (item->>'result')::smallint = 1
            then coalesce((p_document->>'winPoints')::integer, 10)
          else -coalesce((p_document->>'lossPoints')::integer, 10)
        end
      )
    );
    saved_count := saved_count + 1;
  end loop;

  return current_revision + 1;
end;
$$;

revoke all on function public.save_match_document(uuid, jsonb, bigint) from public;
grant execute on function public.save_match_document(uuid, jsonb, bigint) to authenticated;
