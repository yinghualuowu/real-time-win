create table public.game_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  nickname text not null check (
    length(nickname) between 1 and 24
    and nickname ~ '^[A-Za-z0-9_一-龥]+$'
  ),
  platform char(1) not null check (platform in ('Q', 'V')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index game_profiles_user_nickname_unique
  on public.game_profiles(user_id, lower(nickname));

create table public.match_settings (
  user_id uuid not null,
  profile_id uuid not null,
  initial_score integer not null default 100,
  win_points integer not null default 10 check (win_points >= 0),
  loss_points integer not null default 10 check (loss_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id),
  foreign key (user_id, profile_id)
    references public.game_profiles(user_id, id) on delete cascade
);

create table public.match_records (
  user_id uuid not null,
  profile_id uuid not null,
  id uuid not null default gen_random_uuid(),
  external_id text not null,
  played_on date not null,
  match_order integer not null check (match_order > 0),
  team_size integer not null check (team_size between 1 and 5),
  result smallint not null check (result in (0, 1)),
  lane smallint check (lane between 0 and 4),
  points_change integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, id),
  foreign key (user_id, profile_id)
    references public.game_profiles(user_id, id) on delete cascade,
  unique (user_id, profile_id, external_id),
  unique (user_id, profile_id, played_on, match_order)
);

comment on table public.game_profiles is '一个登录用户可管理的多个游戏账号';
comment on column public.game_profiles.nickname is '用户内不区分大小写唯一，仅允许中英文、数字和下划线';
comment on column public.game_profiles.platform is 'Q 表示 QQ 区，V 表示微信区';
comment on table public.match_settings is '每个游戏账号独立的积分规则';
comment on table public.match_records is '按游戏账号隔离的逐场对局记录';
comment on column public.match_records.match_order is '同一天内的对局顺序';
comment on column public.match_records.lane is '0 对抗路、1 打野、2 中路、3 发育路、4 游走；NULL 为旧记录未设置';

create index match_records_profile_date_idx
  on public.match_records(user_id, profile_id, played_on, match_order);
create index match_records_profile_team_idx
  on public.match_records(user_id, profile_id, team_size, played_on);
create index match_records_profile_lane_idx
  on public.match_records(user_id, profile_id, lane, played_on);

create or replace function public.touch_match_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

create trigger game_profiles_touch_updated_at before update on public.game_profiles
for each row execute function public.touch_match_updated_at();
create trigger match_settings_touch_updated_at before update on public.match_settings
for each row execute function public.touch_match_updated_at();
create trigger match_records_touch_updated_at before update on public.match_records
for each row execute function public.touch_match_updated_at();

alter table public.game_profiles enable row level security;
alter table public.match_settings enable row level security;
alter table public.match_records enable row level security;

create policy "Users manage own game profiles" on public.game_profiles
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users manage own match settings" on public.match_settings
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users manage own match records" on public.match_records
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.game_profiles, public.match_settings, public.match_records from anon;
grant select, insert, update, delete on table
  public.game_profiles, public.match_settings, public.match_records to authenticated;

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
      user_id, profile_id, external_id, played_on, match_order, team_size, result, lane, points_change
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

-- 将当前账号的数据移动到新账号，原账号自动与这些数据断开。
create or replace function public.transfer_match_document(p_from_profile_id uuid, p_to_profile_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.game_profiles
    where user_id = current_user_id and id in (p_from_profile_id, p_to_profile_id)
    group by user_id having count(*) = 2
  ) then raise exception 'Game profile not found'; end if;

  delete from public.match_records
    where user_id = current_user_id and profile_id = p_to_profile_id;
  delete from public.match_settings
    where user_id = current_user_id and profile_id = p_to_profile_id;
  update public.match_settings set profile_id = p_to_profile_id
    where user_id = current_user_id and profile_id = p_from_profile_id;
  update public.match_records set profile_id = p_to_profile_id
    where user_id = current_user_id and profile_id = p_from_profile_id;
end;
$$;

revoke all on function public.save_match_document(uuid, jsonb) from public;
grant execute on function public.save_match_document(uuid, jsonb) to authenticated;
revoke all on function public.transfer_match_document(uuid, uuid) from public;
grant execute on function public.transfer_match_document(uuid, uuid) to authenticated;
