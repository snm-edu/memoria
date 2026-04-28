# 学生用ツリーマップ 設計書

## Context

札幌看護医療学院（4学科・600名）の Memoria PWA に、教員 Looker Studio ダッシュボードと共通言語化された **学生個人用ツリーマップ** を追加する。

教員側は既に `category_stats` シートをソースに 大分類 > 中分類 > 小分類 の3階層ツリーマップで全体俯瞰・個別ドリルダウンを行えている。学生側にも同等のビューを提供することで、教員と学生が同じ可視化を共有し、学習指導・自己学習の両面で「同じ語彙」で議論できるようにする。

既存の学生用「弱点マップ」(`WeaknessMap.tsx`) は1階層・ローカル限定の横棒バーで、教員ビューと粒度が異なる。本設計はこれを置き換える。

---

## 1. 目的とスコープ

### 1.1 目的

- 教員 Looker と**共通言語**化された分類体系・正答率で学生が自分の習熟状況を俯瞰できる
- 大→中→小分類の3階層をネスト表示し、面積=出題数・色=正答率で直感的に「どこをやれば伸びるか」可視化
- 表示中スコープから直接演習開始でき、復習スケジュール (SM-2) と既存 AI フロー (3回目誤答→類題生成) に自動連携

### 1.2 スコープ内

- 学生 PWA に新ツリーマップ画面を追加
- 既存 `WeaknessMap.tsx` を置き換え、ナビ「📊 弱点」タブから差し替え
- GAS に `getStudentTreemap` / `refreshStudentTreemap` API を新設
- 未着手領域 (curriculum 結合) のグレー表示
- IndexedDB ローカルキャッシュ + 楽観的更新

### 1.3 スコープ外

- 教員 Looker ダッシュボードの改修 (学生側の効果検証後に別案件で検討)
- ツリーマップ以外の新可視化
- 学科横断比較
- 教員→学生プッシュ通知
- 新規 AI 機能 (既存の誤答分析・類題生成を流用するのみ)

---

## 2. アーキテクチャ

### 2.1 全体構成

```
[学生PWA]
 ├ WeaknessTreemap.tsx     ← コンテナ(状態管理・フェッチ・ズームレベル管理)
 │  ├ Treemap.tsx          ← 描画専用(d3-hierarchy で計算 + SVG レンダリング)
 │  ├ TreemapBreadcrumb.tsx← 上部パンくず
 │  ├ TreemapLegend.tsx    ← 右上色凡例(赤←→緑)
 │  └ ChallengeFab.tsx     ← 下部「ここから解く(N問)」FAB
 │
 ↓ fetch
[GAS バックエンド]
 ├ TreemapService.gs       ← 新規
 │  ├ getStudentTreemap(studentId)        GET    フェッチ用
 │  └ refreshStudentTreemap(studentId)    POST   即時更新用
 │
 ↓ 参照
[Google Sheets]
 ├ category_stats          ← 既存(教員Looker と共通)
 ├ questions               ← 既存(出題マスタ・面積/未着手抽出)
 └ student_logs            ← 既存(refresh時の再集計元)
```

### 2.2 依存追加 (PWA)

| パッケージ | サイズ (min+gz) | 用途 |
|----------|---------------|------|
| `d3-hierarchy` | ~10KB | ツリーマップレイアウト計算 |
| `d3-scale-chromatic` | ~5KB | 赤→黄→緑色補間 (Looker と同一) |

既存の React / Vite / Tailwind / Dexie を流用。Gemini API は呼ばない。

### 2.3 コンポーネント分割の根拠

- `Treemap.tsx` は描画ロジック純粋関数化 → ユニットテスト容易、再利用可
- ズーム状態は `WeaknessTreemap.tsx` が一元管理 → パンくず・FAB・描画が同一スコープを参照
- `WeaknessMap.tsx` (既存) は削除し、ナビ「📊 弱点」から差し替え

---

## 3. データモデル

### 3.1 API レスポンス形式

`GET /exec?action=getStudentTreemap&studentId=xxx&grade=2`

```jsonc
{
  "success": true,
  "data": {
    "studentId": "abc-123",
    "department": "clinical_eng",
    "grade": 2,
    "updatedAt": "2026-04-28T04:00:00Z",
    "totalQuestions": 1980,
    "answered": 412,
    "tree": {
      "name": "すべて",
      "children": [
        {
          "name": "医用電気電子工学",
          "totalQuestions": 320,
          "answered": 180,
          "correctRate": 78,
          "children": [
            {
              "name": "電気工学",
              "totalQuestions": 120,
              "answered": 90,
              "correctRate": 85,
              "children": [
                {
                  "name": "オームの法則",
                  "totalQuestions": 15,
                  "answered": 12,
                  "correct": 10,
                  "correctRate": 83,
                  "confidence": "high"
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

### 3.2 面積の計算式

- **リーフ(小分類)の面積** = `questions` シート内で、以下を満たす問題数
  - `department` = 学生の学科
  - `category` ∈ `curriculum.grades[≤現在学年].categories` (学年累積で大分類フィルタ)
  - `(category, subcategory, subtopic)` が該当のセル
- **中・大分類の面積** = 配下リーフの面積合計 (d3 が自動集約)

→ 重要分野 (出題が多い) が自動的に大きく見える

備考: `subcategory` / `subtopic` には学年情報を持たないため、フィルタは大分類 (`category`) レベルのみで実施。同一大分類内の中分類・小分類は学年に関わらず全て表示される。

### 3.3 色の計算式 (Looker と同一スケール)

| 状態 | 色 | 補間関数 |
|------|----|----|
| `confidence: high` (5問以上解答) | `interpolateRdYlGn(rate/100)` で連続補間 (0%=赤・50%=黄・100%=緑) | `d3.interpolateRdYlGn(r/100)` |
| `confidence: low` (1-4問) | 同じ色を opacity 0.5 で表示 (信頼度低) | 上記 + 半透明 |
| `confidence: none` (未着手) | グレー `#cbd5e1` (slate-300) | 固定 |

### 3.4 ネスト集約のロジック (GAS 側)

1. `questions` シート → 学生の (department, ≤grade) 範囲で全問題スキャン → `(category, subcategory, subtopic) → totalQuestions` マスタ作成
2. `category_stats` シート → studentId フィルタで該当行取得 → `(category, subcategory, subtopic) → {answered, correct}` マップ
3. 1 と 2 を LEFT JOIN (マスタ基準) してリーフ配列作成 → category_stats に無い組合せは `answered:0, confidence:"none"`
4. category → subcategory → subtopic でネスト構造化
5. **未着手まとめセル化**: 同一親内の `confidence:"none"` リーフが3個以上の場合、`{name: "+未着手N件", isAggregate: true, children: [...]}` に集約

### 3.5 ローカルキャッシュ

IndexedDB 新テーブル:

```ts
treemapCache: 'studentId, fetchedAt, payload'
// payload: TreemapResponse
// pendingSync: boolean   楽観更新後、サーバ未同期
// lastQuizAt: number | null
```

---

## 4. UI 構成 (スマホ縦型レイアウト)

### 4.1 画面レイアウト

```
┌─────────────────────────────┐
│ ← 戻る   分野別学習マップ  ⟳  │  ヘッダー (~56px)
├─────────────────────────────┤
│ 全体 / 医用電気電子工学  ›    │  パンくず (~32px)
├─────────────────────────────┤
│ [未着手□] 苦手━━━ 得意   4/28│  色凡例 (~28px)
├─────────────────────────────┤
│ ┌────────────┬──────────┐   │
│ │ 医用電気    │ 医学概論  │   │
│ │ 電子工学    │          │   │
│ │ ┌──┬──┐    │ ┌──┬──┐ │   │
│ │ │緑│緑│    │ │黄│黄│ │   │  ツリーマップ本体
│ │ ├──┼──┤    │ ├──┼──┤ │   │  (残り全部・縦長 ~3:4)
│ │ │橙│赤│    │ │橙│橙│ │   │
│ │ └──┴──┘    │ └──┴──┘ │   │
│ ├────────────┼──────────┤   │
│ │ 生体機能代行装置学      │   │
│ └────────────┴──────────┘   │
├─────────────────────────────┤
│ 🎯「医用電気電子工学」を解く │  ChallengeFab (固定下部・72px)
│       (45問 · 苦手12問)      │
└─────────────────────────────┘
```

### 4.2 ツリーマップ仕様

- **アルゴリズム**: `d3.treemapSquarify` (アスペクト比1:1に近づける) — Looker と同方式
- **キャンバス比率**: `100vw × 約60dvh` (残りはヘッダー・パンくず・凡例・FAB)
- **ボーダー**: 親階層に太め白ボーダー(2px)、子階層に細ボーダー(1px) — Looker のグループ感を再現
- **ヘッダー帯**: 大分類セル上端に 24px の帯で名前を bold 表示。中分類は 18px の帯。小分類はセル内中央に名前
- **ラベル省略閾値**: セル幅 < 40px または 高さ < 24px なら非表示 (タップ時のツールチップで対応)
- **色塗り**: リーフ(小分類)のみ正答率由来の色を塗る → 親セルは白背景＋ヘッダー帯のみ → Looker と同じ「中身だけ色」表現

### 4.3 ジェスチャ

| 操作 | 挙動 |
|------|------|
| 大分類セルのタップ | その大分類だけ画面いっぱいにズーム |
| 中分類セルのタップ | その中分類だけズーム |
| 小分類セルのタップ | ボトムシート: 「分野名 / 出題N問 / 正答率N% / 最終学習日 / 解くボタン」 |
| パンくずの各セグメントタップ | そのセグメントのスコープに直接ジャンプ (例: 「全体 / 医用電気電子工学」のうち「全体」をタップ → 全体ビューへ) |
| FABタップ | 現在表示中スコープのクイズ開始 |
| Android バックボタン | 1階層戻る (全体ビューでは画面を閉じてホームへ) |
| `+未着手N件` セルのタップ | まとめセル展開 |

### 4.4 ズームアニメーション

`treemapResquarify` で滑らかに遷移 (300ms ease-out)。React 側は CSS transform 補間。

### 4.5 ChallengeFab

| ズームレベル | 表示テキスト |
|-------------|-------------|
| 全体 | 「全範囲を解く (1980問・苦手432問)」 |
| 大分類 | 「`医用電気電子工学`を解く (320問・苦手45問)」 |
| 中分類 | 「`電気工学`を解く (120問・苦手12問)」 |

「苦手N問」 = `correctRate < 60%` のリーフの answered 数合計。

タップで `dispatch({type: 'START_CATEGORY_QUIZ', category, subcategory, subtopic, scope})`。

---

## 5. 演習開始フロー

### 5.1 起動経路

3つすべて既存 `START_CATEGORY_QUIZ` dispatch を再利用:

1. FABタップ (現在のズームスコープを解く)
2. 小分類タップ → ボトムシート「解く」
3. `+未着手N件` 展開 → 個別未着手セルタップ

### 5.2 dispatch ペイロード拡張

```ts
type StartCategoryQuiz = {
  type: 'START_CATEGORY_QUIZ';
  category?: string;
  subcategory?: string;
  subtopic?: string;                          // 新規追加
  scope: 'all' | 'weak' | 'unstudied';        // 新規追加
};
```

| scope | 出題内容 |
|-------|---------|
| `all` | 範囲内全問題からランダム (FABデフォルト) |
| `weak` | 範囲内で正答率<60%の問題優先 |
| `unstudied` | 未着手問題のみ (`+未着手N件` 経由) |

QuizScreen 側の出題ロジックを拡張: subtopic がある場合は `questionCache.where({category, subcategory, subtopic})` でフィルタ。

### 5.3 既存仕組みとの統合

| 仕組み | 動作 |
|--------|------|
| SM-2 間隔反復 | 誤答した問題は翌日キューに、連続正答で間隔延長 (既存 `cardStates`) |
| 3回目誤答 → AI類題 | Gemini が `error_type` 別に類題生成 (既存 `generateSimilar`) |
| 回答ログ送信 | `submitAnswer` で `student_logs` に記録 → 翌朝 `category_stats` 再生成 |
| オフライン演習 | `questionCache` から出題、`answerLog` ローカル蓄積、復帰時同期 |

### 5.4 演習終了後の動線

1. 結果サマリー画面 (既存)
2. 「マップに戻る」ボタンでツリーマップ画面へ
3. ローカルキャッシュを楽観的に更新 → 即時に色変化反映
4. 次回 refresh でサーバ同期

### 5.5 エッジケース

- 未着手リーフを `scope: 'unstudied'` で開始したのに該当問題が questionCache に無い → 「ダウンロード中…」表示
- 該当問題が0問 → 「現在この分野の問題はありません」トースト
- ネットワーク切断中の楽観更新 → `pendingSync: true` フラグ、復帰時に refresh

---

## 6. 未着手領域処理

### 6.1 学年範囲フィルタ

| 学生学年 | 出題対象 | 理由 |
|---------|---------|------|
| 1年生 | grade=1 のみ | まだ習っていない範囲は表示しない |
| 2年生 | grade=1 ∪ 2 | 既習範囲を累積 |
| 3年生 | grade=1 ∪ 2 ∪ 3 | 国試対策で全範囲 |

`category_stats` 側は学年を問わず全データ保持 (下級生時の履歴も保持)。

### 6.2 未着手抽出ロジック

```
1. questions シート全件 → (department, exam_year/grade帯, category, subcategory, subtopic) で集約
   → マスタリーフ集合 M = {(cat, sub, top, totalQuestions)}
   ※ exam_year/grade帯フィルタは curriculum.grades[≤現在学年].categories で絞る

2. category_stats シート → studentId フィルタ
   → 学習済みリーフ集合 L = {(cat, sub, top) → answered, correct}

3. M を基準に LEFT JOIN:
   - L にあれば: confidence=high(answered≥5) or low(1-4)、correctRate計算
   - L に無ければ: confidence=none, answered=0, correctRate=null
```

### 6.3 まとめセル化

| 条件 | 値 |
|------|-----|
| 同一親内の `confidence:none` リーフ数 | 3個以上 |
| 親階層レベル | 中分類または小分類 (大分類はまとめない) |
| まとめセル名 | `+未着手N件` |
| 集約セルの面積 | 内包リーフの面積合計 |
| 集約セルの色 | グレー (`#cbd5e1`) + うっすら縞模様 |
| タップ挙動 | 集約解除し個別リーフを展開 |

**閾値3個の根拠**:
- 1〜2個ならまとめずに個別表示しても画面に収まる
- 3個以上だと細かいセルが並んで視認性低下
- 学習が進むにつれ自然にまとめセルが減る → 進捗実感

### 6.4 グレー表示の濃度

| confidence | 色 | 不透明度 | 意味 |
|------------|----|---------|------|
| `high` | RdYlGn(rate/100) | 1.0 | 信頼できるデータ |
| `low` (1-4問) | 同上 | 0.5 | 暫定評価 |
| `none` (未着手) | `#cbd5e1` | 1.0 | 未学習 |
| `none` まとめセル | `#cbd5e1` + 縞 | 1.0 | 未着手が複数 |

### 6.5 学年進級時の挙動

- `profile.grade` 更新 (Settings から)
- 次回フェッチ時に新しい範囲で再構築
- 旧学年で解いた履歴は新範囲のセルに反映
- 「新範囲」が大量にグレーで現れる → 教育効果

### 6.6 教員 Looker との整合性

学生側ではグレー領域 (curriculum 結合) を導入するが、教員 Looker は当面そのまま。学生側の効果検証後に展開を別案件で検討。

---

## 7. データ更新・エラー処理・オフライン

### 7.1 更新タイミング

| トリガー | 更新内容 | 頻度 |
|----------|---------|------|
| 日次バッチ (毎朝04:00) | 既存 `runDashboardUpdate` に同梱 → `category_stats` 全体更新 | 1回/日 |
| 即時更新ボタン (⟳) | `refreshStudentTreemap` → 1学生分だけ student_logs から再集計 | オンデマンド |
| 演習終了直後 | ローカルキャッシュを楽観的更新 (色だけ即反映) | クイズセッション毎 |
| 画面 mount 時 | キャッシュ表示 → 24h経過なら裏で再フェッチ (stale-while-revalidate) | 初回マウント |

### 7.2 エラー処理マトリクス

| 障害 | 検知 | 動作 | UI |
|------|------|------|------|
| GAS 通信エラー (5xx・タイムアウト) | fetch reject | キャッシュ表示+トースト「最新データ取得失敗」 | キャッシュ無ければエラー画面+リトライ |
| GAS レート制限 (同時実行30超) | 429 / 文字列検出 | 指数バックオフ (1s→2s→4s、最大3回) | スピナー → 失敗で上記同様 |
| `category_stats` 不在 | `error: 'シート未生成'` | バッチ未稼働メッセージ | 「初回データ生成中・明朝以降」 |
| 学生に該当データなし (新規) | `data.tree.children = []` | 全範囲未着手のグレー画面を curriculum から生成 | 「まずは1問解いてみよう」CTA |
| `studentId` 不正 (40x) | `error: 'invalid studentId'` | プロファイル再生成へ誘導 | 設定画面リンク |
| IndexedDB 書込失敗 | Dexie 例外 | メモリ上のみ保持 | サイレント |
| 楽観更新後の整合性ズレ | サーバとローカル差分 | サーバ優先で上書き | 「データを最新化」トースト |

### 7.3 レート制限対策

- 同一 studentId の `refresh` を1分以内に重複発行させない (フロント側デバウンス)
- ⟳ ボタン押下後60秒間 disabled (既存 AiDashboard と同じ流儀)

### 7.4 オフライン挙動

| 状態 | ツリーマップ | 演習開始 | 同期 |
|------|-------------|---------|------|
| オンライン・キャッシュあり | キャッシュ表示 → 裏で更新 | 通常通り | 即送信 |
| オンライン・キャッシュなし | スピナー → サーバ取得 | サーバ取得後 | 通常通り |
| オフライン・キャッシュあり | キャッシュ表示+「最終更新」バッジ | 通常通り | 復帰時送信 |
| オフライン・キャッシュなし | エラーメッセージ+再読込 | 不可 | — |

### 7.5 楽観的更新の実装

```ts
function applyOptimisticUpdate(cache, sessionLogs) {
  for (const log of sessionLogs) {
    const leaf = findLeaf(cache.payload.tree, log.category, log.subcategory, log.subtopic);
    if (!leaf) continue;
    leaf.answered++;
    if (log.isCorrect) leaf.correct++;
    leaf.correctRate = Math.round((leaf.correct / leaf.answered) * 100);
    leaf.confidence = leaf.answered >= 5 ? 'high' : 'low';
  }
  cache.pendingSync = true;
  cache.lastQuizAt = Date.now();
  return cache;
}
```

→ 解いた問題のセル色が即変化 (緑寄り・黄色等)

---

## 8. テスト方針・段階開発

### 8.1 テスト方針

| レイヤ | 対象 | 種別 | ツール |
|--------|------|------|--------|
| GAS `getStudentTreemap` | 集計ロジック (LEFT JOIN・学年フィルタ・ネスト) | ユニット | clasp + GAS テスト関数 |
| GAS `refreshStudentTreemap` | 1学生分の再集計 | ユニット | 同上 |
| PWA `Treemap.tsx` | レイアウト計算・色補間・ラベル閾値 | ユニット | Vitest + jsdom |
| PWA `WeaknessTreemap.tsx` | フェッチ・キャッシュ・エラー・楽観更新 | ユニット | Vitest + MSW |
| ジェスチャ・ズーム | タップ→ズーム遷移、パンくず戻り、FAB連動 | コンポーネント | React Testing Library |
| 統合 | 演習→SM-2記録→マップ色変化 | E2E | Playwright |
| 性能 | 600名並行 refresh | 負荷 | k6 (ローカルのみ) |

### 8.2 重点ケース

- 新規ユーザー: `category_stats` ゼロ → curriculum 由来全グレー画面
- 楽観更新の整合性: 演習後ローカル更新 → サーバ refresh で乖離があればサーバ優先
- 進級時: `profile.grade` を 1→2 で新範囲がグレー出現
- 未着手まとめセル: 3個以上で集約、タップで展開
- レート制限: 60秒以内の連続 refresh で2回目 disabled
- オフライン: キャッシュから表示+「最終更新」バッジ

### 8.3 段階開発 (3フェーズ)

**Phase A — 基本ツリーマップ表示** (約2週間)
- GAS `getStudentTreemap` API 実装
- PWA `WeaknessTreemap.tsx` + `Treemap.tsx` (d3-hierarchy + interpolateRdYlGn)
- パンくず・色凡例・ヘッダー
- 既存 `WeaknessMap.tsx` 置き換え
- ✅ Done: Looker と同じ色感で全階層がネスト表示される

**Phase B — インタラクション** (約1週間)
- ジェスチャ (タップ→ズーム、ボトムシート、パンくず戻り)
- ChallengeFab + START_CATEGORY_QUIZ 連携
- 未着手まとめセル化
- ✅ Done: ツリーマップから演習開始でき、復習スケジュールに乗る

**Phase C — リアルタイム性・耐障害** (約1週間)
- ⟳ 即時更新ボタン
- 楽観的更新 (演習後即色変化)
- IndexedDB `treemapCache` + stale-while-revalidate
- オフライン挙動・エラー処理マトリクス
- ✅ Done: 演習結果が即反映、オフラインでも閲覧可能

### 8.4 スコープ外 (再掲)

- 教員 Looker のグレー領域追加 (Phase A 完了後の効果検証で別案件)
- ツリーマップ以外の可視化
- 学科横断比較
- 教員→学生プッシュ通知

---

## 9. 関連ファイル

### 9.1 新規作成

| パス | 種別 | 目的 |
|------|------|------|
| `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx` | TS | コンテナ |
| `pwa-frontend/src/components/dashboard/treemap/Treemap.tsx` | TS | 描画 |
| `pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx` | TS | パンくず |
| `pwa-frontend/src/components/dashboard/treemap/TreemapLegend.tsx` | TS | 色凡例 |
| `pwa-frontend/src/components/dashboard/treemap/ChallengeFab.tsx` | TS | FAB |
| `pwa-frontend/src/services/treemapApi.ts` | TS | GAS 通信ラッパー |
| `gas-backend/src/TreemapService.gs` | GAS | API 集約 |

### 9.2 既存改修

| パス | 改修内容 |
|------|---------|
| `pwa-frontend/src/components/dashboard/WeaknessMap.tsx` | 削除 |
| `pwa-frontend/src/App.tsx` | ナビ「📊 弱点」を `WeaknessTreemap` へルーティング差替 |
| `pwa-frontend/src/services/db.ts` | `treemapCache` テーブル追加 |
| `pwa-frontend/src/context/AppContext.tsx` | `START_CATEGORY_QUIZ` ペイロード拡張 (`subtopic`, `scope`) |
| `pwa-frontend/src/components/quiz/*` | subtopic + scope に応じた出題ロジック |
| `gas-backend/src/Code.gs` | `getStudentTreemap` / `refreshStudentTreemap` ルーティング追加 |
| `gas-backend/src/DashboardService.gs` | `runDashboardUpdate` に treemap 用集計を含める (既存 `category_stats` 流用なので変更最小) |
