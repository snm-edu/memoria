-- ============================================================
-- 既卒生リスタート支援 Supabase基盤 (Step 1)
-- 対象: card_states のクラウド同期 + トークンリンク認証
-- 方針: テーブルへの直接アクセスは全面禁止（RLS deny-all）。
--       PWA からのアクセスは SECURITY DEFINER の RPC 関数経由のみ。
--       anon キーが公開されても、有効なトークンなしには何も読めない。
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1. students: リスタート対象学生マスター
--    （在校生は当面登録しない。同期対象を既卒生に限定するため）
-- ------------------------------------------------------------
create table public.students (
  id                uuid primary key default gen_random_uuid(),
  student_number    text not null unique,           -- 学籍番号（例: 23040033）
  student_name      text not null,
  department        text not null
                    check (department in ('nursing','clinical_eng','dental_hyg','orthoptist')),
  grade             int  not null default 4,
  student_type      text not null default 'graduate'
                    check (student_type in ('enrolled','graduate','prospective')),
  teams_email       text,                           -- Teams DM宛先（名簿Excelと一致させる）
  legacy_student_id uuid,                           -- 既存PWAの端末生成studentId（Sheetsログ突合用）
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. access_tokens: DMリンク用の個人トークン（再発行・無効化可能）
-- ------------------------------------------------------------
create table public.access_tokens (
  token       text primary key,                     -- ランダム48文字hex
  student_id  uuid not null references public.students(id) on delete cascade,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz                           -- NULL=有効
);

create index access_tokens_student_idx on public.access_tokens (student_id);

-- ------------------------------------------------------------
-- 3. card_states: SM-2カード状態（PWAのIndexedDB CardStateと1:1対応）
-- ------------------------------------------------------------
create table public.card_states (
  student_id                  uuid not null references public.students(id) on delete cascade,
  question_id                 text not null,
  ease_factor                 real not null default 2.5,
  interval_days               int  not null default 0,   -- PWA側 interval
  repetitions                 int  not null default 0,
  next_review                 date not null default current_date,
  last_review                 date,
  hint_level                  int  not null default 0,   -- メモリアステップ 0-6
  consecutive_correct_at_zero int  not null default 0,
  updated_at                  timestamptz not null default now(),
  primary key (student_id, question_id)
);

-- /today セッションの核心クエリ「due_at <= 今日」を高速化
create index card_states_due_idx on public.card_states (student_id, next_review);

-- ------------------------------------------------------------
-- 4. RLS: 全テーブル deny-all（anon/authenticated の直接アクセス禁止）
-- ------------------------------------------------------------
alter table public.students      enable row level security;
alter table public.access_tokens enable row level security;
alter table public.card_states   enable row level security;

revoke all on public.students      from anon, authenticated;
revoke all on public.access_tokens from anon, authenticated;
revoke all on public.card_states   from anon, authenticated;

-- ------------------------------------------------------------
-- 5. RPC: トークン解決（PWAが最初に呼ぶ）
-- ------------------------------------------------------------
create or replace function public.resolve_token(p_token text)
returns table (
  student_id     uuid,
  student_number text,
  student_name   text,
  department     text,
  grade          int,
  student_type   text
)
language sql
security definer
set search_path = public
stable
as $$
  select s.id, s.student_number, s.student_name, s.department, s.grade, s.student_type
  from access_tokens t
  join students s on s.id = t.student_id
  where t.token = p_token
    and t.revoked_at is null
    and s.is_active;
$$;

-- ------------------------------------------------------------
-- 6. RPC: カード状態の取得（端末が空のときの復元 = hydrate）
-- ------------------------------------------------------------
create or replace function public.pull_card_states(p_token text)
returns table (
  question_id                 text,
  ease_factor                 real,
  interval_days               int,
  repetitions                 int,
  next_review                 date,
  last_review                 date,
  hint_level                  int,
  consecutive_correct_at_zero int,
  updated_at                  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select c.question_id, c.ease_factor, c.interval_days, c.repetitions,
         c.next_review, c.last_review, c.hint_level,
         c.consecutive_correct_at_zero, c.updated_at
  from card_states c
  where c.student_id = (
    select t.student_id from access_tokens t
    join students s on s.id = t.student_id
    where t.token = p_token and t.revoked_at is null and s.is_active
  );
$$;

-- ------------------------------------------------------------
-- 7. RPC: カード状態のアップロード（last-write-wins）
--    p_cards: [{question_id, ease_factor, interval_days, repetitions,
--               next_review, last_review, hint_level,
--               consecutive_correct_at_zero, updated_at}, ...]
-- ------------------------------------------------------------
create or replace function public.push_card_states(p_token text, p_cards jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_count int;
begin
  select t.student_id into v_student_id
  from access_tokens t
  join students s on s.id = t.student_id
  where t.token = p_token and t.revoked_at is null and s.is_active;

  if v_student_id is null then
    raise exception 'invalid token';
  end if;

  with incoming as (
    select
      v_student_id                                   as student_id,
      x.question_id,
      coalesce(x.ease_factor, 2.5)                   as ease_factor,
      coalesce(x.interval_days, 0)                   as interval_days,
      coalesce(x.repetitions, 0)                     as repetitions,
      coalesce(x.next_review, current_date)          as next_review,
      x.last_review,
      coalesce(x.hint_level, 0)                      as hint_level,
      coalesce(x.consecutive_correct_at_zero, 0)     as consecutive_correct_at_zero,
      coalesce(x.updated_at, now())                  as updated_at
    from jsonb_to_recordset(p_cards) as x(
      question_id                 text,
      ease_factor                 real,
      interval_days               int,
      repetitions                 int,
      next_review                 date,
      last_review                 date,
      hint_level                  int,
      consecutive_correct_at_zero int,
      updated_at                  timestamptz
    )
    where x.question_id is not null
  ),
  upserted as (
    insert into card_states as c
      (student_id, question_id, ease_factor, interval_days, repetitions,
       next_review, last_review, hint_level, consecutive_correct_at_zero, updated_at)
    select * from incoming
    on conflict (student_id, question_id) do update set
      ease_factor                 = excluded.ease_factor,
      interval_days               = excluded.interval_days,
      repetitions                 = excluded.repetitions,
      next_review                 = excluded.next_review,
      last_review                 = excluded.last_review,
      hint_level                  = excluded.hint_level,
      consecutive_correct_at_zero = excluded.consecutive_correct_at_zero,
      updated_at                  = excluded.updated_at
    where excluded.updated_at >= c.updated_at   -- last-write-wins
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 8. 管理用: 学生登録 + トークン発行（SQL Editorから教員が実行）
-- ------------------------------------------------------------
create or replace function public.admin_register_student(
  p_student_number text,
  p_student_name   text,
  p_department     text default 'clinical_eng',
  p_teams_email    text default null
)
returns table (student_number text, student_name text, token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_student_id uuid;
  v_token text;
begin
  insert into students (student_number, student_name, department, teams_email)
  values (p_student_number, p_student_name, p_department, p_teams_email)
  on conflict (student_number) do update set
    student_name = excluded.student_name,
    teams_email  = excluded.teams_email,
    is_active    = true
  returning id into v_student_id;

  -- 既存の有効トークンがあれば再利用、なければ発行
  select t.token into v_token
  from access_tokens t
  where t.student_id = v_student_id and t.revoked_at is null
  limit 1;

  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(24), 'hex');  -- 48文字
    insert into access_tokens (token, student_id) values (v_token, v_student_id);
  end if;

  return query select p_student_number, p_student_name, v_token;
end;
$$;

-- admin関数はanonから呼べないようにする（SQL Editor=service_roleからのみ）
revoke execute on function public.admin_register_student(text, text, text, text) from anon, authenticated, public;

-- ------------------------------------------------------------
-- 9. 管理用ビュー: 名簿Excel作成用（学生×トークン×URL一覧）
-- ------------------------------------------------------------
create or replace view public.v_roster as
select
  s.student_number,
  s.student_name,
  s.teams_email,
  t.token,
  'https://memoria-flame.vercel.app/?t=' || t.token as url
from students s
join access_tokens t on t.student_id = s.id and t.revoked_at is null
where s.is_active
order by s.student_number;

revoke all on public.v_roster from anon, authenticated;
