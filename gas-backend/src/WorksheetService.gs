/**
 * Memoria 補講ワークシート生成サービス (Phase D-3)
 *
 * 教員 Looker ダッシュボードから「補講ワークシート作成」リンク経由で起動。
 * 学生1名の弱点 Top3 カテゴリから 出題比重×未着手 の優先度で問題を抽出し、
 * Google Doc + PDF を生成して教員のメールに送信する。
 *
 * セキュリティ設計 (個人情報保護):
 *   - 認証: URL トークン (WORKSHEET_TOKEN) を Script Property に保存し、URL パラメータと照合
 *           実行ユーザー = snm 固定で、教員アカウント側の OAuth 認可は不要。
 *           Session.getActiveUser() は別ドメインユーザーで空文字列を返す GAS 仕様のため、
 *           allow-list ではなく URL トークン方式を採用。
 *           Looker は教員のみに共有されているため、Looker 数式に埋め込んだ token は
 *           教員以外に漏洩しない前提。
 *   - Doc 配置: 学科別 Drive フォルダ (WORKSHEET_FOLDER_<DEPT>)
 *               4 フォルダはすべて事前に snm が承認済み教員に Editor 共有。
 *               承認済み教員はどの学科の Doc にもアクセス可能 (横断閲覧 OK)。
 *   - 学科別フォルダは整理目的 (Drive 内で学科ごとに見やすくする)
 *   - 「リンクを知っている全員」共有は不採用 (不正なリンク漏洩を防ぐ)
 *
 * Script Properties (要設定):
 *   WORKSHEET_TOKEN               Worksheet 生成用の URL トークン (32文字以上推奨)
 *   WORKSHEET_FOLDER_NURSING      看護学科ワークシート格納フォルダ ID
 *   WORKSHEET_FOLDER_CLINICAL_ENG 臨床工学技士学科フォルダ ID
 *   WORKSHEET_FOLDER_DENTAL_HYG   歯科衛生士学科フォルダ ID
 *   WORKSHEET_FOLDER_ORTHOPTIST   視能訓練士学科フォルダ ID
 *
 * URL 形式:
 *   /exec?action=getWorksheet&studentId=xxx&token=YYY[&count=20]
 *
 * 出力ドキュメント構成:
 *   1. 表紙 (学生情報 + 補講テーマ)
 *   2. 問題編 (学生配布用)
 *   3. 解答一覧 (教員採点用)
 *   4. 解説編 (採点後配布用)
 */

const WorksheetService = {
  DEFAULT_QUESTION_COUNT: 20,

  /**
   * 学科別 Drive フォルダ ID を取得
   * Script Properties キー形式: WORKSHEET_FOLDER_<DEPARTMENT_UPPER>
   * 例) nursing → WORKSHEET_FOLDER_NURSING
   *
   * 4 フォルダはすべて承認済み教員に Editor 共有されている前提
   * (フォルダは整理目的で学科分け、教員は全学科のフォルダにアクセス可能)
   */
  getFolderIdForDepartment: function(department) {
    var key = 'WORKSHEET_FOLDER_' + (department || '').toUpperCase();
    return PropertiesService.getScriptProperties().getProperty(key) || '';
  },

  /**
   * メインエントリ (Code.gs から呼ばれる)
   * @param {string} studentId
   * @param {Object} options - {count}
   * @return {HtmlOutput}
   */
  generateAndDeliver: function(studentId, options) {
    options = options || {};

    // 認証: Script Property の WORKSHEET_TOKEN と URL パラメータ token の照合
    //   実行ユーザー = snm のままにして、教員アカウント側の OAuth 認可を不要にするため、
    //   Session.getActiveUser() に依存しない URL ベースのトークン認証に切り替え。
    //   Looker は教員のみに共有されている前提なので、Looker から渡される URL に
    //   固定トークンを埋め込めば、実質的に教員のみがアクセス可能になる。
    //   トークン値は Script Property の WORKSHEET_TOKEN に保存する。
    var expectedToken = PropertiesService.getScriptProperties().getProperty('WORKSHEET_TOKEN') || '';
    var providedToken = (options.token || '').toString();
    if (!expectedToken) {
      Logger.log('[Worksheet] WORKSHEET_TOKEN not set in Script Properties');
      return TeacherCommentService.renderErrorPage(
        '[診断1] Script Properties の WORKSHEET_TOKEN が未設定です。snm の GAS 設定で追加してください。',
        ''
      );
    }
    if (!providedToken) {
      Logger.log('[Worksheet] No token in URL');
      return TeacherCommentService.renderErrorPage(
        '[診断2] URL に token パラメータがありません。Looker 数式の確認が必要です。',
        ''
      );
    }
    if (providedToken !== expectedToken) {
      Logger.log('[Worksheet] Token mismatch (URL token length=' + providedToken.length + ', expected length=' + expectedToken.length + ')');
      return TeacherCommentService.renderErrorPage(
        '[診断3] token が一致しません。Script Property の値と Looker URL の値が異なります。長さ: URL=' + providedToken.length + ', Property=' + expectedToken.length,
        ''
      );
    }

    // 実行ユーザー (snm) の email をログ・メール宛先用に取得
    //   getActiveUser() は別ドメインのユーザーで空を返す GAS 仕様のため、
    //   実行ユーザー (= snm) を取れる getEffectiveUser() を使う。
    //   メール送信先は snm 固定 (補講ワークシートのアーカイブ通知用)。
    var email = '';
    try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) {}

    if (!studentId) {
      return TeacherCommentService.renderErrorPage('studentId が指定されていません', email);
    }

    var count = parseInt(options.count, 10) || this.DEFAULT_QUESTION_COUNT;
    if (count < 5) count = 5;
    if (count > 50) count = 50;

    try {
      // 1. 学生分析データ取得
      Logger.log('[Worksheet] Building analysis for studentId=' + studentId + ' by=' + email);
      var studentInfo = this.buildStudentInfo(studentId);
      if (studentInfo.error) {
        return TeacherCommentService.renderErrorPage(studentInfo.error, email);
      }

      // 2. 問題ピックアップ
      var questions = this.pickQuestions(studentInfo, count);
      if (questions.length === 0) {
        return TeacherCommentService.renderErrorPage(
          '対象問題が見つかりません (弱点カテゴリのマスタが不足している可能性)',
          email
        );
      }
      Logger.log('[Worksheet] Picked ' + questions.length + ' questions');

      // 3. Google Doc 生成
      var doc = this.createWorksheetDoc(studentInfo, questions, email);

      // 4. ファイル共有設定 (学科別フォルダで個人情報保護)
      //   設計方針:
      //     - 「リンクを知っている全員」共有は採用しない (個人情報漏洩リスク)
      //     - 学科別 Drive フォルダ (WORKSHEET_FOLDER_<DEPT>) に Doc を移動
      //     - 各フォルダは事前に snm が「その学科の教員」のみ Editor 共有
      //     - 他学科の教員はフォルダ共有メンバーでないため、URL を入手しても開けない
      //     - 加えて、認証で取得できた教員 email を Doc に Editor 追加 (個別記録 + 二重防御)
      try {
        var file = DriveApp.getFileById(doc.getId());

        var folderId = this.getFolderIdForDepartment(studentInfo.department);
        if (folderId) {
          try {
            var folder = DriveApp.getFolderById(folderId);
            folder.addFile(file);
            // ルートや他フォルダから除去 (移動先フォルダ専属化)
            var parents = file.getParents();
            while (parents.hasNext()) {
              var p = parents.next();
              if (p.getId() !== folderId) {
                p.removeFile(file);
              }
            }
            Logger.log('[Worksheet] Moved to dept folder (' + studentInfo.department + '): ' + folderId);
          } catch (e) {
            Logger.log('[Worksheet] Folder move failed (continuing): ' + e);
          }
        } else {
          Logger.log('[Worksheet] WARNING: WORKSHEET_FOLDER_'
            + studentInfo.department.toUpperCase() + ' not set. Doc stays in snm root.');
        }

        // 認証で取得できた教員 email を個別 Editor 追加
        if (email) {
          try { file.addEditor(email); } catch (e2) { Logger.log('[Worksheet] addEditor failed: ' + e2); }
        }
      } catch (e) {
        Logger.log('[Worksheet] sharing setup failed: ' + e);
      }

      // 5. PDF + メール送信
      var pdfBlob = doc.getAs('application/pdf').setName(doc.getName() + '.pdf');
      this.sendEmail(email, studentInfo, doc, pdfBlob, questions.length);

      // 6. 結果ページ表示
      return this.renderSuccessPage(email, studentInfo, doc, questions.length);
    } catch (e) {
      Logger.log('[Worksheet] Error: ' + e + '\n' + (e.stack || ''));
      return TeacherCommentService.renderErrorPage('生成エラー: ' + e, email);
    }
  },

  /**
   * 学生 1 名分の analysis + categoryPriorities + 解答済問題集合を構築
   */
  buildStudentInfo: function(studentId) {
    var ss = getSpreadsheet();
    var allLogs = DashboardService.collectAllLogs(ss);
    var studentLogs = allLogs.filter(function(row) { return row.studentId === studentId; });
    if (studentLogs.length === 0) {
      return { error: '対象学生の学習データが見つかりません (studentId=' + studentId + ')' };
    }

    var categoryMap = DashboardService.getCategoryMap(ss);
    var analysis = DashboardService.analyzeStudent(studentLogs, categoryMap);

    var qMasterByDept = DashboardService.buildQuestionMasterByDepartment(ss);
    var curriculumByDept = CurriculumService.loadAll(ss);
    var cp = DashboardService.buildCategoryPriorities(
      studentLogs, categoryMap, qMasterByDept, curriculumByDept,
      analysis.department, analysis.grade
    );

    var nameMap = DashboardService.getStudentNameMap();
    var studentName = nameMap[analysis.studentNumber] || '';

    // 解答済問題ID集合 (重複回避用) + 間違えた問題集合 (優先選定用)
    var attemptedSet = {};
    var wrongSet = {};
    studentLogs.forEach(function(log) {
      if (!log.questionId) return;
      attemptedSet[log.questionId] = true;
      if (!log.isCorrect) wrongSet[log.questionId] = true;
    });

    return {
      studentId: studentId,
      studentNumber: analysis.studentNumber,
      studentName: studentName,
      department: analysis.department,
      grade: analysis.grade,
      analysis: analysis,
      categoryPriorities: cp.priorities,
      attemptedSet: attemptedSet,
      wrongSet: wrongSet
    };
  },

  /**
   * 弱点 Top3 カテゴリから問題を配分抽出
   * 配分: 1位=50%, 2位=30%, 3位=20% (要素数に応じて適応)
   * カテゴリ内優先度: 未着手 > 既解答+不正解 > 既解答+正解
   */
  pickQuestions: function(studentInfo, count) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    // 学科に該当する問題のみ抽出
    var deptQuestions = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx['department']] !== studentInfo.department) continue;
      deptQuestions.push({
        questionId: row[idx['question_id']] || '',
        category: row[idx['category']] || '',
        subcategory: row[idx['subcategory']] || '',
        subtopic: row[idx['subtopic']] || '',
        difficulty: Number(row[idx['difficulty']]) || 3,
        questionText: row[idx['question_text']] || '',
        choiceA: row[idx['choice_a']] || '',
        choiceB: row[idx['choice_b']] || '',
        choiceC: row[idx['choice_c']] || '',
        choiceD: row[idx['choice_d']] || '',
        choiceE: row[idx['choice_e']] || '',
        correctAnswer: row[idx['correct_answer']] || '',
        explanation: row[idx['explanation']] || ''
      });
    }

    var top3 = (studentInfo.categoryPriorities || []).slice(0, 3);
    if (top3.length === 0) return [];

    // カテゴリ別配分
    var allocations;
    if (top3.length >= 3) {
      var a1 = Math.round(count * 0.5);
      var a2 = Math.round(count * 0.3);
      var a3 = count - a1 - a2;
      allocations = [a1, a2, a3];
    } else if (top3.length === 2) {
      var b1 = Math.round(count * 0.6);
      allocations = [b1, count - b1];
    } else {
      allocations = [count];
    }

    var selected = [];
    for (var t = 0; t < top3.length; t++) {
      var cat = top3[t].category;
      var alloc = allocations[t];
      if (alloc <= 0) continue;

      var pool = deptQuestions.filter(function(q) { return q.category === cat; });
      if (pool.length === 0) continue;

      var unstudied = pool.filter(function(q) { return !studentInfo.attemptedSet[q.questionId]; });
      var wrongAnswered = pool.filter(function(q) {
        return studentInfo.attemptedSet[q.questionId] && studentInfo.wrongSet[q.questionId];
      });
      var correctAnswered = pool.filter(function(q) {
        return studentInfo.attemptedSet[q.questionId] && !studentInfo.wrongSet[q.questionId];
      });

      var combined = this.shuffle(unstudied)
        .concat(this.shuffle(wrongAnswered))
        .concat(this.shuffle(correctAnswered));
      selected = selected.concat(combined.slice(0, alloc));
    }

    return selected;
  },

  shuffle: function(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  },

  /**
   * Google Doc を新規作成して問題・解答・解説を流し込む
   */
  createWorksheetDoc: function(studentInfo, questions, teacherEmail) {
    var deptLabel = getDepartmentLabel_(studentInfo.department);
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm');
    var displayName = studentInfo.studentName || studentInfo.studentNumber || studentInfo.studentId;
    var docName = '補講ワークシート_' + displayName + '_' + stamp;

    var doc = DocumentApp.create(docName);
    var body = doc.getBody();

    // タイトル
    var title = body.appendParagraph('📚 補講ワークシート');
    title.setHeading(DocumentApp.ParagraphHeading.HEADING1);

    // 学生情報テーブル
    body.appendTable([
      ['学生氏名', studentInfo.studentName || '（未登録）'],
      ['学籍番号', studentInfo.studentNumber || '（未登録）'],
      ['学科', deptLabel + ' ' + studentInfo.grade + '年'],
      ['作成日', Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年M月d日')],
      ['作成者', teacherEmail]
    ]);

    // 補講テーマ
    var themeHeading = body.appendParagraph('▼ 補講テーマ');
    themeHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    var top3 = (studentInfo.categoryPriorities || []).slice(0, 3);
    var themeText = '本ワークシートは、本生徒の学習データから優先的に強化すべき分野を選定し、合計 '
      + questions.length + ' 問で構成しています。\n\n優先カテゴリ:\n';
    for (var i = 0; i < top3.length; i++) {
      var p = top3[i];
      var rateLabel = p.unstudied ? '未着手' : '正答率 ' + p.currentRate + '%';
      themeText += '  ' + (i + 1) + '位: 「' + p.category + '」'
        + '  (出題比重 ' + p.examWeightPct + '%, ' + rateLabel + ')\n';
    }
    body.appendParagraph(themeText);

    // === 問題編 ===
    body.appendPageBreak();
    body.appendParagraph('━━━ 問題編 ━━━')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);

    questions.forEach(function(q, i) {
      var head = body.appendParagraph('【問題' + (i + 1) + '】 [' + q.category + ']');
      head.editAsText().setBold(true);
      body.appendParagraph(q.questionText);
      if (q.choiceA) body.appendParagraph('  A. ' + q.choiceA);
      if (q.choiceB) body.appendParagraph('  B. ' + q.choiceB);
      if (q.choiceC) body.appendParagraph('  C. ' + q.choiceC);
      if (q.choiceD) body.appendParagraph('  D. ' + q.choiceD);
      if (q.choiceE) body.appendParagraph('  E. ' + q.choiceE);
      body.appendParagraph('回答: [   ]');
      body.appendParagraph('');
    });

    // === 解答一覧 (教員採点用) ===
    body.appendPageBreak();
    body.appendParagraph('━━━ 解答一覧 (教員採点用) ━━━')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    var answerLines = [];
    for (var i = 0; i < questions.length; i++) {
      answerLines.push('問' + (i + 1) + ': ' + questions[i].correctAnswer);
    }
    // 5問ずつ改行
    var answerBlock = '';
    for (var i = 0; i < answerLines.length; i++) {
      answerBlock += answerLines[i].padEnd(10, ' ');
      if ((i + 1) % 5 === 0) answerBlock += '\n';
      else answerBlock += '   ';
    }
    body.appendParagraph(answerBlock);
    body.appendParagraph('');
    body.appendParagraph('採点結果: _____ / ' + questions.length + ' 問 (_____%)');

    // === 解説編 ===
    body.appendPageBreak();
    body.appendParagraph('━━━ 解説編 (採点後配布用) ━━━')
        .setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('※ 自己採点後にお読みください\n');
    questions.forEach(function(q, i) {
      var head = body.appendParagraph('【問題' + (i + 1) + '】 正解: ' + q.correctAnswer);
      head.editAsText().setBold(true);
      body.appendParagraph(q.explanation || '（解説なし）');
      body.appendParagraph('');
    });

    doc.saveAndClose();
    return doc;
  },

  /**
   * 教員のメールに PDF を添付送信
   */
  sendEmail: function(teacherEmail, studentInfo, doc, pdfBlob, questionCount) {
    var deptLabel = getDepartmentLabel_(studentInfo.department);
    var subject = '【Memoria】補講ワークシート: '
      + (studentInfo.studentName || studentInfo.studentNumber || studentInfo.studentId);
    var body = ''
      + '補講ワークシートを作成しました。\n\n'
      + '【対象学生】\n'
      + '  氏名: ' + (studentInfo.studentName || '(未登録)') + '\n'
      + '  学籍番号: ' + (studentInfo.studentNumber || '(未登録)') + '\n'
      + '  学科: ' + deptLabel + ' ' + studentInfo.grade + '年\n\n'
      + '【ワークシート概要】\n'
      + '  問題数: ' + questionCount + ' 問\n'
      + '  Google Doc: ' + doc.getUrl() + '\n\n'
      + 'PDF を本メールに添付しています。\n'
      + '印刷して学生に配布、または Google Doc を編集して使用してください。\n';

    MailApp.sendEmail({
      to: teacherEmail,
      subject: subject,
      body: body,
      attachments: [pdfBlob]
    });
  },

  /**
   * 完了ページの HTML を返す
   */
  renderSuccessPage: function(email, studentInfo, doc, questionCount) {
    var deptLabel = getDepartmentLabel_(studentInfo.department);
    var subjectStr = (studentInfo.studentName || studentInfo.studentNumber || studentInfo.studentId)
      + ' / ' + deptLabel + ' ' + studentInfo.grade + '年';
    var docUrl = doc.getUrl();

    var bodyHtml = ''
      + '<div class="success-card">'
      + '  <div class="big-check">✓</div>'
      + '  <h2>補講ワークシートを作成しました</h2>'
      + '  <p class="subject">' + TeacherCommentService.escapeHtml(subjectStr) + '</p>'
      + '  <p class="status">合計 ' + questionCount + ' 問</p>'
      + '</div>'
      + '<div class="instruction">'
      + '  <p>📧 <code>' + TeacherCommentService.escapeHtml(email) + '</code> 宛に PDF を送信しました</p>'
      + '  <p style="margin-top:14px;">'
      + '    <a href="' + docUrl + '" target="_blank" '
      + '       style="display:inline-block;padding:10px 24px;background:#0ea5e9;color:#fff;'
      + '       border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">'
      + '       📄 Google Doc を開く</a>'
      + '  </p>'
      + '  <p class="hint" style="margin-top:14px;">'
      + '    Google Doc は編集可能です。教員のメモを追記して学生に配布できます。'
      + '  </p>'
      + '</div>';

    var html = TeacherCommentService.htmlPageTemplate({
      title: '補講ワークシート作成完了',
      heading: '📚 補講ワークシート作成完了',
      bodyHtml: bodyHtml
    });
    return HtmlService.createHtmlOutput(html)
      .setTitle('補講ワークシート作成完了')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
};

/**
 * 一度だけ実行する OAuth 認可トリガー関数。
 *
 * WorksheetService が使う DocumentApp / DriveApp / MailApp の権限を
 * GAS プロジェクトに付与するため、デプロイ前に手動で1回だけ実行する。
 * 実行時に「認可が必要です」ダイアログが出るので「権限を確認」→「許可」と進める。
 *
 * 一度認可が完了すれば、デプロイ済み Web App でも同じ権限で動作する。
 * その後はこの関数を実行する必要はない (削除しても OK、残置でも害なし)。
 */
function authorizeWorksheetServices() {
  // 1. DocumentApp.create 権限の取得
  var doc = DocumentApp.create('Memoria_認可確認_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss'));
  doc.getBody().appendParagraph('Memoria WorksheetService の OAuth 認可確認用テスト Doc です。');
  doc.saveAndClose();
  Logger.log('[Auth] Doc created: ' + doc.getUrl());

  // 2. PDF 化 (DocumentApp + Drive 権限)
  var pdfBlob = doc.getAs('application/pdf').setName('test.pdf');
  Logger.log('[Auth] PDF blob size: ' + pdfBlob.getBytes().length + ' bytes');

  // 3. MailApp.sendEmail 権限の取得 (自分宛にテスト送信)
  var myEmail = Session.getActiveUser().getEmail();
  if (myEmail) {
    MailApp.sendEmail({
      to: myEmail,
      subject: '【Memoria】WorksheetService 認可確認',
      body: 'OAuth 認可テスト送信です。\n本メールが届いていれば WorksheetService の権限取得に成功しています。\n\n認可確認用 Doc URL: ' + doc.getUrl() + '\n(認可確認後にゴミ箱へ移動済み)',
      attachments: [pdfBlob]
    });
    Logger.log('[Auth] Test email sent to: ' + myEmail);
  } else {
    Logger.log('[Auth] No active user email');
  }

  // 4. 後始末: テスト Doc をゴミ箱へ
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log('[Auth] Test Doc moved to trash');
  Logger.log('[Auth] All scopes authorized successfully');
}
