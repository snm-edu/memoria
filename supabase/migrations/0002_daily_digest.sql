-- ============================================================
-- 0002: Teams 日次DM個別化用ビュー（v_roster_daily）
--
-- Power Automate が毎日のDM本文に「今日の復習◯問・要注意◯問」を
-- 差し込めるよう、card_states を学生別に集計して名簿へ結合する。
-- 適用方法: Supabase SQL Editor に貼り付けて Run（0001適用済みが前提）
-- ============================================================

create or replace view public.v_roster_daily as
select
  s.student_number,
  s.student_name,
  s.teams_email,
  'https://memoria-flame.vercel.app/?t=' || t.token as url,
  -- 今日(JST)までに期限が来ている復習カード数
  coalesce(cs.due_count, 0)  as due_count,
  -- 弱点カード数。定義は PWA 側 sessionSelect.ts の isWeakCard と一致させること:
  --   hint_level>=2 / ease_factor<=2.0 / (repetitions=0 かつ 学習済み)
  coalesce(cs.weak_count, 0) as weak_count,
  cs.last_review,
  -- 7日以上学習が途切れている（DM文面を「やさしい再開促し」に切り替える判定用）
  (cs.last_review is null
    or cs.last_review < ((now() at time zone 'Asia/Tokyo')::date - 6)) as is_stalled
from students s
join access_tokens t on t.student_id = s.id and t.revoked_at is null
left join (
  select
    student_id,
    count(*) filter (
      where next_review <= (now() at time zone 'Asia/Tokyo')::date
    ) as due_count,
    count(*) filter (
      where hint_level >= 2
         or ease_factor <= 2.0
         or (repetitions = 0 and last_review is not null)
    ) as weak_count,
    max(last_review) as last_review
  from card_states
  group by student_id
) cs on cs.student_id = s.id
where s.is_active
order by s.student_number;

-- anon からは読めない（Power Automate は service_role キーで PostgREST を叩く）
revoke all on public.v_roster_daily from anon, authenticated;
