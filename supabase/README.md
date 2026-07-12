# Supabase基盤（既卒生リスタート支援）

PWAのSM-2カード状態をクラウド同期し、Teams DMのトークン付きリンクから
どのブラウザでも本人の学習状態で開けるようにするための基盤。

## アーキテクチャ方針

- **IndexedDBは残す**（ローカルキャッシュ・オフライン対応はそのまま）
- card_states を Supabase へバックグラウンド同期（`sync.ts` の回答ログ同期と同じパターン)
- テーブルへの直接アクセスは RLS で全面禁止。PWAからは RPC 関数（resolve_token /
  pull_card_states / push_card_states）経由のみ。anon キーが公開されても
  有効なトークンなしには何も読み書きできない
- 同期対象は当面 **既卒生（student_type=graduate）のみ**。在校生には影響を出さない

## セットアップ手順（初回のみ・所要15分）

1. https://supabase.com にサインアップ（無料プラン・GitHubアカウント連携が楽）
2. 「New project」→ 名前 `memoria` / リージョン **Northeast Asia (Tokyo)** / DBパスワードを安全に保管
3. 左メニュー「SQL Editor」→ `migrations/0001_restart_foundation.sql` の中身を貼り付けて Run
4. 左メニュー「Settings → API」から以下を控える:
   - Project URL（例: `https://xxxx.supabase.co`）
   - `anon` `public` キー
5. Vercel の環境変数に追加（Production / Preview 両方）:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon キー
   - ※ anon キーは「公開される前提」のキー（RLS deny-all + RPC設計なので安全）

## 学生の登録とトークン発行

SQL Editor で1人ずつ（または24行まとめて）実行:

```sql
select * from admin_register_student('00000000', '山田 花子', 'clinical_eng', 'sample@class.snm.ac.jp');
```

戻り値に `token` と学生情報が返る。全員登録後、名簿Excel用の一覧を出す:

```sql
select * from v_roster;
```

→ この `student_name` / `teams_email` / `url` を OneDrive の名簿Excel
（Name / Email / Url 列）に貼り付ければ、Power Automate 配信フローの台帳が完成。

## トークンの無効化・再発行（漏洩時など）

```sql
-- 無効化
update access_tokens set revoked_at = now()
where student_id = (select id from students where student_number = '00000000');

-- 再発行（admin_register_student を再実行すれば新トークンが発行される）
select * from admin_register_student('00000000', '山田 花子', 'clinical_eng', 'sample@class.snm.ac.jp');
```

## 日次DMの個別化（v_roster_daily・0002）

`migrations/0002_daily_digest.sql` を SQL Editor で適用すると、DM本文差し込み用の
集計ビュー `v_roster_daily` が使える（due_count / weak_count / is_stalled 付き名簿）。

Power Automate 側の組み込み方:

1. フローに「HTTP」アクションを追加し、毎朝の配信前に1回だけ実行
   - Method: `GET`
   - URI: `https://<project>.supabase.co/rest/v1/v_roster_daily?select=student_number,student_name,teams_email,url,due_count,weak_count,is_stalled`
   - Headers: `apikey: <service_role キー>` / `Authorization: Bearer <service_role キー>`
2. 返却JSONを「JSON の解析」→ Apply to each で名簿Excelの代わりに使う
   （teams_email 宛に url とともに本文を組み立てる）
3. 本文テンプレ例:
   - 通常: `今日の復習は {due_count} 問、要注意問題は {weak_count} 問です。ここから3分だけ→ {url}`
   - is_stalled=true: `少し間があきましたね。今日は1問だけでも大丈夫です→ {url}`

⚠️ `service_role` キーは全権キー。Power Automate の接続情報（セキュア入力）にのみ保存し、
Excel・リポジトリ・チャットには絶対に貼らないこと。anon キーではこのビューは読めない（意図的）。

## 今後の拡張（Step 4以降・このスキーマの続き）

- `answer_logs` テーブル追加 → GAS/Sheets からの移行
- Looker Studio を PostgreSQL コネクタで直結（読み取り専用ロールを作成すること）
- シグナル算出ビュー（学習停滞 / 自信誤答 / 弱点固定）→ 教員ダッシュボード
