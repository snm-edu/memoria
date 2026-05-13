/**
 * 解説と正答の不一致を修正するスクリプト
 * 8件の genuine mismatch を修正する
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../public/data/questions');

// 修正対象と修正後の解説
const FIXES = [
  {
    dept: 'dental_hyg',
    id: '2015_dh_15_pm057',
    newExplanation: '手づかみ食べ機能の本格化は離乳後期〜完了期（約9〜12か月頃）であり、この時期に萌出するのは第一乳臼歯（約12〜16か月）が正答である。乳中切歯は6〜10か月、乳側切歯は7〜12か月に萌出するが、咀嚼運動を伴う手づかみ食べの獲得と歯の萌出を対応させると第一乳臼歯が最も適切である。第二乳臼歯の萌出は約2歳頃と遅い。',
  },
  {
    dept: 'orthoptist',
    id: '2016_co_16_am069',
    newExplanation: '網膜色素変性症に特徴的な輪状暗点を検索するには、V/4（A）とIII/4（B）の2つの視標を用いる。V/4は大きな視標で輪状暗点の外側境界（周辺視野の外縁）を、III/4は中等度の視標で暗点の内側境界を確認するために使用する。II/4・I/4・I/2はより小さい視標で、中心視野の詳細や暗点内の残存視野の確認に用いる。',
  },
  {
    dept: 'orthoptist',
    id: '2016_co_16_am070',
    newExplanation: '間欠性外斜視が疑われる症例では、screen-comitance test（B）と屈折検査（C）が診断に必要である。screen-comitance testは偏位の共同性を評価し斜視の性状を把握する。屈折検査は潜伏遠視や近視による調節性因子の有無を確認するために不可欠。Hess赤緑試験は麻痺性斜視の評価用、調節近点検査は輻湊不全の評価に使用する。',
  },
  {
    dept: 'orthoptist',
    id: '2016_co_16_pm027',
    newExplanation: '調節性輻湊（AC/A比）の測定には大型弱視鏡（B）とプリズム（D）を使用する。プリズムを用いた遮閉試験（gradient法）では異なる度数のレンズ負荷前後の偏位量をプリズムで測定しAC/A比を算出する。大型弱視鏡ではヘテロフォリア測定法によりAC/A比を算出できる。アコモドポリレコーダは調節の動態記録装置、レフラクトメータは屈折測定器で、AC/A比測定には直接使用しない。',
  },
  {
    dept: 'orthoptist',
    id: '2016_co_16_pm045',
    newExplanation: '病的眼振は解離性眼振（A）と眼位性眼振（B）である。解離性眼振は両眼で異なる性状の眼振を示し、MLF症候群（核間性眼筋麻痺）などの中枢性病変で見られる。眼位性眼振は注視方向によって現れる眼振で、中枢性病変や薬物による場合に病的となる。視運動性眼振（C）・終末位眼振（D）は生理的。頭位変換眼振（E）は良性発作性頭位めまい症でみられるが、後半規管由来の場合は生理的分類に含める。',
  },
  {
    dept: 'orthoptist',
    id: '2016_co_16_pm055',
    newExplanation: '視覚障害の身体障害者手帳における視野障害の認定にはGoldmann視野計のI/4（C）とI/2（E）イソプタが使用される。I/4イソプタで測定した視野の狭窄程度と、I/2イソプタで測定した中心視野を基準に障害等級が判定される。V/4やIII/4は大きな視標で周辺視野の外側限界の確認に用いるが、身体障害認定の基準視標ではない。',
  },
  {
    dept: 'orthoptist',
    id: '2017_co_17_pm057',
    newExplanation: '抑制除去訓練には赤フィルタ（A）と絆創膏型遮閉具（C）が用いられる。赤フィルタは抑制眼（弱視眼）に装用することで単眼視を促し、抑制を段階的に除去する。絆創膏型遮閉具（部分遮閉）は優位眼の中心部のみを遮蔽し弱視眼・抑制眼の積極的使用を促す方法である。オイチスコープは偏心固視の治療、Bagolini線条レンズは両眼視機能の検査、Bagolini赤フィルタバーは両眼視の評価・訓練に使用する。',
  },
  {
    dept: 'orthoptist',
    id: '2017_co_17_pm060',
    newExplanation: '斜視手術が適応となるのは開散麻痺（A）と斜位近視（C）である。開散麻痺は外転神経麻痺等が原因の内斜視で、プリズム療法で対応できない場合や先天性の場合に手術適応となる。斜位近視は外斜位によって生じる仮性近視で、斜視手術により外斜位を矯正することで近視症状の改善が期待できる。γ角異常・潜伏遠視は手術適応外、潜伏眼振は頭位代償のための手術適応となる場合があるが、今回の正答には含まれない。',
  },
];

let fixedCount = 0;
const deptCache = {};

for (const fix of FIXES) {
  if (!deptCache[fix.dept]) {
    const path = join(dataDir, `${fix.dept}.json`);
    deptCache[fix.dept] = { path, data: JSON.parse(readFileSync(path, 'utf-8')) };
  }

  const { data } = deptCache[fix.dept];
  const q = data.find(q => q.question_id === fix.id);

  if (!q) {
    console.error(`NOT FOUND: ${fix.id}`);
    continue;
  }

  const oldExpl = q.explanation;
  q.explanation = fix.newExplanation;
  fixedCount++;
  console.log(`✅ 修正: [${fix.dept}] ${fix.id}`);
  console.log(`   旧: ${oldExpl.slice(0, 60)}...`);
  console.log(`   新: ${fix.newExplanation.slice(0, 60)}...`);
}

// 変更されたファイルを保存
for (const [dept, { path, data }] of Object.entries(deptCache)) {
  writeFileSync(path, JSON.stringify(data), 'utf-8');
  console.log(`\n💾 保存: ${dept}.json`);
}

console.log(`\n合計 ${fixedCount}/${FIXES.length} 件の解説を修正しました。`);
