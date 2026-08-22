/**
 * Memoria AI分析ダッシュボードサービス
 *
 * 日次バッチで全学生の学習データを集計・分析し、
 * ai_dashboardシートに保存する。
 * Gemini APIで個別アドバイスコメントも生成する。
 *
 * 最適化: 差分更新 + AIコメントキャッシュで高速化
 */

const DashboardService = {
  /**
   * 全学生のダッシュボードを更新（差分最適化版）
   */
  updateAll() {
    const ss = getSpreadsheet();

    // student_logsの全データを収集（アーカイブ含む）
    const allLogs = this.collectAllLogs(ss);

    // 学生ごとにグループ化
    const studentGroups = this.groupByStudent(allLogs);

    // questionsシートからカテゴリ情報取得
    const categoryMap = this.getCategoryMap(ss);

    // 学生名簿を1回だけ読み、氏名マップとゼロログ疑似行の両方で共有する
    // （roster が null なら名簿の取得に失敗している。氏名は空のまま続行し、疑似行は作らない）
    var roster = this.getStudentRoster_();
    var nameMap = buildNameMapFromRoster_(roster || []);

    // 教員向けコメント生成用に curriculum と questions マスタを事前構築
    // 同じデータを下の updateCategoryStats でも使うため、先に作って共有する
    var qMasterByDept = this.buildQuestionMasterByDepartment(ss);
    var curriculumByDept = CurriculumService.loadAll(ss);

    // ai_dashboardシート取得or作成（teacher_comment 列を末尾追加）
    let dashboard = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    const dashHeaders = [
      'student_id', 'student_number', 'student_name', 'department', 'grade',
      'total_questions', 'correct_rate', 'streak_days',
      'weak_categories', 'strong_categories', 'weekly_trend',
      'error_patterns', 'ai_comment', 'last_study_date', 'updated_at',
      'teacher_comment'
    ];
    if (!dashboard) {
      dashboard = ss.insertSheet(CONFIG.SHEETS.AI_DASHBOARD);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setValues([dashHeaders]);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setFontWeight('bold');
    }

    // 既存データを取得（マイグレーション判定＋差分チェック用）
    // ヘッダーが旧スキーマでも AI コメント / teacher_comment は再利用できるよう、先に収集してから再構築する
    const oldData = dashboard.getDataRange().getValues();
    const oldHeaders = oldData[0] || [];
    const oldStudentIdIdx = oldHeaders.indexOf('student_id');
    const oldTotalIdx = oldHeaders.indexOf('total_questions');
    const oldAiCommentIdx = oldHeaders.indexOf('ai_comment');
    const oldTeacherCommentIdx = oldHeaders.indexOf('teacher_comment');

    const existingMap = {};
    if (oldStudentIdIdx !== -1) {
      for (var r = 1; r < oldData.length; r++) {
        var sid = oldData[r][oldStudentIdIdx];
        if (!sid) continue;
        existingMap[sid] = {
          rowNum: r + 1,
          totalQuestions: oldTotalIdx !== -1 ? oldData[r][oldTotalIdx] : 0,
          aiComment: oldAiCommentIdx !== -1 ? oldData[r][oldAiCommentIdx] : '',
          teacherComment: oldTeacherCommentIdx !== -1 ? oldData[r][oldTeacherCommentIdx] : ''
        };
      }
    }

    // スキーマ不一致ならヘッダー書き換え（行番号は無効化して appendRow に回す）
    var needsMigration = false;
    for (var h = 0; h < dashHeaders.length; h++) {
      if (oldHeaders[h] !== dashHeaders[h]) { needsMigration = true; break; }
    }
    if (needsMigration) {
      dashboard.clear();
      dashboard.getRange(1, 1, 1, dashHeaders.length).setValues([dashHeaders]);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setFontWeight('bold');
      for (var sidKey in existingMap) {
        existingMap[sidKey].rowNum = null;
      }
    }

    const studentIds = Object.keys(studentGroups);
    let updatedCount = 0;
    let studentAiSkipped = 0;
    let teacherAiSkipped = 0;
    let teacherAiGenerated = 0;

    for (var s = 0; s < studentIds.length; s++) {
      var studentId = studentIds[s];
      var logs = studentGroups[studentId];
      var analysis = this.analyzeStudent(logs, categoryMap);

      // 差分チェック: 回答数が変わっていなければAI呼び出しをスキップ
      var existing = existingMap[studentId];
      var aiComment = '';
      var teacherComment = '';
      var dataUnchanged = existing && existing.totalQuestions === analysis.totalQuestions;

      // 学生向けAIコメント
      if (dataUnchanged && existing.aiComment) {
        aiComment = existing.aiComment;
        studentAiSkipped++;
      } else {
        try {
          aiComment = this.generateAiComment(analysis);
        } catch (e) {
          aiComment = '分析コメント生成中にエラーが発生しました';
          Logger.log('Gemini AI comment error for ' + studentId + ': ' + e);
        }
        Utilities.sleep(1000); // レート制限対策
      }

      // 教員向けAIコメント (Phase D-2a: 日次バッチで自動生成、Looker ダッシュボードに即反映)
      if (dataUnchanged && existing.teacherComment) {
        teacherComment = existing.teacherComment;
        teacherAiSkipped++;
      } else {
        // 未着手率と出題比重ベースの優先度を in-memory で計算
        var us = this.buildUnstudiedStats(
          logs, categoryMap, qMasterByDept, curriculumByDept,
          analysis.department, analysis.grade
        );
        analysis.totalLeaves = us.totalLeaves;
        analysis.touchedLeaves = us.touchedLeaves;
        analysis.unstudiedRate = us.unstudiedRate;

        var cp = this.buildCategoryPriorities(
          logs, categoryMap, qMasterByDept, curriculumByDept,
          analysis.department, analysis.grade
        );
        analysis.totalExamQuestions = cp.totalExamQuestions;
        analysis.categoryPriorities = cp.priorities;

        try {
          teacherComment = this.generateTeacherComment(analysis);
          teacherAiGenerated++;
        } catch (e) {
          teacherComment = '教員コメント生成中にエラーが発生しました';
          Logger.log('Gemini teacher comment error for ' + studentId + ': ' + e);
        }
        Utilities.sleep(1000); // レート制限対策
      }

      var studentName = nameMap[analysis.studentNumber] || '';
      var row = [
        studentId,
        analysis.studentNumber,
        studentName,
        analysis.department,
        analysis.grade,
        analysis.totalQuestions,
        analysis.correctRate,
        analysis.streakDays,
        JSON.stringify(analysis.weakCategories),
        JSON.stringify(analysis.strongCategories),
        JSON.stringify(analysis.weeklyTrend),
        JSON.stringify(analysis.errorPatterns),
        aiComment,
        analysis.lastStudyDate,
        new Date().toISOString(),
        teacherComment
      ];

      if (existing && existing.rowNum) {
        dashboard.getRange(existing.rowNum, 1, 1, dashHeaders.length).setValues([row]);
      } else {
        dashboard.appendRow(row);
      }

      updatedCount++;
    }

    Logger.log('ダッシュボード更新完了: ' + updatedCount + '名'
      + '（学生AI: 生成 ' + (updatedCount - studentAiSkipped) + '名 / 再利用 ' + studentAiSkipped + '名'
      + '、教員AI: 生成 ' + teacherAiGenerated + '名 / 再利用 ' + teacherAiSkipped + '名）');

    // category_statsシートを更新（ツリーマップ用）
    // 注: category_stats には疑似行を書かない。学生×カテゴリ×サブカテゴリ×サブトピックの
    //     リーフ単位なのでゼロログ学生1名で数百行になり、「未着手」という1つの事実の
    //     言い換えが増えるだけになるため（設計判断1）
    this.updateCategoryStats(ss, allLogs, categoryMap);

    // ゼロログ学生の疑似行を作り直す。
    // 必ずこの位置（通常ループと updateCategoryStats の完了後）で呼ぶこと。
    // 行削除で行番号がずれ、上の existingMap[].rowNum が無効になるため。
    var zeroLog = { deleted: 0, added: 0, aborted: '', error: '' };
    try {
      this.rebuildZeroLogRows_(dashboard, allLogs, dashHeaders.length, roster, zeroLog);
    } catch (e) {
      // 疑似行の失敗で日次バッチ全体を落とさない（通常学生の更新はすでに完了している）。
      // zeroLog は参照渡しなので、途中まで進んだ実績（削除件数）はここでも読める。
      zeroLog.error = String(e);
      Logger.log('ゼロログ疑似行の更新に失敗: ' + (e && e.stack ? e.stack : e)
        + '（この時点の実績: 削除 ' + zeroLog.deleted + '行 / 追加 ' + zeroLog.added + '行）');
    }

    return {
      updated: updatedCount,
      studentAiSkipped: studentAiSkipped,
      teacherAiSkipped: teacherAiSkipped,
      teacherAiGenerated: teacherAiGenerated,
      zeroLogAdded: zeroLog.added,
      zeroLogDeleted: zeroLog.deleted,
      zeroLogAborted: zeroLog.aborted,
      zeroLogError: zeroLog.error
    };
  },

  /**
   * 分野別統計シートを更新（ツリーマップ・Looker Studio用）
   * student × category × subcategory × subtopic の粒度で集計
   *
   * Spec §6.6 (Phase D): 学生PWAと同じく未着手領域(curriculum × questions)も
   * 行として書き出す。 confidence='none', total_count=0, total_questions_master>0
   * となる行が「グレー領域」を表す。教員 Looker 側はこの新カラムでフィルタ可能。
   */
  updateCategoryStats(ss, allLogs, categoryMap) {
    var sheetName = CONFIG.SHEETS.CATEGORY_STATS;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    } else {
      sheet.clear();
    }

    // 学生名簿から学籍番号→氏名のマップを作成
    var nameMap = this.getStudentNameMap();

    // ヘッダー (新スキーマ: confidence, total_questions_master を末尾追加)
    // 既存 Looker レポートが先頭12列を参照していれば追加だけで影響なし
    var headers = [
      'student_id', 'student_number', 'student_name', 'department', 'grade',
      'category', 'subcategory', 'subtopic',
      'total_count', 'correct_count', 'accuracy_rate', 'last_study_date',
      'confidence', 'total_questions_master'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // 学生ごとにグループ化
    var studentGroups = this.groupByStudent(allLogs);

    // questions シート全体を学科別マスタに集約 (1回構築して全学生で共有)
    var qMasterByDept = this.buildQuestionMasterByDepartment(ss);

    // curriculum シートを読み込み (累積カテゴリ計算用)
    var curriculumByDept = CurriculumService.loadAll(ss);

    var rows = [];
    var unstudiedCount = 0;
    var studiedCount = 0;

    for (var studentId in studentGroups) {
      var logs = studentGroups[studentId];
      var latest = logs[logs.length - 1] || {};
      var studentNumber = latest.studentNumber || '';
      // student_nameが空の場合は student_number → student_id の順でフォールバック
      // Looker Studioのフィルターコントロールで空値が混入しないようにするため
      var studentName = nameMap[studentNumber] || studentNumber || studentId;
      var department = latest.department || '';
      var grade = Number(latest.grade) || 0;

      // 学生の学習統計を構築
      var studied = {};
      for (var i = 0; i < logs.length; i++) {
        var log = logs[i];
        var info = categoryMap[log.questionId];
        if (!info) continue;

        var cat = info.category || '未分類';
        var sub = info.subcategory || '未分類';
        var topic = info.subtopic || '未分類';
        var key = cat + '|||' + sub + '|||' + topic;

        if (!studied[key]) {
          studied[key] = { correct: 0, total: 0, cat: cat, sub: sub, topic: topic, lastDate: '' };
        }
        studied[key].total++;
        if (log.isCorrect) studied[key].correct++;
        if (log.timestamp) {
          var dateStr = String(log.timestamp).split('T')[0];
          if (dateStr > studied[key].lastDate) studied[key].lastDate = dateStr;
        }
      }

      // 学生の curriculum 累積範囲とマスタリーフを取得
      var allowedCategories = CurriculumService.accumulate(curriculumByDept, department, grade);
      var allowedSet = {};
      allowedCategories.forEach(function(c) { allowedSet[c] = true; });
      var deptMaster = qMasterByDept[department] || {};

      // LEFT JOIN: 学生のマスタリーフ全件を出力 (未着手は total=0, confidence='none')
      var emittedKeys = {};
      for (var key in deptMaster) {
        var m = deptMaster[key];
        if (!allowedSet[m.cat]) continue;
        var s = studied[key];
        var total = s ? s.total : 0;
        var correct = s ? s.correct : 0;
        var lastDate = s ? s.lastDate : '';
        // accuracy_rate は未着手では空値 (Looker で null として扱える)
        var rate = total > 0 ? Math.round((correct / total) * 100) : '';
        var confidence = total >= 5 ? 'high' : total >= 1 ? 'low' : 'none';
        if (confidence === 'none') unstudiedCount++; else studiedCount++;
        rows.push([
          studentId, studentNumber, studentName, department, grade,
          m.cat, m.sub, m.top,
          total, correct, rate, lastDate,
          confidence, m.totalQuestions
        ]);
        emittedKeys[key] = true;
      }

      // 学年範囲外で解答した履歴 (旧学年問題等) も保持: studied のうち未出力のものを追加
      // total_questions_master は不明なので 0、curriculum 外として識別可能
      for (var sKey in studied) {
        if (emittedKeys[sKey]) continue;
        var st = studied[sKey];
        var sRate = st.total > 0 ? Math.round((st.correct / st.total) * 100) : '';
        var sConf = st.total >= 5 ? 'high' : st.total >= 1 ? 'low' : 'none';
        if (sConf === 'none') unstudiedCount++; else studiedCount++;
        rows.push([
          studentId, studentNumber, studentName, department, grade,
          st.cat, st.sub, st.topic,
          st.total, st.correct, sRate, st.lastDate,
          sConf, 0
        ]);
      }
    }

    // 一括書き込み (大量行は chunk 分割: setValues は 1 セル 50KB 上限・通信タイムアウト対策)
    if (rows.length > 0) {
      var CHUNK = 5000;
      for (var offset = 0; offset < rows.length; offset += CHUNK) {
        var chunk = rows.slice(offset, offset + CHUNK);
        sheet.getRange(2 + offset, 1, chunk.length, headers.length).setValues(chunk);
      }
    }

    Logger.log('category_stats更新: ' + rows.length + '行 (学習済=' + studiedCount + ', 未着手=' + unstudiedCount + ', 学生数=' + Object.keys(studentGroups).length + ')');
  },

  /**
   * 学生の curriculum 累積範囲を基準に未着手リーフ統計を計算する
   *
   * Phase D-2a: 教員向け AI コメントで「未着手率」を観察事実として渡すため。
   * 既に updateAll が構築している qMasterByDept と curriculumByDept を再利用するので
   * 追加 I/O は無し (in-memory 計算のみ)。
   *
   * @param {Array<Object>} logs - 学生の student_logs エントリ
   * @param {Object} categoryMap - questionId → {category, subcategory, subtopic}
   * @param {Object} qMasterByDept - buildQuestionMasterByDepartment の戻り値
   * @param {Object} curriculumByDept - CurriculumService.loadAll の戻り値
   * @param {string} department
   * @param {number} grade
   * @return {Object} {totalLeaves, touchedLeaves, unstudiedRate}
   */
  buildUnstudiedStats: function(logs, categoryMap, qMasterByDept, curriculumByDept, department, grade) {
    var allowedCategories = CurriculumService.accumulate(curriculumByDept, department, Number(grade) || 0);
    var allowedSet = {};
    allowedCategories.forEach(function(c) { allowedSet[c] = true; });

    // マスタリーフ総数 (curriculum 範囲内)
    var deptMaster = qMasterByDept[department] || {};
    var totalLeaves = 0;
    for (var key in deptMaster) {
      if (allowedSet[deptMaster[key].cat]) totalLeaves++;
    }

    // 着手済リーフ数 (logs から distinct (cat,sub,top) をカウント)
    var touched = {};
    for (var i = 0; i < logs.length; i++) {
      var info = categoryMap[logs[i].questionId];
      if (!info) continue;
      var cat = info.category || '未分類';
      if (!allowedSet[cat]) continue;
      var sub = info.subcategory || '未分類';
      var top = info.subtopic || '未分類';
      touched[cat + '|||' + sub + '|||' + top] = true;
    }
    var touchedCount = Object.keys(touched).length;

    return {
      totalLeaves: totalLeaves,
      touchedLeaves: touchedCount,
      unstudiedRate: totalLeaves > 0 ? Math.round((1 - touchedCount / totalLeaves) * 100) : 0
    };
  },

  /**
   * 教員コメント用: 学生の category 別「着手優先度」を計算する
   *
   * 優先度 = 出題比重(%) × 不足度(1 - 正答率)
   *   - 出題比重: 学科マスタにおけるカテゴリの問題数比率 (≒ 国試での配点比重)
   *   - 不足度: 未着手 = 1.0 (最高), 着手済 = (1 - 正答率/100)
   *
   * @return {Object} {totalExamQuestions, priorities[{category, examWeightPct, examQuestions,
   *                   studentAttempts, currentRate, unstudied, priorityScore}]}
   */
  buildCategoryPriorities: function(logs, categoryMap, qMasterByDept, curriculumByDept, department, grade) {
    var allowedCategories = CurriculumService.accumulate(curriculumByDept, department, Number(grade) || 0);
    var allowedSet = {};
    allowedCategories.forEach(function(c) { allowedSet[c] = true; });

    // 1. 学科マスタからカテゴリ別の出題量を集計
    var deptMaster = qMasterByDept[department] || {};
    var weightByCat = {};
    var totalMaster = 0;
    for (var key in deptMaster) {
      var m = deptMaster[key];
      if (!allowedSet[m.cat]) continue;
      weightByCat[m.cat] = (weightByCat[m.cat] || 0) + m.totalQuestions;
      totalMaster += m.totalQuestions;
    }

    // 2. 学生のカテゴリ別正答率
    var studentByCat = {};
    for (var i = 0; i < logs.length; i++) {
      var info = categoryMap[logs[i].questionId];
      if (!info || !info.category) continue;
      var cat = info.category;
      if (!allowedSet[cat]) continue;
      if (!studentByCat[cat]) studentByCat[cat] = { total: 0, correct: 0 };
      studentByCat[cat].total++;
      if (logs[i].isCorrect) studentByCat[cat].correct++;
    }

    // 3. 優先度計算 (出題比重 × 不足度)
    var priorities = [];
    for (var cat in weightByCat) {
      var w = weightByCat[cat];
      var weightPct = totalMaster > 0 ? Math.round(w / totalMaster * 100) : 0;
      var s = studentByCat[cat] || { total: 0, correct: 0 };
      var rate = s.total > 0 ? Math.round(s.correct / s.total * 100) : null;
      var unstudied = s.total === 0;
      var gapFactor = rate === null ? 1.0 : Math.max(0, (100 - rate) / 100);
      var priorityScore = Math.round(weightPct * gapFactor * 10) / 10;
      priorities.push({
        category: cat,
        examQuestions: w,
        examWeightPct: weightPct,
        studentAttempts: s.total,
        studentCorrect: s.correct,
        currentRate: rate,
        unstudied: unstudied,
        priorityScore: priorityScore
      });
    }
    priorities.sort(function(a, b) { return b.priorityScore - a.priorityScore; });

    return {
      totalExamQuestions: totalMaster,
      priorities: priorities
    };
  },

  /**
   * questions シートから学科別の (cat, sub, top) → totalQuestions マスタを構築
   *
   * @param {Spreadsheet} ss
   * @return {Object} {[department]: {[key]: {cat, sub, top, totalQuestions}}}
   */
  buildQuestionMasterByDepartment: function(ss) {
    var sheet = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var byDept = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var dept = row[idx['department']];
      if (!dept) continue;
      var cat = row[idx['category']] || '';
      if (!cat) continue;
      var sub = row[idx['subcategory']] || '未分類';
      var top = row[idx['subtopic']] || '未分類';
      var key = cat + '|||' + sub + '|||' + top;
      if (!byDept[dept]) byDept[dept] = {};
      if (!byDept[dept][key]) {
        byDept[dept][key] = { cat: cat, sub: sub, top: top, totalQuestions: 0 };
      }
      byDept[dept][key].totalQuestions++;
    }
    return byDept;
  },

  /**
   * 名簿の students シートを取得する。
   * ScriptProperty STUDENT_LIST_ID があれば外部スプレッドシート、無ければコンテナ内を見る。
   * 見つからなければ null を返す。
   */
  getRosterSheet_() {
    var nameSheetId = PropertiesService.getScriptProperties().getProperty('STUDENT_LIST_ID');
    if (!nameSheetId) {
      return getSpreadsheet().getSheetByName('students');
    }
    return SpreadsheetApp.openById(nameSheetId).getSheetByName('students');
  },

  /**
   * 学生名簿をレコード配列で取得する。
   * 形: [{ studentNumber, studentNumberRaw, studentName, department, grade, reportGroup }, ...]
   *
   * 取得に失敗した場合・シートが見つからない場合は null を返す（例外は投げない）。
   * 「取得できなかった」と「本当に0件」を区別できないと、名簿の一時障害のときに
   * 疑似行を全部消してしまうため、[] とは別の値にすること。
   */
  getStudentRoster_() {
    try {
      var sheet = this.getRosterSheet_();
      if (!sheet) {
        Logger.log('学生名簿: students シートが見つかりません');
        return null;
      }
      var values = sheet.getDataRange().getValues();
      var records = parseRosterValues_(values);
      var skipped = Math.max(0, values.length - 1 - records.length);
      if (skipped > 0) {
        Logger.log('学生名簿: 学籍番号が空の行を ' + skipped + '件スキップしました');
      }
      return records;
    } catch (e) {
      Logger.log('学生名簿取得エラー: ' + (e && e.stack ? e.stack : e));
      return null;
    }
  },

  /**
   * ゼロログ学生の疑似行を毎回ゼロから作り直す。
   *
   * 処理順（厳守）:
   *   0. 通常の学生ループと updateCategoryStats が完了した後に呼ぶこと
   *      （下の削除が行番号をずらすため、updateAll 冒頭の existingMap[].rowNum が無効になる）
   *   1. 名簿から対象を確定する。名簿が取れない/0件なら1行も壊さずに中止する
   *      （削除を先にすると、名簿の一時障害の日だけ既卒生が全員消える＝直そうとしている症状に戻る）
   *   2. シートを読み直す（updateAll 冒頭の oldData は使わない）
   *   3. 疑似行を降順・連続区間まとめで削除する
   *   4. グリッド行数を確保してから一括追記する
   *
   * 「有ログ化したら消す」条件方式にしないのは、削除条件が発火しないケースで
   * ゴースト行が永久に残るため。毎回作り直せば判定結果が変わった瞬間に自動追随する
   * （ただし追随の粒度は日次。日中の遷移は refreshStudent 側で吸収する）。
   *
   * Gemini API は呼ばない（観察できる事実が無いため。設計判断5）。
   *
   * @param {Sheet} dashboard ai_dashboard シート
   * @param {Array<Object>} allLogs collectAllLogs() の結果
   * @param {number} columnCount ヘッダー列数（16）
   * @param {Array<Object>|null} roster getStudentRoster_() の結果（null は取得失敗）
   * @param {Object} result 進捗を書き込む集計オブジェクト（部分失敗時も呼び出し側が実績を読めるようにする）
   * @return {Object} result と同じ参照
   */
  rebuildZeroLogRows_(dashboard, allLogs, columnCount, roster, result) {
    result.deleted = 0;
    result.added = 0;
    result.aborted = '';

    // --- 1. 材料をそろえる（破壊的操作より前に必ず行う） ---
    if (roster === null || roster === undefined) {
      result.aborted = 'roster_unavailable';
      Logger.log('ゼロログ疑似行: 名簿を取得できないため中止（既存の疑似行はそのまま保持）');
      return result;
    }
    if (!roster.length) {
      result.aborted = 'roster_empty';
      Logger.log('ゼロログ疑似行: 名簿0件のため中止（既存の疑似行はそのまま保持）');
      return result;
    }

    var numbersWithLogs = buildStudentNumbersWithLogs_(allLogs);
    var selection = selectZeroLogRosterRecords_(roster, numbersWithLogs);
    var targets = selection.records;

    var emptyDept = 0;
    for (var e = 0; e < targets.length; e++) {
      if (!targets[e].department) emptyDept++;
    }

    Logger.log('ゼロログ疑似行: 名簿 ' + roster.length + '件'
      + ' / コホート対象 ' + selection.groupRows + '件'
      + ' / ログ有りで除外 ' + selection.withLogsExcluded + '件'
      + ' / 学籍番号重複で除外 ' + selection.duplicateNumbers.length + '件'
      + ' / report_groupがboolean ' + selection.booleanGroupRows + '件'
      + ' / 疑似行の対象 ' + targets.length + '件'
      + '（うち学科が空 ' + emptyDept + '件）');

    if (targets.length > ZEROLOG_MAX_ROWS) {
      result.aborted = 'too_many';
      Logger.log('ゼロログ疑似行: 対象 ' + targets.length + '件が上限 ' + ZEROLOG_MAX_ROWS
        + ' 件を超過したため中止（既存の疑似行はそのまま保持）。'
        + 'report_group 列の運用が変わっていないか確認すること');
      return result;
    }

    var updatedAt = new Date().toISOString();
    var rows = [];
    for (var t = 0; t < targets.length; t++) {
      rows.push(buildZeroLogDashboardRow_(targets[t], updatedAt));
    }

    // --- 2. シートを読み直す ---
    var values = dashboard.getDataRange().getValues();
    var blocks = groupContiguousDesc_(findZeroLogRowNumbersDesc_(values));

    // --- 3. 既存の疑似行を削除（開始行の降順なので行番号がずれない） ---
    for (var b = 0; b < blocks.length; b++) {
      dashboard.deleteRows(blocks[b].start, blocks[b].count);
      result.deleted += blocks[b].count;
    }

    // --- 4. 一括追記（deleteRows でグリッド行数が減っているので不足分を先に足す） ---
    if (rows.length) {
      var startRow = dashboard.getLastRow() + 1;
      var needRows = startRow + rows.length - 1;
      var maxRows = dashboard.getMaxRows();
      if (needRows > maxRows) {
        dashboard.insertRowsAfter(maxRows, needRows - maxRows);
      }
      dashboard.getRange(startRow, 1, rows.length, columnCount).setValues(rows);
      result.added = rows.length;
    }

    Logger.log('ゼロログ疑似行: 削除 ' + result.deleted + '行 / 追加 ' + result.added + '行');
    return result;
  },

  /**
   * 学生名簿スプレッドシートから学籍番号→氏名のマップを取得
   * （getStudentRoster_ に委譲。戻り値の形と「例外を投げない」挙動は従来どおり。
   *   キーは生値＋trim 済みの両方が登録されるので、従来一致していた参照は必ず維持される）
   */
  getStudentNameMap() {
    return buildNameMapFromRoster_(this.getStudentRoster_() || []);
  },

  /**
   * 全student_logsデータを収集（アーカイブシート含む）
   */
  collectAllLogs(ss) {
    var allLogs = [];
    var sheets = ss.getSheets();

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var name = sheet.getName();
      if (name === CONFIG.SHEETS.STUDENT_LOGS || name.indexOf(CONFIG.SHEETS.STUDENT_LOGS + '_') === 0) {
        var data = sheet.getDataRange().getValues();
        if (data.length <= 1) continue;

        var headers = data[0];
        var idx = {};
        headers.forEach(function(h, i) { idx[h] = i; });

        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          allLogs.push({
            studentId: row[idx['student_id']] || '',
            studentNumber: row[idx['student_number']] || '',
            department: row[idx['department']] || '',
            grade: row[idx['grade']] || '',
            questionId: row[idx['question_id']] || '',
            selectedAnswer: row[idx['selected_answer']] || '',
            isCorrect: row[idx['is_correct']] === true || row[idx['is_correct']] === 'TRUE',
            responseTimeMs: Number(row[idx['response_time_ms']]) || 0,
            timestamp: row[idx['timestamp']] || '',
          });
        }
      }
    }

    return allLogs;
  },

  /**
   * 学生ごとにグループ化
   */
  groupByStudent(logs) {
    var groups = {};
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      if (!log.studentId) continue;
      if (!groups[log.studentId]) groups[log.studentId] = [];
      groups[log.studentId].push(log);
    }
    return groups;
  },

  /**
   * questionsシートからカテゴリマップを取得
   */
  getCategoryMap(ss) {
    var sheet = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var map = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      map[row[idx['question_id']]] = {
        category: row[idx['category']] || '',
        subcategory: row[idx['subcategory']] || '',
        subtopic: row[idx['subtopic']] || '',
      };
    }
    return map;
  },

  /**
   * 学生の学習データを分析
   */
  analyzeStudent(logs, categoryMap) {
    var latest = logs[logs.length - 1] || {};

    // 基本統計
    var totalQuestions = logs.length;
    var correctCount = 0;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].isCorrect) correctCount++;
    }
    var correctRate = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    // 連続学習日数の計算 & 最終学習日の特定
    var dateSet = {};
    var lastStudyDate = '';
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].timestamp) {
        var d = new Date(logs[i].timestamp).toISOString().split('T')[0];
        dateSet[d] = true;
        if (d > lastStudyDate) lastStudyDate = d;
      }
    }
    var dates = Object.keys(dateSet).sort().reverse();

    var streakDays = 0;
    var today = new Date();
    var checkDate = today.toISOString().split('T')[0];
    for (var d = 0; d < dates.length; d++) {
      if (dates[d] === checkDate) {
        streakDays++;
        var prev = new Date(checkDate);
        prev.setDate(prev.getDate() - 1);
        checkDate = prev.toISOString().split('T')[0];
      } else if (dates[d] < checkDate) {
        break;
      }
    }

    // 分野別統計（カテゴリ + サブカテゴリの2階層）
    var catStats = {};
    for (var i = 0; i < logs.length; i++) {
      var log = logs[i];
      var info = categoryMap[log.questionId];
      if (!info) continue;

      var key = info.category;
      var subKey = info.category + ' > ' + (info.subcategory || '未分類');

      if (!catStats[key]) catStats[key] = { correct: 0, total: 0, subs: {} };
      catStats[key].total++;
      if (log.isCorrect) catStats[key].correct++;

      if (!catStats[key].subs[subKey]) catStats[key].subs[subKey] = { correct: 0, total: 0 };
      catStats[key].subs[subKey].total++;
      if (log.isCorrect) catStats[key].subs[subKey].correct++;
    }

    // 苦手分野・得意分野を分類
    var weakCategories = [];
    var strongCategories = [];
    var catKeys = Object.keys(catStats);
    for (var c = 0; c < catKeys.length; c++) {
      var cat = catKeys[c];
      var stats = catStats[cat];
      var rate = Math.round((stats.correct / stats.total) * 100);
      var entry = { category: cat, rate: rate, count: stats.total };

      var subs = [];
      var subKeys = Object.keys(stats.subs);
      for (var s = 0; s < subKeys.length; s++) {
        var subStats = stats.subs[subKeys[s]];
        if (subStats.total >= 3) {
          subs.push({
            subcategory: subKeys[s],
            rate: Math.round((subStats.correct / subStats.total) * 100),
            count: subStats.total
          });
        }
      }
      subs.sort(function(a, b) { return a.rate - b.rate; });
      entry.subcategories = subs;

      if (stats.total >= 5) {
        if (rate < 65) weakCategories.push(entry);
        else if (rate >= 80) strongCategories.push(entry);
      }
    }
    weakCategories.sort(function(a, b) { return a.rate - b.rate; });
    strongCategories.sort(function(a, b) { return b.rate - a.rate; });

    // 週次推移（直近8週）
    var weeklyTrend = [];
    for (var w = 7; w >= 0; w--) {
      var weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() - w * 7);
      weekStart.setHours(0, 0, 0, 0);
      var weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      var weekStartStr = weekStart.toISOString().split('T')[0];
      var weekEndStr = weekEnd.toISOString().split('T')[0];

      var weekTotal = 0;
      var weekCorrect = 0;
      for (var i = 0; i < logs.length; i++) {
        var ts = logs[i].timestamp ? logs[i].timestamp.split('T')[0] : '';
        if (ts >= weekStartStr && ts < weekEndStr) {
          weekTotal++;
          if (logs[i].isCorrect) weekCorrect++;
        }
      }

      if (weekTotal > 0) {
        weeklyTrend.push({
          week: weekStartStr,
          rate: Math.round((weekCorrect / weekTotal) * 100),
          count: weekTotal
        });
      }
    }

    // 誤答パターン分析（応答時間ベース）
    var errorPatterns = [];
    var fastWrong = 0;
    var slowWrong = 0;
    for (var i = 0; i < logs.length; i++) {
      if (!logs[i].isCorrect) {
        if (logs[i].responseTimeMs < 5000) fastWrong++;
        if (logs[i].responseTimeMs > 30000) slowWrong++;
      }
    }
    if (fastWrong > 5) {
      errorPatterns.push({
        type: 'hasty',
        description: '5秒以内の即答で不正解が' + fastWrong + '回',
        count: fastWrong
      });
    }
    if (slowWrong > 5) {
      errorPatterns.push({
        type: 'overthinking',
        description: '30秒以上悩んで不正解が' + slowWrong + '回',
        count: slowWrong
      });
    }

    return {
      studentNumber: latest.studentNumber || '',
      department: latest.department || '',
      grade: latest.grade || '',
      totalQuestions: totalQuestions,
      correctRate: correctRate,
      streakDays: streakDays,
      weakCategories: weakCategories.slice(0, 5),
      strongCategories: strongCategories.slice(0, 3),
      weeklyTrend: weeklyTrend,
      errorPatterns: errorPatterns,
      lastStudyDate: lastStudyDate,
    };
  },

  /**
   * Gemini APIで個別アドバイスを生成（プレーンテキスト出力）
   */
  generateAiComment(analysis) {
    if (!CONFIG.GEMINI_API_KEY) return '（APIキー未設定）';
    if (analysis.totalQuestions < 5) return 'まだ回答数が少ないです。もう少し問題を解いてから分析しましょう。';

    var weakList = '';
    for (var i = 0; i < analysis.weakCategories.length; i++) {
      var c = analysis.weakCategories[i];
      weakList += '- ' + c.category + ': ' + c.rate + '%（' + c.count + '問）\n';
    }

    var strongList = '';
    for (var i = 0; i < analysis.strongCategories.length; i++) {
      var c = analysis.strongCategories[i];
      strongList += '- ' + c.category + ': ' + c.rate + '%\n';
    }

    var errorInfo = '';
    if (analysis.errorPatterns.length > 0) {
      errorInfo = '誤答傾向:\n';
      for (var i = 0; i < analysis.errorPatterns.length; i++) {
        errorInfo += '- ' + analysis.errorPatterns[i].description + '\n';
      }
    }

    // 注: 学年情報は問題選定の参考として渡すが、アドバイス本文には学年を含めない。
    // 上級生や卒業生が下級学年の範囲を復習するケースがあるため、学年を断定しないこと。
    var prompt = 'あなたは医療系専門学校の教育アドバイザーです。以下の学生 1 名の学習データを分析し、150字以内で具体的な学習アドバイスを日本語のプレーンテキストで書いてください。JSONではなく普通の文章で回答してください。\n\n' +
      '■ 文体ルール（厳守）\n' +
      '- 宛先は 1 名の個人です。「あなた」と呼びかけてください。\n' +
      '- 「皆さん」「みなさん」など複数人への呼びかけは禁止。\n' +
      '- 「○年生のあなたは」「○年生の皆さん」など学年を明示した呼びかけは禁止（同じ学生が別学年の問題を解くことがあるため）。\n' +
      '- 学年番号を本文中に書かないこと。代わりに弱点分野・誤答傾向・学習姿勢など、個別の観察事実に基づいて助言する。\n' +
      '- 前向きで具体的なアドバイスで締めくくる。\n\n' +
      '■ 学生データ（参考情報。本文に学年数字は書かない）\n' +
      '学科: ' + getDepartmentLabel_(analysis.department) + '\n' +
      '対象国家試験: ' + getDepartmentExpertName(analysis.department) + '\n' +
      '解いている問題の学年帯: ' + analysis.grade + '年向け\n' +
      '総回答数: ' + analysis.totalQuestions + '問\n' +
      '全体正答率: ' + analysis.correctRate + '%\n' +
      '連続学習: ' + analysis.streakDays + '日\n\n' +
      '苦手分野:\n' + (weakList || '（特になし）\n') + '\n' +
      '得意分野:\n' + (strongList || '（特になし）\n') + '\n' +
      errorInfo + '\n' +
      '上記ルールに従い、この学生本人への個別アドバイスを 150 字以内で書いてください。';

    var result = callGeminiAPI(prompt);
    if (result.error) {
      Logger.log('Gemini comment generation error: ' + result.error);
      return '分析データが不足しています。もう少し問題を解いてみましょう。';
    }

    return (result.text || '').trim() || '分析データが不足しています。もう少し問題を解いてみましょう。';
  },

  /**
   * Phase D-2a: 教員向け AI コメントを Gemini で生成
   *
   * 対象: 担任・教科担当教員。
   * 用途: 個別面談・補講設計・授業計画への反映。
   * クラス全体サマリは別案件 (本実装ではスコープ外)。
   *
   * 文体ルール (厳守):
   * - 教員視点 ("〇〇さんは" / "この学生は" / "本生徒は")
   * - 学生への呼びかけ語 (あなた/皆さん) は禁止
   * - 学年番号を本文に書かない
   * - 学生氏名は書かない (Looker フィルタで識別済み)
   * - 観察事実 → 仮説 → 具体アクション の流れ
   *
   * @param {Object} analysis - analyzeStudent の戻り値 + unstudiedRate 等
   * @return {string} 200字以内の教員向けコメント
   */
  generateTeacherComment: function(analysis) {
    if (!CONFIG.GEMINI_API_KEY) return '（APIキー未設定）';
    if (analysis.totalQuestions < 5) return '回答数が少なく傾向分析未実施。次回演習で着手領域を観察。';

    var weakList = '';
    for (var i = 0; i < analysis.weakCategories.length; i++) {
      var c = analysis.weakCategories[i];
      weakList += '- ' + c.category + ': ' + c.rate + '%（' + c.count + '問）\n';
    }

    var strongList = '';
    for (var i = 0; i < analysis.strongCategories.length; i++) {
      var c = analysis.strongCategories[i];
      strongList += '- ' + c.category + ': ' + c.rate + '%\n';
    }

    var errorInfo = '';
    if (analysis.errorPatterns.length > 0) {
      errorInfo = '誤答傾向:\n';
      for (var i = 0; i < analysis.errorPatterns.length; i++) {
        errorInfo += '- ' + analysis.errorPatterns[i].description + '\n';
      }
    }

    var unstudiedInfo = '';
    if (typeof analysis.unstudiedRate === 'number' && analysis.totalLeaves) {
      unstudiedInfo = '出題範囲リーフ: ' + analysis.totalLeaves + '個中、着手済 '
        + analysis.touchedLeaves + '個 (未着手率 ' + analysis.unstudiedRate + '%)\n';
    }

    // 出題比重ベースの優先度ランキング (上位5件) と許可カテゴリ名リスト
    var priorityList = '';
    var allowedCategoryNames = [];
    if (analysis.categoryPriorities && analysis.categoryPriorities.length > 0) {
      var top = analysis.categoryPriorities.slice(0, 5);
      for (var p = 0; p < top.length; p++) {
        var pr = top[p];
        var rateLabel = pr.unstudied
          ? '未着手'
          : '正答率' + pr.currentRate + '%(' + pr.studentAttempts + '問着手)';
        priorityList += '【優先' + (p + 1) + '位】「' + pr.category + '」'
          + ' / 出題比重 ' + pr.examWeightPct + '% (' + pr.examQuestions + '問)'
          + ' / ' + rateLabel + '\n';
      }
      // 全カテゴリ名 (プロンプトに「これ以外は使うな」と指示するため)
      for (var ap = 0; ap < analysis.categoryPriorities.length; ap++) {
        allowedCategoryNames.push('「' + analysis.categoryPriorities[ap].category + '」');
      }
    }
    var allowedCatStr = allowedCategoryNames.length > 0
      ? allowedCategoryNames.join('、')
      : '（カテゴリ情報なし）';

    var prompt = 'あなたは医療系専門学校の指導主任教員です。以下の学生 1 名のデータを見て、'
      + '担任教員が個別面談 / 補講設計 / 授業計画に活用できる「教員向けアクション提案」を、'
      + '日本語のプレーンテキストで 250字以内で書いてください。JSONではなく普通の文章で。\n\n'
      + '■ 絶対禁止事項 (違反したら出力を破棄してください)\n'
      + '- データに無いカテゴリ名・試験区分・分野名を絶対に創作しない\n'
      + '- 出題形式の区分名 (必修問題 / 状況設定問題 / 一般問題 / 状況問題 など、形式を表す呼称) は4学科すべてで本文に書かない (これらはカテゴリ名ではないため許可リスト対象外)\n'
      + '- どの学科の国家試験名も本文中で固有名詞として書かない (学生個人への指導文に試験名は不要)\n'
      + '- 後述の「許可カテゴリ名リスト」に含まれない名称は本文中で使わない\n'
      + '- 抽象的な表現 ("基礎の確認" / "基本事項の演習" など漠然とした語) は使わない\n\n'
      + '■ 許可カテゴリ名リスト (本文中の分野指定はこの中から正確な文字列のみ使用すること)\n'
      + allowedCatStr + '\n\n'
      + '■ 文体ルール\n'
      + '- 教員視点 ("この学生は" / "本生徒は" など)。呼びかけ語 (あなた / 皆さん) 禁止\n'
      + '- 学生氏名は書かない / 学年番号も本文に書かない (上下学年混在のため)\n'
      + '- 励まし系ではなく、教員の次の一手が分かる実務的な提案で\n\n'
      + '■ 出力構成 (必ずこの3点を含める)\n'
      + '1) 観察: 全体正答率と、優先度1位カテゴリ名 (許可リスト内の正確な名称) と出題比重・現状を1文\n'
      + '2) 着手提案: 「『〇〇』は出題比重〇%を占め現在〇〇のため、ここから着手」 形式で許可リスト内のカテゴリを名指し\n'
      + '3) 次の一手: 個別面談 / 補講 / 授業計画 のいずれか1つに絞り、許可リスト内のカテゴリ名を引用して具体的行動を1つ提示\n\n'
      + '■ 学生データ (本文に学年数字は書かない)\n'
      + '学科: ' + getDepartmentLabel_(analysis.department) + '\n'
      + '対象国家試験: ' + getDepartmentExpertName(analysis.department) + '\n'
      + '解いている問題の学年帯: ' + analysis.grade + '年向け (本文には記載しない)\n'
      + '総回答数: ' + analysis.totalQuestions + '問\n'
      + '全体正答率: ' + analysis.correctRate + '%\n'
      + '連続学習: ' + analysis.streakDays + '日\n'
      + '最終学習日: ' + (analysis.lastStudyDate || '未記録') + '\n'
      + unstudiedInfo + '\n'
      + '■ カテゴリ別 着手優先度ランキング (出題比重×不足度) — 本文ではこのランキング上位を引用すること\n'
      + (priorityList || '（出題マスタが未整備のためランキング不可）\n') + '\n'
      + '苦手分野 (rate < 65%):\n' + (weakList || '（特になし）\n') + '\n'
      + '得意分野:\n' + (strongList || '（特になし）\n') + '\n'
      + errorInfo + '\n'
      + '上記ルールに厳格に従い、許可カテゴリ名リスト内の正確な名称のみを使い、創作カテゴリや試験区分用語を一切混ぜずに、250字以内で書いてください。';

    var result = callGeminiAPI(prompt);
    if (result.error) {
      Logger.log('Gemini teacher comment error: ' + result.error);
      return '教員コメント生成に失敗。データが揃ったら次回バッチで再試行されます。';
    }
    return (result.text || '').trim() || '介入推奨の特定材料なし。次回観察で再評価。';
  },

  /**
   * 特定学生のダッシュボードをオンデマンド更新（PWAのボタンから呼ばれる）
   * 1名分だけ再計算＋AIコメント再生成
   */
  refreshStudent(studentId) {
    if (!studentId) return { error: 'studentId is required' };

    var ss = getSpreadsheet();
    var allLogs = this.collectAllLogs(ss);
    var studentLogs = allLogs.filter(function(row) { return row.studentId === studentId; });

    if (studentLogs.length === 0) {
      return { error: '学習データがありません。問題を解いてからAI分析を実行してください。' };
    }

    var categoryMap = this.getCategoryMap(ss);
    var analysis = this.analyzeStudent(studentLogs, categoryMap);

    // 学生向けAIコメントを新規生成（PWAの⟳ボタンから呼ばれるオンデマンド処理）
    var aiComment = '';
    try {
      aiComment = this.generateAiComment(analysis);
    } catch (e) {
      aiComment = '分析コメント生成中にエラーが発生しました';
      Logger.log('Gemini API error for ' + studentId + ': ' + e);
    }

    // 教員向けコメントは別経路 (TeacherCommentService) でのみ生成。
    // ここでは既存値を保持するだけ (学生PWAの操作で教員コメントが消えないように)
    var nameMap = this.getStudentNameMap();
    var studentName = nameMap[analysis.studentNumber] || '';

    // ai_dashboardシートに書き込み (teacher_comment 列追加)
    var dashboard = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    var dashHeaders = [
      'student_id', 'student_number', 'student_name', 'department', 'grade',
      'total_questions', 'correct_rate', 'streak_days',
      'weak_categories', 'strong_categories', 'weekly_trend',
      'error_patterns', 'ai_comment', 'last_study_date', 'updated_at',
      'teacher_comment'
    ];
    if (!dashboard) {
      dashboard = ss.insertSheet(CONFIG.SHEETS.AI_DASHBOARD);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setValues([dashHeaders]);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setFontWeight('bold');
    } else {
      // 旧スキーマ (teacher_comment 列なし) なら自動でヘッダーを追加
      var currentHeaders = dashboard.getRange(1, 1, 1, dashboard.getLastColumn()).getValues()[0];
      if (currentHeaders.indexOf('teacher_comment') === -1) {
        dashboard.getRange(1, 1, 1, dashHeaders.length).setValues([dashHeaders]);
        dashboard.getRange(1, 1, 1, dashHeaders.length).setFontWeight('bold');
      }
    }

    // 既存行を探し、teacher_comment 列の既存値を保持
    // 日次バッチが作った疑似行 (zerolog-<student_number>) が残っている場合は、その行を再利用して
    // 上書きする。append すると同一学生が「未着手」と実データの2行に分裂して見えるため
    // （翌朝のバッチまで最大約18時間その状態が続く）。
    var data = dashboard.getDataRange().getValues();
    var headers = data[0] || [];
    var sidIdx = headers.indexOf('student_id');
    var existingTeacherCommentIdx = headers.indexOf('teacher_comment');
    var existingTeacherComment = '';
    var foundRow = -1;
    var zeroLogRow = -1;
    var analysisNumber = normalizeStudentNumber_(analysis.studentNumber);
    var zeroLogId = analysisNumber ? (ZEROLOG_ID_PREFIX + analysisNumber) : '';
    if (sidIdx !== -1) {
      for (var i = 1; i < data.length; i++) {
        var rowSid = String(data[i][sidIdx] || '');
        if (rowSid === studentId) {
          foundRow = i + 1;
          if (existingTeacherCommentIdx !== -1) {
            existingTeacherComment = data[i][existingTeacherCommentIdx] || '';
          }
          break;
        }
        if (zeroLogRow === -1 && zeroLogId && rowSid === zeroLogId) {
          zeroLogRow = i + 1;
        }
      }
    }
    // 実UUIDの行が無く疑似行だけがある場合は、疑似行を実データで上書きする。
    // 疑似行の teacher_comment は固定文言なので引き継がない（空のまま再生成に委ねる）。
    if (foundRow === -1 && zeroLogRow !== -1) {
      foundRow = zeroLogRow;
    }

    var row = [
      studentId,
      analysis.studentNumber,
      studentName,
      analysis.department,
      analysis.grade,
      analysis.totalQuestions,
      analysis.correctRate,
      analysis.streakDays,
      JSON.stringify(analysis.weakCategories),
      JSON.stringify(analysis.strongCategories),
      JSON.stringify(analysis.weeklyTrend),
      JSON.stringify(analysis.errorPatterns),
      aiComment,
      analysis.lastStudyDate,
      new Date().toISOString(),
      existingTeacherComment  // 教員コメントは既存値を維持 (学生PWA操作で消さない)
    ];

    if (foundRow > 0) {
      dashboard.getRange(foundRow, 1, 1, dashHeaders.length).setValues([row]);
    } else {
      dashboard.appendRow(row);
    }

    // PWA経由で学生がレスポンスを受け取るため、teacher_comment は API には含めない
    // (Looker は spreadsheet 直接参照なので影響なし)
    return {
      studentId: studentId,
      studentNumber: analysis.studentNumber,
      studentName: studentName,
      department: analysis.department,
      grade: analysis.grade,
      totalQuestions: analysis.totalQuestions,
      correctRate: analysis.correctRate,
      streakDays: analysis.streakDays,
      weakCategories: analysis.weakCategories,
      strongCategories: analysis.strongCategories,
      weeklyTrend: analysis.weeklyTrend,
      errorPatterns: analysis.errorPatterns,
      aiComment: aiComment,
      lastStudyDate: analysis.lastStudyDate,
      updatedAt: new Date().toISOString(),
    };
  },

  /**
   * 特定学生のダッシュボードデータを取得（API用）
   */
  getStudentDashboard(studentId) {
    if (!studentId) {
      return { error: 'studentId is required' };
    }

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    if (!sheet) return { error: 'ダッシュボードが未生成です' };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { error: 'データなし' };

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var row = null;
    for (var i = 1; i < data.length; i++) {
      if (data[i][idx['student_id']] === studentId) {
        row = data[i];
        break;
      }
    }
    if (!row) return { error: '該当する学生データが見つかりません' };

    function safeParse(val) {
      if (!val) return [];
      try { return JSON.parse(val); } catch (e) { return []; }
    }

    // セキュリティ注: teacher_comment は教員専用なので PWA レスポンスに含めない。
    // Looker はスプレッドシートを直接参照するため API スコープ外の閲覧経路で問題なし。
    return {
      studentId: row[idx['student_id']],
      studentNumber: row[idx['student_number']],
      studentName: row[idx['student_name']],
      department: row[idx['department']],
      grade: row[idx['grade']],
      totalQuestions: row[idx['total_questions']],
      correctRate: row[idx['correct_rate']],
      streakDays: row[idx['streak_days']],
      weakCategories: safeParse(row[idx['weak_categories']]),
      strongCategories: safeParse(row[idx['strong_categories']]),
      weeklyTrend: safeParse(row[idx['weekly_trend']]),
      errorPatterns: safeParse(row[idx['error_patterns']]),
      aiComment: row[idx['ai_comment']],
      lastStudyDate: idx['last_study_date'] !== undefined ? row[idx['last_study_date']] : '',
      updatedAt: row[idx['updated_at']],
    };
  },
};

/**
 * departmentコードから日本語学科名を返す
 */
function getDepartmentLabel_(department) {
  var map = {
    nursing: '看護学科',
    clinical_eng: '臨床工学技士学科',
    dental_hyg: '歯科衛生士学科',
    orthoptist: '視能訓練士学科',
  };
  return map[department] || department;
}

// === トリガーセットアップ・実行関数 ===

/**
 * 日次ダッシュボード更新トリガーをセットアップ
 * GASエディタで一度手動実行してください
 */
function setupDailyDashboard() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runDashboardUpdate') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('runDashboardUpdate')
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .create();

  Logger.log('日次ダッシュボードトリガーをセットアップしました（毎日午前4時）');
}

/**
 * トリガーから呼ばれる関数
 */
function runDashboardUpdate() {
  DashboardService.updateAll();
}

/**
 * Phase D-2a 動作確認: 1学生分の教員コメントを生成してログ出力する
 * (シートには書き込まない、Gemini API のみ呼ぶ)
 *
 * studentNumber または studentId を直接指定して実行。
 */
function testGenerateTeacherComment() {
  var ss = getSpreadsheet();
  var allLogs = DashboardService.collectAllLogs(ss);
  // テスト対象: studentNumber='snm' (curriculumシード済の前提)
  var targetStudentNumber = 'snm';
  var studentLogs = allLogs.filter(function(row) { return row.studentNumber === targetStudentNumber; });
  if (studentLogs.length === 0) {
    Logger.log('対象学生のログがありません: studentNumber=' + targetStudentNumber);
    return;
  }

  var categoryMap = DashboardService.getCategoryMap(ss);
  var analysis = DashboardService.analyzeStudent(studentLogs, categoryMap);

  var qMasterByDept = DashboardService.buildQuestionMasterByDepartment(ss);
  var curriculumByDept = CurriculumService.loadAll(ss);
  var us = DashboardService.buildUnstudiedStats(
    studentLogs, categoryMap, qMasterByDept, curriculumByDept,
    analysis.department, analysis.grade
  );
  analysis.totalLeaves = us.totalLeaves;
  analysis.touchedLeaves = us.touchedLeaves;
  analysis.unstudiedRate = us.unstudiedRate;

  Logger.log('=== analysis ===');
  Logger.log('学科: ' + analysis.department + ', 学年: ' + analysis.grade);
  Logger.log('総回答: ' + analysis.totalQuestions + ', 正答率: ' + analysis.correctRate + '%');
  Logger.log('未着手率: ' + us.unstudiedRate + '% (touched ' + us.touchedLeaves + '/' + us.totalLeaves + ')');
  Logger.log('苦手分野: ' + analysis.weakCategories.length + '件');

  var teacherComment = DashboardService.generateTeacherComment(analysis);
  Logger.log('=== teacher_comment ===');
  Logger.log(teacherComment);
}
