/**
 * Memoria 教員向け AI コメント オンデマンドサービス (Phase D-2a)
 *
 * 教員ダッシュボード (Looker Studio) の「教員向けAI分析を実行」ボタンから
 * GAS Web App の HTML エンドポイントとして呼ばれる。
 *
 * 設計方針:
 * - 認証: Script Properties の TEACHER_EMAILS (カンマ区切り) で allow-list
 * - 認可: Session.getActiveUser().getEmail() を allow-list と照合
 * - キャッシュ: ai_dashboard.teacher_comment セルに 24h 鮮度判定で再利用
 * - レンダリング: HtmlService で結果ページを返却 (新タブで開く想定)
 *
 * セキュリティ:
 * - 学生 PWA は同じ GAS デプロイの「Anyone」アクセスを使用するためデプロイ設定は変更しない
 * - 学生がエンドポイント URL を手に入れて直接叩いても、Google ログインしていないか
 *   メールが allow-list に無ければ 403 ページを返す
 */

const TeacherCommentService = {
  CACHE_HOURS: 24,

  /**
   * Script Properties から教員メールアドレスの allow-list を取得
   * @return {Array<string>} 小文字化済みメールアドレス配列
   */
  getAuthorizedEmails: function() {
    var raw = PropertiesService.getScriptProperties().getProperty('TEACHER_EMAILS') || '';
    return raw.split(',')
      .map(function(e) { return (e || '').trim().toLowerCase(); })
      .filter(function(e) { return e.length > 0; });
  },

  /**
   * 実行者メールが allow-list に含まれるか判定
   * @param {string} email - Session.getActiveUser().getEmail() の戻り値
   * @return {boolean}
   */
  isAuthorizedTeacher: function(email) {
    if (!email) return false;
    var allowed = this.getAuthorizedEmails();
    return allowed.indexOf(email.toLowerCase()) !== -1;
  },

  /**
   * メインエントリ: GAS Web App から呼ばれる
   * @param {string} studentId
   * @return {HtmlOutput} 結果ページ
   */
  generateAndDisplay: function(studentId) {
    // ゲート1: 認証 (Google ログイン + allow-list)
    var email = '';
    try {
      email = Session.getActiveUser().getEmail() || '';
    } catch (e) {
      email = '';
    }

    if (!this.isAuthorizedTeacher(email)) {
      Logger.log('[TeacherComment] Unauthorized access from: ' + (email || 'anonymous')
        + ' studentId=' + studentId);
      return this.renderUnauthorizedPage(email);
    }

    if (!studentId) {
      return this.renderErrorPage('studentId が指定されていません', email);
    }

    // ゲート2: キャッシュ判定 (24h 以内の既存値があれば再利用)
    var cached = this.getCachedComment(studentId);
    if (cached.fresh && cached.comment) {
      Logger.log('[TeacherComment] Cache hit for studentId=' + studentId
        + ' age=' + cached.ageHours.toFixed(1) + 'h by=' + email);
      return this.renderCommentPage(studentId, cached, email, true);
    }

    // ゲート3: 新規生成 (キャッシュ期限切れ or 初回)
    Logger.log('[TeacherComment] Generating fresh for studentId=' + studentId + ' by=' + email);
    var fresh = this.generateFresh(studentId);
    if (fresh.error) {
      return this.renderErrorPage(fresh.error, email);
    }

    // 保存の失敗でコメント表示ごと落とさない。
    // saveTeacherComment は withDashboardLock_ を通すようになり、ロックを20秒取れないと throw する。
    // この関数は doGet(getTeacherComment) から HtmlOutput を返す契約で呼ばれるため、
    // ここで投げると Code.gs の外側 catch に落ちて教員のタブに生JSONが出るうえ、
    // 課金済みの Gemini 出力まで捨てることになる。保存はキャッシュにすぎないので、
    // 失敗してもログに残して表示は続ける（次回アクセスで再生成される）。
    try {
      this.saveTeacherComment(studentId, fresh.comment);
    } catch (e) {
      Logger.log('[TeacherComment] キャッシュ保存に失敗（表示は継続）: '
        + (e && e.stack ? e.stack : e));
    }

    return this.renderCommentPage(studentId, {
      comment: fresh.comment,
      updatedAt: new Date().toISOString(),
      studentNumber: fresh.studentNumber,
      studentName: fresh.studentName,
      department: fresh.department,
      grade: fresh.grade
    }, email, false);
  },

  /**
   * ai_dashboard から既存の teacher_comment を読み、鮮度を判定
   *
   * @param {string} studentId
   * @return {Object} {fresh, comment, updatedAt, ageHours, ...}
   */
  getCachedComment: function(studentId) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    if (!sheet) return { fresh: false };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { fresh: false };

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var sidIdx = idx['student_id'];
    var tcIdx = idx['teacher_comment'];
    var updatedIdx = idx['updated_at'];
    if (sidIdx === undefined || tcIdx === undefined) return { fresh: false };

    for (var i = 1; i < data.length; i++) {
      if (data[i][sidIdx] !== studentId) continue;
      var comment = data[i][tcIdx] || '';
      var updatedAt = data[i][updatedIdx] || '';
      if (!comment) {
        return {
          fresh: false,
          studentNumber: data[i][idx['student_number']] || '',
          studentName: data[i][idx['student_name']] || '',
          department: data[i][idx['department']] || '',
          grade: data[i][idx['grade']] || ''
        };
      }
      var ageHours = this.computeAgeHours(updatedAt);
      return {
        fresh: ageHours !== null && ageHours < this.CACHE_HOURS,
        comment: comment,
        updatedAt: updatedAt,
        ageHours: ageHours !== null ? ageHours : 9999,
        studentNumber: data[i][idx['student_number']] || '',
        studentName: data[i][idx['student_name']] || '',
        department: data[i][idx['department']] || '',
        grade: data[i][idx['grade']] || ''
      };
    }
    return { fresh: false };
  },

  /**
   * ISO8601 文字列から現在時刻までの経過時間 (時間単位) を計算
   */
  computeAgeHours: function(iso) {
    if (!iso) return null;
    try {
      var t = new Date(iso).getTime();
      if (isNaN(t)) return null;
      return (Date.now() - t) / (1000 * 60 * 60);
    } catch (e) {
      return null;
    }
  },

  /**
   * 学生1名分のログを集計し、Gemini で教員コメントを新規生成
   * @return {Object} {comment, studentNumber, studentName, department, grade} or {error}
   */
  generateFresh: function(studentId) {
    var ss = getSpreadsheet();
    var allLogs = DashboardService.collectAllLogs(ss);
    var studentLogs = allLogs.filter(function(row) { return row.studentId === studentId; });
    if (studentLogs.length === 0) {
      return { error: '対象学生の学習データが見つかりません (studentId=' + studentId + ')' };
    }

    var categoryMap = DashboardService.getCategoryMap(ss);
    var analysis = DashboardService.analyzeStudent(studentLogs, categoryMap);

    // 未着手率を計算 (curriculum + questions マスタ参照)
    var qMasterByDept = DashboardService.buildQuestionMasterByDepartment(ss);
    var curriculumByDept = CurriculumService.loadAll(ss);
    var us = DashboardService.buildUnstudiedStats(
      studentLogs, categoryMap, qMasterByDept, curriculumByDept,
      analysis.department, analysis.grade
    );
    analysis.totalLeaves = us.totalLeaves;
    analysis.touchedLeaves = us.touchedLeaves;
    analysis.unstudiedRate = us.unstudiedRate;

    var comment = '';
    try {
      comment = DashboardService.generateTeacherComment(analysis);
    } catch (e) {
      Logger.log('[TeacherComment] Gemini error: ' + e);
      return { error: '教員コメントの生成に失敗: ' + String(e) };
    }

    var nameMap = DashboardService.getStudentNameMap();
    var studentName = nameMap[analysis.studentNumber] || '';

    return {
      comment: comment,
      studentNumber: analysis.studentNumber,
      studentName: studentName,
      department: analysis.department,
      grade: analysis.grade
    };
  },

  /**
   * ai_dashboard.teacher_comment セルを更新する (updated_at も同時刷新)
   * 該当行が無ければ何もしない (refreshDashboard / 日次バッチで先に行が作られる前提)
   */
  saveTeacherComment: function(studentId, comment) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    if (!sheet) return;

    // 行番号を引いてから書くため、日次バッチの疑似行削除と競合すると別人の行を上書きしうる。
    // DashboardService と同じスクリプトロックで直列化する。
    DashboardService.withDashboardLock_(function () {
      var data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;

      var headers = data[0];
      var sidIdx = headers.indexOf('student_id');
      var tcIdx = headers.indexOf('teacher_comment');
      var updatedIdx = headers.indexOf('updated_at');
      if (sidIdx === -1 || tcIdx === -1) return;

      for (var i = 1; i < data.length; i++) {
        if (data[i][sidIdx] === studentId) {
          sheet.getRange(i + 1, tcIdx + 1).setValue(comment);
          if (updatedIdx !== -1) {
            sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date().toISOString());
          }
          return;
        }
      }
    });
  },

  // === HTML レンダリング ===

  renderCommentPage: function(studentId, info, viewerEmail, fromCache) {
    var html = this.htmlPageTemplate({
      title: '教員向けAI分析',
      heading: '🩺 教員向け AI 分析',
      bodyHtml: this.buildCommentBody(studentId, info, viewerEmail, fromCache)
    });
    return HtmlService.createHtmlOutput(html)
      .setTitle('教員向けAI分析')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  },

  renderUnauthorizedPage: function(viewerEmail) {
    var loginInfo = viewerEmail
      ? '<p>ログイン中: <code>' + this.escapeHtml(viewerEmail) + '</code></p>'
      : '<p>ログインしていません。</p>';
    var bodyHtml = ''
      + '<div class="alert">'
      + '<h2>⚠ アクセス権限がありません</h2>'
      + '<p>このページは教員ダッシュボード経由でのみアクセスできます。</p>'
      + loginInfo
      + '<p>権限が必要な場合は管理者までご連絡ください。</p>'
      + '</div>';
    var html = this.htmlPageTemplate({
      title: 'アクセス権限なし',
      heading: '🔒 アクセス権限なし',
      bodyHtml: bodyHtml
    });
    return HtmlService.createHtmlOutput(html)
      .setTitle('アクセス権限なし')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  },

  renderErrorPage: function(message, viewerEmail) {
    var bodyHtml = ''
      + '<div class="alert">'
      + '<h2>❌ エラー</h2>'
      + '<p>' + this.escapeHtml(message) + '</p>'
      + '</div>';
    var html = this.htmlPageTemplate({
      title: 'エラー',
      heading: '❌ エラー',
      bodyHtml: bodyHtml
    });
    return HtmlService.createHtmlOutput(html)
      .setTitle('エラー')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  },

  buildCommentBody: function(studentId, info, viewerEmail, fromCache) {
    var statusLabel = fromCache
      ? 'キャッシュ済 (24時間以内)'
      : '新規生成完了';

    var deptLabel = (typeof getDepartmentLabel_ === 'function')
      ? getDepartmentLabel_(info.department)
      : info.department;

    var subject = ''
      + this.escapeHtml(info.studentName || info.studentNumber || studentId)
      + ' / ' + this.escapeHtml(deptLabel || '') + ' ' + this.escapeHtml(String(info.grade || '') + '年');

    return ''
      + '<div class="success-card">'
      + '  <div class="big-check">✓</div>'
      + '  <h2>AI分析が完了しました</h2>'
      + '  <p class="subject">' + subject + '</p>'
      + '  <p class="status">' + statusLabel + '</p>'
      + '</div>'
      + '<div class="instruction">'
      + '  <p>このタブを閉じて、教員ダッシュボードに戻ってください。</p>'
      + '  <p>ダッシュボードの「AIアドバイス」表に最新コメントが反映されています</p>'
      + '  <p class="hint">※ 表示が古い場合は Looker の右上「⋮」→「データを更新」をクリック</p>'
      + '  <button class="close-btn" onclick="try{window.close()}catch(e){}">このタブを閉じる</button>'
      + '</div>'
      + '<div class="footer-note">'
      + '  <p>閲覧者: <code>' + this.escapeHtml(viewerEmail) + '</code> / 更新: ' + this.escapeHtml(this.formatLocalTime(info.updatedAt)) + '</p>'
      + '</div>'
      + '<script>setTimeout(function(){try{window.close()}catch(e){}},3000);</script>';
  },

  htmlPageTemplate: function(opts) {
    return ''
      + '<!doctype html><html lang="ja"><head>'
      + '<meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>' + this.escapeHtml(opts.title) + '</title>'
      + '<style>'
      + 'body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;background:#f1f5f9;margin:0;padding:24px;color:#0f172a;}'
      + '.container{max-width:520px;margin:0 auto;background:#fff;padding:24px 28px;border-radius:12px;box-shadow:0 4px 12px rgba(15,23,42,0.06);}'
      + 'h1{font-size:18px;margin:0 0 12px 0;color:#0369a1;border-bottom:2px solid #38bdf8;padding-bottom:8px;}'
      + 'h2{color:#0f766e;font-size:18px;margin:8px 0;}'
      + '.success-card{text-align:center;padding:16px 0;border-bottom:1px solid #e2e8f0;}'
      + '.big-check{font-size:48px;color:#10b981;line-height:1;margin-bottom:8px;}'
      + '.subject{font-size:14px;color:#334155;margin:4px 0;font-weight:500;}'
      + '.status{display:inline-block;font-size:11px;padding:3px 10px;border-radius:12px;background:#dbeafe;color:#1e40af;font-weight:600;margin:4px 0;}'
      + '.instruction{padding:16px 0;text-align:center;}'
      + '.instruction p{margin:6px 0;font-size:13px;color:#334155;line-height:1.6;}'
      + '.instruction .hint{font-size:11px;color:#64748b;}'
      + '.close-btn{margin-top:14px;padding:10px 24px;background:#0ea5e9;color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;}'
      + '.close-btn:hover{background:#0284c7;}'
      + '.alert{background:#fef2f2;border-left:4px solid #dc2626;padding:16px 18px;border-radius:6px;}'
      + '.footer-note{font-size:10px;color:#94a3b8;margin-top:16px;border-top:1px solid #e2e8f0;padding-top:10px;text-align:center;}'
      + '.footer-note p{margin:2px 0;}'
      + 'code{font-family:"SF Mono",Menlo,monospace;font-size:10px;background:#f1f5f9;padding:1px 6px;border-radius:4px;}'
      + '</style>'
      + '</head><body>'
      + '<div class="container">'
      + '<h1>' + this.escapeHtml(opts.heading) + '</h1>'
      + opts.bodyHtml
      + '</div>'
      + '</body></html>';
  },

  escapeHtml: function(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  formatLocalTime: function(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      // 日本時間 (Asia/Tokyo) で yyyy-MM-dd HH:mm
      return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    } catch (e) {
      return String(iso);
    }
  }
};

/**
 * 動作確認: ログイン中のメールアドレスを返す
 * 教員アカウントで実行 → 自分のメールが allow-list に入っているか確認できる
 */
function whoAmI() {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  Logger.log('Active user: ' + (email || '(anonymous)'));
  Logger.log('Authorized emails count: ' + TeacherCommentService.getAuthorizedEmails().length);
  Logger.log('Is authorized: ' + TeacherCommentService.isAuthorizedTeacher(email));
}
