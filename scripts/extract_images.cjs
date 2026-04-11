const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dataDir = path.join(__dirname, '..', 'NRS国試data');
const outDir = path.join(__dirname, '..', 'pwa-frontend', 'public', 'images', 'questions');

// 出力ディレクトリ作成
fs.mkdirSync(outDir, { recursive: true });

// xlsxファイルをリスト
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));
console.log('xlsxファイル数:', files.length);

let totalImages = 0;
const imageMap = {}; // question_id -> image filename

for (const file of files) {
  const filePath = path.join(dataDir, file);

  // Python でZIP展開して画像抽出
  const script = `
import zipfile, os, sys, json
p = sys.argv[1]
outdir = sys.argv[2]
result = []
with zipfile.ZipFile(p, 'r') as z:
    media_files = [f for f in z.namelist() if f.startswith('xl/media/')]
    for mf in media_files:
        data = z.read(mf)
        fname = os.path.basename(mf)
        fpath = os.path.join(outdir, fname)
        with open(fpath, 'wb') as f:
            f.write(data)
        result.append({"file": fname, "size": len(data)})
print(json.dumps(result))
`;

  try {
    const result = execSync(
      `python3 -c '${script.replace(/'/g, "\\'")}' "${filePath}" "${outDir}"`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const images = JSON.parse(result.trim() || '[]');
    if (images.length > 0) {
      console.log(`\n${file}: ${images.length}枚`);
      for (const img of images) {
        console.log(`  ${img.file} (${Math.round(img.size/1024)}KB)`);
        totalImages++;

        // ファイル名から問題IDを推測
        // 例: nrs_14_pm0241.jpg → 2014_nrs_14_pm024
        const match = img.file.match(/nrs_(\d+)_(am|pm)(\d{3})/);
        if (match) {
          const year = 2000 + parseInt(match[1]);
          const period = match[2];
          const num = match[3];
          const questionId = `${year}_nrs_${match[1]}_${period}${num}`;
          imageMap[questionId] = img.file;
        }
      }
    }
  } catch (e) {
    console.error(`エラー: ${file}:`, e.message.substring(0, 100));
  }
}

console.log('\n=== 合計 ===');
console.log('抽出画像数:', totalImages);
console.log('問題リンク数:', Object.keys(imageMap).length);

// マッピングを保存
fs.writeFileSync(
  path.join(__dirname, 'output', 'image_map.json'),
  JSON.stringify(imageMap, null, 2)
);
console.log('\nimage_map.json を保存しました');

// マッピング内容を表示
for (const [qid, fname] of Object.entries(imageMap).sort()) {
  console.log(`  ${qid} → ${fname}`);
}
