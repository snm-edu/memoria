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

    // 学生名簿から学籍番号→氏名のマップを作成
    var nameMap = this.getStudentNameMap();

    // ai_dashboardシート取得or作成（student_name・last_study_date列追加対応）
    let dashboard = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    const dashHeaders = [
      'student_id', 'student_number', 'student_name', 'department', 'grade',
      'total_questions', 'correct_rate', 'streak_days',
      'weak_categories', 'strong_categories', 'weekly_trend',
      'error_patterns', 'ai_comment', 'last_study_date', 'updated_at'
    ];
    if (!dashboard) {
      dashboard = ss.insertSheet(CONFIG.SHEETS.AI_DASHBOARD);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setValues([dashHeaders]);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setFontWeight('bold');
    }

    // 既存データを取得（マイグレーション判定＋差分チェック用）
    // ヘッダーが旧スキーマでも AI コメントは再利用できるよう、先に収集してから再構築する
    const oldData = dashboard.getDataRange().getValues();
    const oldHeaders = oldData[0] || [];
    const oldStudentIdIdx = oldHeaders.indexOf('student_id');
    const oldTotalIdx = oldHeaders.indexOf('total_questions');
    const oldAiCommentIdx = oldHeaders.indexOf('ai_comment');

    const existingMap = {};
    if (oldStudentIdIdx !== -1) {
      for (var r = 1; r < oldData.length; r++) {
        var sid = oldData[r][oldStudentIdIdx];
        if (!sid) continue;
        existingMap[sid] = {
          rowNum: r + 1,
          totalQuestions: oldTotalIdx !== -1 ? oldData[r][oldTotalIdx] : 0,
          aiComment: oldAiCommentIdx !== -1 ? oldData[r][oldAiCommentIdx] : ''
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
    let skippedCount = 0;

    for (var s = 0; s < studentIds.length; s++) {
      var studentId = studentIds[s];
      var logs = studentGroups[studentId];
      var analysis = this.analyzeStudent(logs, categoryMap);

      // 差分チェック: 回答数が変わっていなければAI呼び出しをスキップ
      var existing = existingMap[studentId];
      var aiComment = '';

      if (existing && existing.totalQuestions === analysis.totalQuestions && existing.aiComment) {
        // データ変化なし → 既存のAIコメントを再利用
        aiComment = existing.aiComment;
        skippedCount++;
      } else {
        // 新規 or データ変化あり → Gemini APIでコメント生成
        try {
          aiComment = this.generateAiComment(analysis);
        } catch (e) {
          aiComment = '分析コメント生成中にエラーが発生しました';
          Logger.log('Gemini API error for ' + studentId + ': ' + e);
        }
        // レート制限対策: Gemini API呼び出し後に1秒待機
        Utilities.sleep(1000);
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
        new Date().toISOString()
      ];

      if (existing && existing.rowNum) {
        dashboard.getRange(existing.rowNum, 1, 1, dashHeaders.length).setValues([row]);
      } else {
        dashboard.appendRow(row);
      }

      updatedCount++;
    }

    Logger.log('ダッシュボード更新完了: ' + updatedCount + '名（AI更新: ' + (updatedCount - skippedCount) + '名、スキップ: ' + skippedCount + '名）');

    // category_statsシートを更新（ツリーマップ用）
    this.updateCategoryStats(ss, allLogs, categoryMap);

    return { updated: updatedCount, skipped: skippedCount };
  },

  /**
   * 分野別統計シートを更新（ツリーマップ・Looker Studio用）
   * student × category × subcategory × subtopic の粒度で集計
   */
  updateCategoryStats(ss, allLogs, categoryMap) {
    var sheetName = 'category_stats';
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    } else {
      sheet.clear();
    }

    // 学生名簿から学籍番号→氏名のマップを作成
    var nameMap = this.getStudentNameMap();

    // ヘッダー
    var headers = [
      'student_id', 'student_number', 'student_name', 'department', 'grade',
      'category', 'subcategory', 'subtopic',
      'total_count', 'correct_count', 'accuracy_rate', 'last_study_date'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // 学生ごとにグループ化
    var studentGroups = this.groupByStudent(allLogs);
    var rows = [];

    for (var studentId in studentGroups) {
      var logs = studentGroups[studentId];
      var latest = logs[logs.length - 1] || {};
      var studentNumber = latest.studentNumber || '';
      // student_nameが空の場合は student_number → student_id の順でフォールバック
      // Looker Studioのフィルターコントロールで空値が混入しないようにするため
      var studentName = nameMap[studentNumber] || studentNumber || studentId;

      // 分野 × サブカテゴリ × サブトピックの3階層で集計
      var stats = {};

      for (var i = 0; i < logs.length; i++) {
        var log = logs[i];
        var info = categoryMap[log.questionId];
        if (!info) continue;

        var cat = info.category || '未分類';
        var sub = info.subcategory || '未分類';
        var topic = info.subtopic || '未分類';
        var key = cat + '|||' + sub + '|||' + topic;

        if (!stats[key]) {
          stats[key] = { correct: 0, total: 0, cat: cat, sub: sub, topic: topic, lastDate: '' };
        }
        stats[key].total++;
        if (log.isCorrect) stats[key].correct++;
        if (log.timestamp) {
          var dateStr = String(log.timestamp).split('T')[0];
          if (dateStr > stats[key].lastDate) stats[key].lastDate = dateStr;
        }
      }

      // 行データ作成
      for (var key in stats) {
        var s = stats[key];
        var rate = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
        rows.push([
          studentId,
          studentNumber,
          studentName,
          latest.department || '',
          latest.grade || '',
          s.cat,
          s.sub,
          s.topic,
          s.total,
          s.correct,
          rate,
          s.lastDate
        ]);
      }
    }

    // 一括書き込み
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    Logger.log('category_stats更新: ' + rows.length + '行');
  },

  /**
   * 学生名簿スプレッドシートから学籍番号→氏名のマップを取得
   */
  getStudentNameMap() {
    var nameMap = {};
    try {
      var nameSheetId = PropertiesService.getScriptProperties().getProperty('STUDENT_LIST_ID');
      if (!nameSheetId) {
        var ss = getSpreadsheet();
        var sheet = ss.getSheetByName('students');
        if (sheet) {
          var data = sheet.getDataRange().getValues();
          var headers = data[0];
          var idx = {};
          headers.forEach(function(h, i) { idx[h] = i; });
          for (var i = 1; i < data.length; i++) {
            var num = String(data[i][idx['student_number']] || '');
            var name = data[i][idx['student_name']] || '';
            if (num) nameMap[num] = name;
          }
          return nameMap;
        }
        return nameMap;
      }
      var nameSS = SpreadsheetApp.openById(nameSheetId);
      var sheet = nameSS.getSheetByName('students');
      if (!sheet) return nameMap;
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var idx = {};
      headers.forEach(function(h, i) { idx[h] = i; });
      for (var i = 1; i < data.length; i++) {
        var num = String(data[i][idx['student_number']] || '');
        var name = data[i][idx['student_name']] || '';
        if (num) nameMap[num] = name;
      }
    } catch (e) {
      Logger.log('学生名簿取得エラー: ' + e);
    }
    return nameMap;
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

    // 常にAIコメントを新規生成（オンデマンドなので差分チェックしない）
    var aiComment = '';
    try {
      aiComment = this.generateAiComment(analysis);
    } catch (e) {
      aiComment = '分析コメント生成中にエラーが発生しました';
      Logger.log('Gemini API error for ' + studentId + ': ' + e);
    }

    var nameMap = this.getStudentNameMap();
    var studentName = nameMap[analysis.studentNumber] || '';

    // ai_dashboardシートに書き込み
    var dashboard = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    var dashHeaders = [
      'student_id', 'student_number', 'student_name', 'department', 'grade',
      'total_questions', 'correct_rate', 'streak_days',
      'weak_categories', 'strong_categories', 'weekly_trend',
      'error_patterns', 'ai_comment', 'last_study_date', 'updated_at'
    ];
    if (!dashboard) {
      dashboard = ss.insertSheet(CONFIG.SHEETS.AI_DASHBOARD);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setValues([dashHeaders]);
      dashboard.getRange(1, 1, 1, dashHeaders.length).setFontWeight('bold');
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
      new Date().toISOString()
    ];

    // 既存行を探して更新 or 追加（ヘッダー位置を動的に決定してスキーマ差異に耐える）
    var data = dashboard.getDataRange().getValues();
    var headers = data[0] || [];
    var sidIdx = headers.indexOf('student_id');
    var found = false;
    if (sidIdx !== -1) {
      for (var i = 1; i < data.length; i++) {
        if (data[i][sidIdx] === studentId) {
          dashboard.getRange(i + 1, 1, 1, dashHeaders.length).setValues([row]);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      dashboard.appendRow(row);
    }

    // 取得したデータをそのまま返す
    function safeParse(val) {
      if (!val) return [];
      try { return JSON.parse(val); } catch (e) { return []; }
    }

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
