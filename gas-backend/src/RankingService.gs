/**
 * Memoria 同学年比較ランキングサービス
 *
 * 学生 PWA の弱点マップ画面に表示する「同学年内の自分の位置」を計算する。
 * ai_dashboard シートをデータソースとして on-demand 集計 (600名想定なので軽量)。
 *
 * プライバシー設計:
 * - cohort < 5 の場合は available: false (個人特定回避)
 * - 順位 (○位/N名) は返さない。パーセンタイルと段階表現のみ
 * - 段階: top (上位20%), upper (21-40%), middle (41-60%), developing (61-100%)
 *
 * 比較指標 (総合学習スコア):
 *   score = correctRate × 0.5
 *         + (totalQuestions / cohort内最大値 × 100) × 0.3
 *         + (streakDays / cohort内最大値 × 100) × 0.2
 *
 * 正答率だけでは「少ない解答数で高正答率」が有利に、解答数だけでは「下手でも量で勝てる」になる。
 * 教育的に望ましい3指標バランスで合成スコアを算出する。
 */

const RankingService = {
  /**
   * 学生の同学年内 percentile を返す
   * @param {string} studentId
   * @return {Object} {cohortName, cohortSize, myPercentile, rankBand, available}
   */
  getMyRanking: function(studentId) {
    if (!studentId) return { error: 'studentId is required' };

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    if (!sheet) return { error: 'ダッシュボードが未生成です' };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { error: 'データなし' };

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    if (idx['student_id'] === undefined || idx['department'] === undefined || idx['grade'] === undefined) {
      return { error: 'ai_dashboard ヘッダー不正' };
    }

    // 自分の行を見つける
    var myRow = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx['student_id']] === studentId) {
        myRow = data[i];
        break;
      }
    }
    if (!myRow) return { error: '対象学生のデータが見つかりません' };

    var myDept = myRow[idx['department']];
    var myGrade = Number(myRow[idx['grade']]);
    if (!myDept || !myGrade) return { error: '学科・学年が不明な学生です' };

    // 同 dept × grade のコホート抽出
    var cohort = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx['department']] !== myDept) continue;
      if (Number(row[idx['grade']]) !== myGrade) continue;

      var totalQuestions = Number(row[idx['total_questions']]) || 0;
      // 5問未満は分析対象外 (analyze 側のしきい値と整合)
      if (totalQuestions < 5) continue;

      cohort.push({
        studentId: row[idx['student_id']],
        totalQuestions: totalQuestions,
        correctRate: Number(row[idx['correct_rate']]) || 0,
        streakDays: Number(row[idx['streak_days']]) || 0
      });
    }

    var cohortName = getDepartmentLabel_(myDept) + ' ' + myGrade + '年';

    if (cohort.length < 5) {
      return {
        cohortName: cohortName,
        cohortSize: cohort.length,
        available: false
      };
    }

    // 正規化用最大値
    var maxQuestions = 0;
    var maxStreak = 0;
    for (var c = 0; c < cohort.length; c++) {
      if (cohort[c].totalQuestions > maxQuestions) maxQuestions = cohort[c].totalQuestions;
      if (cohort[c].streakDays > maxStreak) maxStreak = cohort[c].streakDays;
    }
    if (maxQuestions === 0) maxQuestions = 1;
    if (maxStreak === 0) maxStreak = 1;

    // 総合スコア
    for (var c = 0; c < cohort.length; c++) {
      var s = cohort[c];
      s.score = s.correctRate * 0.5
              + (s.totalQuestions / maxQuestions * 100) * 0.3
              + (s.streakDays / maxStreak * 100) * 0.2;
    }

    // 降順ソート (スコア高い順 = 上位)
    cohort.sort(function(a, b) { return b.score - a.score; });

    // 自分の順位 (1始まり)
    var myRank = -1;
    for (var i = 0; i < cohort.length; i++) {
      if (cohort[i].studentId === studentId) {
        myRank = i + 1;
        break;
      }
    }
    if (myRank === -1) {
      // 自分が cohort に含まれない (totalQuestions < 5 でフィルタアウト等)
      return {
        cohortName: cohortName,
        cohortSize: cohort.length,
        available: false
      };
    }

    // パーセンタイル (1〜100、低いほど上位)
    var percentile = Math.max(1, Math.round(myRank / cohort.length * 100));

    // 段階表現
    var rankBand;
    if (percentile <= 20) rankBand = 'top';
    else if (percentile <= 40) rankBand = 'upper';
    else if (percentile <= 60) rankBand = 'middle';
    else rankBand = 'developing';

    return {
      cohortName: cohortName,
      cohortSize: cohort.length,
      myPercentile: percentile,
      rankBand: rankBand,
      available: true
    };
  }
};
