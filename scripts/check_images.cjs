const fs = require('fs');
const qs = JSON.parse(fs.readFileSync(__dirname + '/output/questions.json', 'utf8'));
const withImage = qs.filter(q => q.has_image === true);
console.log('画像ありの問題数:', withImage.length, '/ 全', qs.length, '問');
console.log('');

const byYear = {};
for (const q of withImage) {
  if (!byYear[q.exam_year]) byYear[q.exam_year] = [];
  byYear[q.exam_year].push(q);
}
for (const [year, qs2] of Object.entries(byYear).sort()) {
  console.log(year + '年: ' + qs2.length + '問');
  for (const q of qs2) {
    console.log('  ' + q.question_id + ' | ' + q.question_text.substring(0, 60));
  }
}

// CSV出力
const csv = ['question_id,exam_year,exam_number,question_text_preview'];
for (const q of withImage) {
  csv.push(q.question_id + ',' + q.exam_year + ',' + q.exam_number + ',' + JSON.stringify(q.question_text.substring(0, 80)));
}
fs.writeFileSync(__dirname + '/output/image_questions.csv', csv.join('\n'));
console.log('\n画像問題リストを output/image_questions.csv に出力しました');
