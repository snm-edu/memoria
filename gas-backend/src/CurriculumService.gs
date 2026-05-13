/**
 * Memoria curriculum マスタ管理サービス
 *
 * curriculum シートは (department, grade, category) の3列で
 * 学科×学年ごとの出題範囲(大分類)を保持する。
 * 学年は累積前の単独学年を表現する (grade=2 の行は2年生の新規範囲のみ)。
 * loadAccumulatedCategories() で「その学年までに既習」の和集合を返す。
 *
 * PWA 側 public/data/curriculum/{dept}.json と同期して運用するが、
 * GAS バックエンド (Looker・日次バッチ) は本シートを真とする。
 *
 * 初回セットアップは seedCurriculumSheet() を GAS エディタから1回実行。
 */

const CurriculumService = {
  /**
   * curriculum シート全件読み込み
   *
   * @param {Spreadsheet} ss
   * @return {Object} {[department]: {[grade]: Set<category>}}
   */
  loadAll: function(ss) {
    var sheet = ss.getSheetByName(CONFIG.SHEETS.CURRICULUM);
    if (!sheet) {
      Logger.log('警告: curriculum シートが存在しません。seedCurriculumSheet() を実行してください。');
      return {};
    }
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var byDept = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var dept = row[idx['department']];
      var grade = Number(row[idx['grade']]);
      var category = row[idx['category']];
      if (!dept || !grade || !category) continue;
      if (!byDept[dept]) byDept[dept] = {};
      if (!byDept[dept][grade]) byDept[dept][grade] = {};
      byDept[dept][grade][category] = true;
    }
    return byDept;
  },

  /**
   * (department, grade) 指定でその学年までに累積される大分類リストを返す
   *
   * 例: grade=2 → 1年生 ∪ 2年生 のカテゴリ和集合
   *
   * @param {Object} loadAllResult - loadAll() の戻り値
   * @param {string} department
   * @param {number} grade
   * @return {Array<string>}
   */
  accumulate: function(loadAllResult, department, grade) {
    var deptData = loadAllResult[department] || {};
    var accumulated = {};
    for (var g = 1; g <= grade; g++) {
      var gData = deptData[g];
      if (!gData) continue;
      for (var cat in gData) accumulated[cat] = true;
    }
    return Object.keys(accumulated);
  },

  /**
   * 単発取得 (テスト・refreshStudentTreemap 等から呼び出す)
   *
   * @param {Spreadsheet} ss
   * @param {string} department
   * @param {number} grade
   * @return {Array<string>}
   */
  loadAccumulatedCategories: function(ss, department, grade) {
    var all = this.loadAll(ss);
    return this.accumulate(all, department, Number(grade) || 0);
  },
};

/**
 * curriculum シードデータ
 *
 * PWA 側 public/data/curriculum/{dept}.json と同期。
 * 学科または学年範囲を更新したらここを編集 → seedCurriculumSheet() を再実行。
 */
const CURRICULUM_SEED = {
  nursing: {
    1: ['人体の構造と機能', '基礎看護学', '必修問題'],
    2: [
      '人体の構造と機能', '疾病の成り立ちと回復の促進', '基礎看護学', '成人看護学',
      '老年看護学', '小児看護学', '母性看護学', '精神看護学', '在宅看護論',
      '在宅看護学', '地域・在宅看護論', '必修問題'
    ],
    3: [
      '人体の構造と機能', '疾病の成り立ちと回復の促進', '基礎看護学', '成人看護学',
      '老年看護学', '小児看護学', '母性看護学', '精神看護学', '在宅看護論',
      '在宅看護学', '地域・在宅看護論', '看護の統合と実践', '健康支援と社会保障制度',
      '必修問題'
    ],
  },
  clinical_eng: {
    1: ['医学概論', '医用電気電子工学'],
    2: [
      '医学概論', '医用電気電子工学', '医用機械工学', '生体物性材料工学',
      '生体計測装置学', '医用治療機器学', '生体機能代行装置学',
      '医用機器安全管理学', '臨床医学総論'
    ],
    3: [
      '医学概論', '医用電気電子工学', '医用機械工学', '生体物性材料工学',
      '生体機能代行装置学', '医用治療機器学', '生体計測装置学',
      '医用機器安全管理学', '臨床医学総論'
    ],
  },
  dental_hyg: {
    1: [
      '一般性状', '人体の構成成分', '細胞', '循環', '神経', '運動器系', '泌尿器系',
      '消化吸収', '歯と歯周組織', '顎・口腔', '概要', '歯科衛生業務', '基礎知識',
      '口腔の一般検査', '歯・口腔の状態把握法', '器具・材料', '前準備',
      '診療時の共同動作', '診療設備', '画像検査', '栄養素', '食品', '食生活の概要',
      '指導の要点', '免疫', '地域保健', '環境と健康', '保健所，市町村保健センター',
      '歯科疾患の指標'
    ],
    2: [
      '一般性状', '人体の構成成分', '細胞', '循環', '神経', '運動器系', '泌尿器系',
      '消化吸収', '歯と歯周組織', '顎・口腔', '概要', '歯科衛生業務', '基礎知識',
      '口腔の一般検査', '歯・口腔の状態把握法', '器具・材料', '前準備',
      '診療時の共同動作', '診療設備', '画像検査', '栄養素', '食品', '食生活の概要',
      '指導の要点', '免疫', '地域保健', '環境と健康', '保健所，市町村保健センター',
      '歯科疾患の指標', '腫瘍', '歯・口腔の嚢胞と腫瘍', '加齢変化', '化学療法',
      '局所麻酔薬', '末梢神経系作用薬物', '抗炎症薬', '身体と薬物', '感染と薬物',
      '麻酔', '生活習慣', '成人・高齢者保健', '母子歯科保健', '学校保健', '産業保健',
      '保健所，幼稚園', '在宅（居宅），介護・社会福祉施設', '疫学', '人口', '現況',
      '生活行動', '法規', '社会保険', '保存修復治療', '歯内療法', '根管処置',
      '歯髄処置', '窩洞形成', '成形修復', '仮封材', '合着・接着材', '印象材',
      '補綴装置の合着・装着', '床義歯', 'クラウン', '咬合採得', 'インプラント義歯',
      '矯正歯科治療の実際', '口腔外科治療', '小手術', '口腔・顎顔面・頭頸部',
      '止血処置', '全身麻酔及び鎮静', '生活歯漂白', 'う蝕', 'う蝕活動性試験',
      'フッ化物によるう蝕予防', 'フッ化物歯面塗布法', 'フッ化物洗口法',
      '小窩裂溝塡塞法', 'スケーリング・ルートプレーニング', '歯磨剤・洗口剤',
      'メインテナンス', '歯周病', '歯周病の基礎知識', '歯周治療', '歯周外科治療',
      '歯・歯周組織の検査', '歯・口腔の付着物，沈着物', '歯面清掃・研磨',
      '小児の歯科治療', '小児の疾病異常', '小児歯科患者の評価と対応',
      '小児歯科治療', '障害の種類と歯科的特徴',
      '障害者の摂食・嚥下障害とリハビリテーション', '障害者歯科治療',
      '高齢者の摂食・嚥下とリハビリテーション', '高齢者歯科治療',
      '全身疾患と歯科治療', '全身状態の把握', '生体検査', '臨床検査',
      '救急救命処置', '口腔領域の臨床検査', '対象疾患', '口腔機能の維持・向上',
      '食生活指導', '食生活の指導', '対象別の指導法', '歯科保健統計',
      '患者への対応', '医療安全管理', '消毒・滅菌', '感染症', '歯・歯周組織'
    ],
    3: [
      '一般性状', '人体の構成成分', '細胞', '循環', '神経', '運動器系', '泌尿器系',
      '消化吸収', '歯と歯周組織', '顎・口腔', '概要', '歯科衛生業務', '基礎知識',
      '口腔の一般検査', '歯・口腔の状態把握法', '器具・材料', '前準備',
      '診療時の共同動作', '診療設備', '画像検査', '栄養素', '食品', '食生活の概要',
      '指導の要点', '免疫', '地域保健', '環境と健康', '保健所，市町村保健センター',
      '歯科疾患の指標', '腫瘍', '歯・口腔の嚢胞と腫瘍', '加齢変化', '化学療法',
      '局所麻酔薬', '末梢神経系作用薬物', '抗炎症薬', '身体と薬物', '感染と薬物',
      '麻酔', '生活習慣', '成人・高齢者保健', '母子歯科保健', '学校保健', '産業保健',
      '保健所，幼稚園', '在宅（居宅），介護・社会福祉施設', '疫学', '人口', '現況',
      '生活行動', '法規', '社会保険', '保存修復治療', '歯内療法', '根管処置',
      '歯髄処置', '窩洞形成', '成形修復', '仮封材', '合着・接着材', '印象材',
      '補綴装置の合着・装着', '床義歯', 'クラウン', '咬合採得', 'インプラント義歯',
      '矯正歯科治療の実際', '口腔外科治療', '小手術', '口腔・顎顔面・頭頸部',
      '止血処置', '全身麻酔及び鎮静', '生活歯漂白', 'う蝕', 'う蝕活動性試験',
      'フッ化物によるう蝕予防', 'フッ化物歯面塗布法', 'フッ化物洗口法',
      '小窩裂溝塡塞法', 'スケーリング・ルートプレーニング', '歯磨剤・洗口剤',
      'メインテナンス', '歯周病', '歯周病の基礎知識', '歯周治療', '歯周外科治療',
      '歯・歯周組織の検査', '歯・口腔の付着物，沈着物', '歯面清掃・研磨',
      '小児の歯科治療', '小児の疾病異常', '小児歯科患者の評価と対応',
      '小児歯科治療', '障害の種類と歯科的特徴',
      '障害者の摂食・嚥下障害とリハビリテーション', '障害者歯科治療',
      '高齢者の摂食・嚥下とリハビリテーション', '高齢者歯科治療',
      '全身疾患と歯科治療', '全身状態の把握', '生体検査', '臨床検査',
      '救急救命処置', '口腔領域の臨床検査', '対象疾患', '口腔機能の維持・向上',
      '食生活指導', '食生活の指導', '対象別の指導法', '歯科保健統計',
      '患者への対応', '医療安全管理', '消毒・滅菌', '感染症', '歯・歯周組織'
    ],
  },
  orthoptist: {
    1: [
      '個体の構造', '感覚器', '脳・神経', '心臓、血管', '内分泌', '血液、造血器',
      '運動器', '生殖、発生の概要', '心身の成長・発達、加齢', '病態の基礎',
      '健康、疾病、障害の概念', '免疫機構', '視能訓練士の役割と義務', '眼薬理学',
      '生体と検査機器', '視能矯正と視覚生理学の基礎', '視能矯正と生理光学の基礎',
      '保健、医療、福祉、介護の推進', '視能障害のリハビリテーション',
      '視能矯正訓練の基本的知識', '視覚情報処理過程の概要',
      '視能検査法と検査機器の基礎', '両眼視機能と眼球運動', '斜視の基本的知識',
      '弱視の基本的知識'
    ],
    2: [
      '個体の構造', '感覚器', '脳・神経', '心臓、血管', '内分泌', '血液、造血器',
      '運動器', '生殖、発生の概要', '心身の成長・発達、加齢', '病態の基礎',
      '健康、疾病、障害の概念', '免疫機構', '視能訓練士の役割と義務', '眼薬理学',
      '生体と検査機器', '視能矯正と視覚生理学の基礎', '視能矯正と生理光学の基礎',
      '保健、医療、福祉、介護の推進', '視能障害のリハビリテーション',
      '視能矯正訓練の基本的知識', '視覚情報処理過程の概要',
      '視能検査法と検査機器の基礎', '両眼視機能と眼球運動', '斜視の基本的知識',
      '弱視の基本的知識', '主要眼疾患の基本的知識', '視能検査',
      '視能矯正訓練の知識と技術', '視能矯正訓練の対象となる視能障害',
      '視能矯正訓練の臨床心理概要', '公衆衛生学', '疾患の診断と治療',
      '視能矯正の枠組み', '遺伝', '失明予防',
      '視能検査の心理的、社会的側面についての配慮'
    ],
    3: [
      '個体の構造', '感覚器', '脳・神経', '心臓、血管', '内分泌', '血液、造血器',
      '運動器', '生殖、発生の概要', '心身の成長・発達、加齢', '病態の基礎',
      '健康、疾病、障害の概念', '免疫機構', '視能訓練士の役割と義務', '眼薬理学',
      '生体と検査機器', '視能矯正と視覚生理学の基礎', '視能矯正と生理光学の基礎',
      '保健、医療、福祉、介護の推進', '視能障害のリハビリテーション',
      '視能矯正訓練の基本的知識', '視覚情報処理過程の概要',
      '視能検査法と検査機器の基礎', '両眼視機能と眼球運動', '斜視の基本的知識',
      '弱視の基本的知識', '主要眼疾患の基本的知識', '視能検査',
      '視能矯正訓練の知識と技術', '視能矯正訓練の対象となる視能障害',
      '視能矯正訓練の臨床心理概要', '公衆衛生学', '疾患の診断と治療',
      '視能矯正の枠組み', '遺伝', '失明予防',
      '視能検査の心理的、社会的側面についての配慮'
    ],
  },
};

/**
 * 注意: PWA 側 curriculum.json は学年 N の categories に「学年 N までに既習の和集合」が
 * 入っている (例: clinical_eng grade=2 は medical_eng 1年範囲も含む)。
 * 一方この CURRICULUM_SEED もそれをそのまま転記している。
 * accumulate() は再度和集合を取るが冪等なので二重計上にはならない。
 * 将来的に「学年 N の新規範囲のみ」に切り替えたい場合は seed と PWA 側を同時に変更する。
 */

/**
 * curriculum シードを curriculum シートに書き込む
 * GAS エディタから手動実行 (1回 + 学年範囲変更時)
 */
function seedCurriculumSheet() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEETS.CURRICULUM);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.CURRICULUM);
  }
  sheet.clear();

  var headers = getSheetHeaders(CONFIG.SHEETS.CURRICULUM);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  var rows = [];
  var depts = Object.keys(CURRICULUM_SEED);
  for (var d = 0; d < depts.length; d++) {
    var dept = depts[d];
    var grades = CURRICULUM_SEED[dept];
    var gradeKeys = Object.keys(grades);
    for (var g = 0; g < gradeKeys.length; g++) {
      var grade = Number(gradeKeys[g]);
      var cats = grades[gradeKeys[g]];
      for (var c = 0; c < cats.length; c++) {
        rows.push([dept, grade, cats[c]]);
      }
    }
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  Logger.log('curriculum シード完了: ' + rows.length + '行');
}

/**
 * curriculum 読み込みの動作確認
 */
function testLoadCurriculum() {
  var ss = getSpreadsheet();
  var all = CurriculumService.loadAll(ss);
  var depts = Object.keys(all);
  Logger.log('学科数: ' + depts.length);
  for (var d = 0; d < depts.length; d++) {
    var dept = depts[d];
    Logger.log('  ' + dept + ':');
    var grades = Object.keys(all[dept]).sort();
    for (var g = 0; g < grades.length; g++) {
      var cats = Object.keys(all[dept][grades[g]]);
      Logger.log('    grade=' + grades[g] + ': ' + cats.length + ' categories');
    }
  }

  var sample = CurriculumService.loadAccumulatedCategories(ss, 'clinical_eng', 2);
  Logger.log('clinical_eng grade=2 累積: ' + sample.length + ' (' + sample.join(', ') + ')');
}
