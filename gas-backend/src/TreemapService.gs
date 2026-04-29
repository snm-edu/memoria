/**
 * Memoria ツリーマップサービス
 *
 * 学生個人用ツリーマップのデータを返す。
 * questions シート(出題マスタ) × category_stats(学習履歴) を
 * LEFT JOIN し、category > subcategory > subtopic のネスト構造で返却する。
 *
 * curriculum マスタは PWA 側にあるため、GAS は categories リストを
 * パラメータで受け取って大分類フィルタとして使う。
 */

const TreemapService = {
  /**
   * questions シートから (department, allowedCategories) で絞った
   * (category, subcategory, subtopic) ごとの問題数マスタを抽出する
   *
   * @param {Spreadsheet} ss
   * @param {string} department - 学科コード(例: 'clinical_eng')
   * @param {Array<string>} allowedCategories - 大分類のホワイトリスト
   * @return {Object} key=cat|||sub|||top, value={cat, sub, top, totalQuestions}
   */
  buildLeafMaster: function(ss, department, allowedCategories) {
    var sheet = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var allowedSet = {};
    allowedCategories.forEach(function(c) { allowedSet[c] = true; });

    var master = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx['department']] !== department) continue;
      var cat = row[idx['category']] || '';
      if (!allowedSet[cat]) continue;
      var sub = row[idx['subcategory']] || '未分類';
      var top = row[idx['subtopic']] || '未分類';
      var key = cat + '|||' + sub + '|||' + top;
      if (!master[key]) {
        master[key] = { cat: cat, sub: sub, top: top, totalQuestions: 0 };
      }
      master[key].totalQuestions++;
    }
    return master;
  },

  /**
   * category_stats シートから (category, subcategory, subtopic) ごとの学習結果マップを抽出する
   *
   * 照合の優先順位:
   * 1. studentNumber が指定された場合 → 学籍番号で全 UUID 行を集約
   *    (端末変更や再ログインで UUID が変わっても、同じ学籍番号なら履歴を引き継げる)
   * 2. studentNumber が空の場合 → studentId (UUID) で照合 (卒業生・学籍番号未登録ユーザー向けフォールバック)
   *
   * 同じ学籍番号で複数の UUID 行が存在する場合 (画像の例: snm の 91414810-... と 056c8ff4-...)、
   * 同一 (cat, sub, top) のキーで answered/correct を加算合計し、lastDate は最新を採用する。
   *
   * @param {Spreadsheet} ss
   * @param {string} studentId - UUID
   * @param {string} studentNumber - 学籍番号 (空文字可)
   * @return {Object} key=cat|||sub|||top, value={answered, correct, lastDate}
   */
  buildLearnedMap: function(ss, studentId, studentNumber) {
    var sheet = ss.getSheetByName('category_stats');
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var useNumber = !!studentNumber;
    var learned = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var match = useNumber
        ? row[idx['student_number']] === studentNumber
        : row[idx['student_id']] === studentId;
      if (!match) continue;

      var cat = row[idx['category']] || '';
      var sub = row[idx['subcategory']] || '未分類';
      var top = row[idx['subtopic']] || '未分類';
      var key = cat + '|||' + sub + '|||' + top;
      var answered = Number(row[idx['total_count']]) || 0;
      var correct = Number(row[idx['correct_count']]) || 0;
      var lastDate = row[idx['last_study_date']] || '';

      if (!learned[key]) {
        learned[key] = { answered: 0, correct: 0, lastDate: '' };
      }
      // 同じ学籍番号の複数 UUID 行を加算合計
      learned[key].answered += answered;
      learned[key].correct += correct;
      if (lastDate > learned[key].lastDate) learned[key].lastDate = lastDate;
    }
    return learned;
  },

  /**
   * マスタリーフ × 学習済みマップを LEFT JOIN し、
   * confidence (high/low/none) と correctRate を付与する
   *
   * @param {Object} master - buildLeafMaster の戻り値
   * @param {Object} learned - buildLearnedMap の戻り値
   * @return {Array<Object>} {cat, sub, top, totalQuestions, answered, correct, correctRate, confidence, lastDate}
   */
  mergeLeafs: function(master, learned) {
    var leafs = [];
    var keys = Object.keys(master);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var m = master[key];
      var l = learned[key];
      var leaf = {
        cat: m.cat,
        sub: m.sub,
        top: m.top,
        totalQuestions: m.totalQuestions,
        answered: 0,
        correct: 0,
        correctRate: null,
        confidence: 'none',
        lastDate: ''
      };
      if (l) {
        leaf.answered = l.answered;
        leaf.correct = l.correct;
        leaf.lastDate = l.lastDate;
        if (l.answered > 0) {
          leaf.correctRate = Math.round((l.correct / l.answered) * 100);
        }
        if (l.answered >= 5) {
          leaf.confidence = 'high';
        } else if (l.answered >= 1) {
          leaf.confidence = 'low';
        }
      }
      leafs.push(leaf);
    }
    return leafs;
  },

  /**
   * フラットなリーフ配列から category > subcategory > subtopic の
   * ネスト構造に変換する。親階層の totalQuestions, answered, correct,
   * correctRate も同時に集約する。
   *
   * @param {Array<Object>} leafs - mergeLeafs の戻り値
   * @return {Object} {name:'すべて', children:[...大分類...]}
   */
  buildTree: function(leafs) {
    var catMap = {};

    for (var i = 0; i < leafs.length; i++) {
      var leaf = leafs[i];
      var cat = leaf.cat;
      var sub = leaf.sub;

      if (!catMap[cat]) {
        catMap[cat] = {
          name: cat,
          subMap: {},
          totalQuestions: 0,
          answered: 0,
          correct: 0
        };
      }
      var catNode = catMap[cat];
      catNode.totalQuestions += leaf.totalQuestions;
      catNode.answered += leaf.answered;
      catNode.correct += leaf.correct;

      if (!catNode.subMap[sub]) {
        catNode.subMap[sub] = {
          name: sub,
          children: [],
          totalQuestions: 0,
          answered: 0,
          correct: 0
        };
      }
      var subNode = catNode.subMap[sub];
      subNode.totalQuestions += leaf.totalQuestions;
      subNode.answered += leaf.answered;
      subNode.correct += leaf.correct;

      subNode.children.push({
        name: leaf.top,
        totalQuestions: leaf.totalQuestions,
        answered: leaf.answered,
        correct: leaf.correct,
        correctRate: leaf.correctRate,
        confidence: leaf.confidence,
        lastDate: leaf.lastDate
      });
    }

    function ratePercent(correct, answered) {
      return answered > 0 ? Math.round((correct / answered) * 100) : null;
    }

    var rootChildren = [];
    var catKeys = Object.keys(catMap);
    for (var c = 0; c < catKeys.length; c++) {
      var cat = catMap[catKeys[c]];
      var subChildren = [];
      var subKeys = Object.keys(cat.subMap);
      for (var s = 0; s < subKeys.length; s++) {
        var sub = cat.subMap[subKeys[s]];
        subChildren.push({
          name: sub.name,
          totalQuestions: sub.totalQuestions,
          answered: sub.answered,
          correctRate: ratePercent(sub.correct, sub.answered),
          children: sub.children
        });
      }
      rootChildren.push({
        name: cat.name,
        totalQuestions: cat.totalQuestions,
        answered: cat.answered,
        correctRate: ratePercent(cat.correct, cat.answered),
        children: subChildren
      });
    }

    var totalQuestions = 0;
    var totalAnswered = 0;
    for (var i = 0; i < rootChildren.length; i++) {
      totalQuestions += rootChildren[i].totalQuestions;
      totalAnswered += rootChildren[i].answered;
    }

    return {
      name: 'すべて',
      totalQuestions: totalQuestions,
      answered: totalAnswered,
      children: rootChildren
    };
  },

  /**
   * ツリー内の同一親 (中分類) に属する confidence:'none' リーフが3件以上ある場合、
   * '+未着手N件' という isAggregate セルに集約する。
   *
   * 大分類はまとめない (Spec §6.3)。中分類セル内の小分類群のみ対象。
   * 学習が進むと自然にまとめセルが減り進捗実感に繋がる。
   *
   * @param {Object} tree - buildTree の戻り値
   * @return {Object} 同じ tree (in-place 改変)
   */
  aggregateUnstudied: function(tree) {
    var THRESHOLD = 3;
    if (!tree || !tree.children) return tree;

    for (var c = 0; c < tree.children.length; c++) {
      var cat = tree.children[c];
      if (!cat.children) continue;

      for (var s = 0; s < cat.children.length; s++) {
        var sub = cat.children[s];
        if (!sub.children) continue;

        var unstudied = [];
        var others = [];
        for (var l = 0; l < sub.children.length; l++) {
          var leaf = sub.children[l];
          if (leaf.confidence === 'none') unstudied.push(leaf);
          else others.push(leaf);
        }

        if (unstudied.length >= THRESHOLD) {
          var totalQ = 0;
          for (var u = 0; u < unstudied.length; u++) totalQ += unstudied[u].totalQuestions;
          var aggregate = {
            name: '+未着手' + unstudied.length + '件',
            totalQuestions: totalQ,
            answered: 0,
            correct: 0,
            correctRate: null,
            confidence: 'none',
            lastDate: '',
            isAggregate: true,
            aggregateLeaves: unstudied
          };
          sub.children = others.concat([aggregate]);
        }
      }
    }
    return tree;
  },

  /**
   * ツリーマップ用データ取得 (公開エントリ)
   *
   * @param {Object} params
   * @param {string} params.studentId
   * @param {string} params.studentNumber - 学籍番号 (推奨。空文字なら studentId フォールバック)
   * @param {string} params.department
   * @param {number} params.grade
   * @param {Array<string>} params.categories - PWA から渡される大分類ホワイトリスト
   * @return {Object} 成功時は生データ、失敗時は {error:string} (jsonResponse がラップ)
   */
  getStudentTreemap: function(params) {
    if (!params || !params.studentId) {
      return { error: 'studentId is required' };
    }
    if (!params.department) {
      return { error: 'department is required' };
    }
    if (!params.categories || !params.categories.length) {
      return { error: 'categories is required' };
    }

    try {
      var ss = getSpreadsheet();
      var master = this.buildLeafMaster(ss, params.department, params.categories);
      var learned = this.buildLearnedMap(ss, params.studentId, params.studentNumber || '');
      var leafs = this.mergeLeafs(master, learned);
      var tree = this.buildTree(leafs);
      tree = this.aggregateUnstudied(tree);

      return {
        studentId: params.studentId,
        studentNumber: params.studentNumber || '',
        department: params.department,
        grade: params.grade,
        updatedAt: new Date().toISOString(),
        totalQuestions: tree.totalQuestions,
        answered: tree.answered,
        tree: tree
      };
    } catch (e) {
      Logger.log('getStudentTreemap error: ' + e + '\n' + e.stack);
      return { error: String(e) };
    }
  },
};

// === 手動動作確認用関数 (GAS エディタから実行) ===

/**
 * Task 1: マスタリーフ抽出の確認
 */
function testBuildLeafMaster() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論', '生体機能代行装置学'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var keys = Object.keys(master);
  Logger.log('リーフ件数: ' + keys.length);
  Logger.log('サンプル(先頭3件):');
  for (var i = 0; i < Math.min(3, keys.length); i++) {
    Logger.log(keys[i] + ' => ' + JSON.stringify(master[keys[i]]));
  }
}

/**
 * Task 2: 学習済みマップの確認 (学籍番号集約モード)
 * studentNumber は実在する値 (例: 'snm') を入れる
 */
function testBuildLearnedMap() {
  var ss = getSpreadsheet();
  var learned = TreemapService.buildLearnedMap(ss, '', 'snm');
  var keys = Object.keys(learned);
  Logger.log('学習済み件数 (studentNumber=snm 集約): ' + keys.length);
  for (var i = 0; i < Math.min(3, keys.length); i++) {
    Logger.log(keys[i] + ' => ' + JSON.stringify(learned[keys[i]]));
  }
}

/**
 * Task 3: LEFT JOIN + confidence の確認
 */
function testMergeLeafs() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var learned = TreemapService.buildLearnedMap(ss, '', 'snm');
  var leafs = TreemapService.mergeLeafs(master, learned);

  var stats = { high: 0, low: 0, none: 0 };
  for (var i = 0; i < leafs.length; i++) stats[leafs[i].confidence]++;
  Logger.log('confidence分布: ' + JSON.stringify(stats));
  Logger.log('サンプル(highの先頭1件):');
  for (var i = 0; i < leafs.length; i++) {
    if (leafs[i].confidence === 'high') {
      Logger.log(JSON.stringify(leafs[i]));
      break;
    }
  }
}

/**
 * Task 4: ネスト構造化の確認
 */
function testBuildTree() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var learned = TreemapService.buildLearnedMap(ss, '', 'snm');
  var leafs = TreemapService.mergeLeafs(master, learned);
  var tree = TreemapService.buildTree(leafs);
  Logger.log('ルート totalQuestions: ' + tree.totalQuestions);
  Logger.log('大分類数: ' + tree.children.length);
  for (var i = 0; i < tree.children.length; i++) {
    var c = tree.children[i];
    Logger.log('  ' + c.name + ' total=' + c.totalQuestions
      + ' answered=' + c.answered + ' rate=' + c.correctRate
      + ' subCount=' + c.children.length);
  }
}

/**
 * Phase B Task 4: 未着手まとめセル化の確認
 */
function testAggregateUnstudied() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論', '生体機能代行装置学', '医用機械工学',
                 '医用機器安全管理学', '生体計測装置学', '医用治療機器学',
                 '生体物性材料工学', '臨床医学総論'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var learned = TreemapService.buildLearnedMap(ss, '', 'snm');
  var leafs = TreemapService.mergeLeafs(master, learned);
  var tree = TreemapService.buildTree(leafs);
  tree = TreemapService.aggregateUnstudied(tree);

  var aggCount = 0;
  for (var c = 0; c < tree.children.length; c++) {
    for (var s = 0; s < tree.children[c].children.length; s++) {
      var sub = tree.children[c].children[s];
      for (var l = 0; l < sub.children.length; l++) {
        if (sub.children[l].isAggregate) {
          aggCount++;
          Logger.log(tree.children[c].name + ' > ' + sub.name + ' > '
            + sub.children[l].name + ' (内包 '
            + sub.children[l].aggregateLeaves.length + ' 件, totalQ='
            + sub.children[l].totalQuestions + ')');
        }
      }
    }
  }
  Logger.log('まとめセル数: ' + aggCount);
}

/**
 * Task 5: 公開エントリの確認 (学籍番号で照合)
 */
function testGetStudentTreemap() {
  var result = TreemapService.getStudentTreemap({
    studentId: 'dummy-uuid',
    studentNumber: 'snm',
    department: 'clinical_eng',
    grade: 3,
    categories: ['医用電気電子工学', '医学概論', '生体機能代行装置学', '医用機械工学',
                 '医用機器安全管理学', '生体計測装置学', '医用治療機器学',
                 '生体物性材料工学', '臨床医学総論']
  });
  Logger.log(JSON.stringify(result, null, 2).substring(0, 1500));
}
