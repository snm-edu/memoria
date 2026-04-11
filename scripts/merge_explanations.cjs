const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'output');

// questions.csv を読み込み
const qLines = fs.readFileSync(path.join(dir, 'questions.csv'), 'utf8').split('\n');
const qHeader = qLines[0];
const headers = qHeader.split(',');
const expIdx = headers.indexOf('explanation');
console.log('questions.csv: ヘッダー数', headers.length, ', explanation列:', expIdx);

// explanations_all.csv を読み込み
const eLines = fs.readFileSync(path.join(dir, 'explanations_all.csv'), 'utf8').split('\n');

// 解説マップ作成
const expMap = {};
for (let i = 1; i < eLines.length; i++) {
  const line = eLines[i];
  if (line.trim() === '') continue;
  const commaIdx = line.indexOf(',');
  const qid = line.substring(0, commaIdx);
  let exp = line.substring(commaIdx + 1);
  if (exp.startsWith('"') && exp.endsWith('"')) {
    try { exp = JSON.parse(exp); } catch(e) {}
  }
  expMap[qid] = exp;
}
console.log('解説マップ:', Object.keys(expMap).length, '件');

// CSVパーサー
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function escapeCSV(val) {
  if (val === undefined || val === null) return '';
  val = String(val);
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

// 結合
const outputLines = [qHeader];
let matched = 0, total = 0;
for (let i = 1; i < qLines.length; i++) {
  const line = qLines[i];
  if (line.trim() === '') continue;
  total++;
  const fields = parseCSVLine(line);
  const qid = fields[0];

  if (expMap[qid]) {
    fields[expIdx] = expMap[qid];
    matched++;
  } else {
    const baseId = qid.replace(/（.*?）/g, '');
    if (expMap[baseId]) {
      fields[expIdx] = expMap[baseId];
      matched++;
    }
  }

  outputLines.push(fields.map(f => escapeCSV(f)).join(','));
}

fs.writeFileSync(path.join(dir, 'questions_with_explanations.csv'), outputLines.join('\n'));
console.log('---');
console.log('マッチ:', matched, '/', total);
console.log('出力: questions_with_explanations.csv');
