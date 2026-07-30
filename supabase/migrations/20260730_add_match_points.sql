alter table public.match_records
  add column if not exists points_change integer;

update public.match_records as record
set points_change = case
  when record.result = 1 then settings.win_points
  else -settings.loss_points
end
from public.match_settings as settings
where record.user_id = settings.user_id
  and record.profile_id = settings.profile_id
  and record.points_change is null;

update public.match_records
set points_change = case when result = 1 then 10 else -10 end
where points_change is null;

alter table public.match_records
  alter column points_change set not null;

comment on column public.match_records.points_change is
  '该场实际积分变化，可独立于默认胜负积分规则修改';

create or replace function public.save_match_document(p_profile_id uuid, p_document jsonb)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  item jsonb;
  saved_count integer := 0;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.game_profiles
    where user_id = current_user_id and id = p_profile_id
  ) then raise exception 'Game profile not found'; end if;
  if jsonb_typeof(coalesce(p_document->'records', '[]'::jsonb)) <> 'array'
    then raise exception 'records must be an array'; end if;

  insert into public.match_settings (user_id, profile_id, initial_score, win_points, loss_points)
  values (
    current_user_id, p_profile_id,
    coalesce((p_document->>'initialScore')::integer, 100),
    greatest(coalesce((p_document->>'winPoints')::integer, 10), 0),
    greatest(coalesce((p_document->>'lossPoints')::integer, 10), 0)
  )
  on conflict (user_id, profile_id) do update set
    initial_score = excluded.initial_score,
    win_points = excluded.win_points,
    loss_points = excluded.loss_points;

  delete from public.match_records
  where user_id = current_user_id and profile_id = p_profile_id;

  for item in select value from jsonb_array_elements(coalesce(p_document->'records', '[]'::jsonb))
  loop
    insert into public.match_records (
      user_id, profile_id, external_id, played_on, match_order,
      team_size, result, lane, points_change
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
      )
    );
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;
