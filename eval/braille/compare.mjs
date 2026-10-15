// 온글 한국 점자 변환 정확도 확인.
// 1) 한국 점자 규정(2024) 예문: 규정에 실린 정답과 비교한다 (기준).
// 2) liblouis(개발용 참고): 같은 문장을 liblouis로도 바꿔 비교한다. liblouis가 규정과 다른 경우도 있어 참고로만 쓴다.
// 사용법: eval 폴더에서 npm run braille   (2번은 liblouis 필요: macOS는 brew install liblouis. 없으면 1번만 함)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../extension/content/reader/hangul-braille.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { hangulBraille } = globalThis.__ongeul;

// 점자 ASCII(북미 표준) → 점자 칸. 규정 예문의 점자는 이 방식으로 적혀 있다(` 는 빈칸).
const BRF = ' a1b\'k2l@cif/msp"e3h9o6r^djg>ntq,*5<-u8v.%[$+x!&;:4\\0z7(_?w]#y)=';
// 소문자 쪽 기호 { | } ~ 는 [ \ ] ^ 와 같은 점형이다. 규정 PDF는 빈칸을 ` 로 적었다.
const BRF_ALIAS = { '{': '[', '|': '\\', '}': ']', '~': '^', '`': ' ' };
const brfToUnicode = (brf) =>
  [...brf.toLowerCase()]
    .map((ch) => {
      const index = BRF.indexOf(BRF_ALIAS[ch] ?? ch);
      if (index < 0) throw new Error(`점자 ASCII에 없는 글자: ${ch}`);
      return String.fromCodePoint(0x2800 + index);
    })
    .join('');

const rule = JSON.parse(fs.readFileSync(path.join(here, 'rule-examples.json'), 'utf8'));
let ruleSame = 0;
const ruleDiffs = [];
for (const { text, brf, rule: article } of rule.examples) {
  const ours = hangulBraille.toUnicode(hangulBraille.translate(text).cells);
  const expected = brfToUnicode(brf);
  if (ours === expected) ruleSame++;
  else ruleDiffs.push({ text, article, ours, expected });
}
console.log(`[1] 한국 점자 규정 예문 (2종): 일치 ${ruleSame}/${rule.examples.length}`);
for (const d of ruleDiffs) console.log(`  제${d.article}항 ${d.text}\n    온글 ${d.ours}\n    규정 ${d.expected}`);
console.log('');
const { sentences } = JSON.parse(fs.readFileSync(path.join(here, 'sentences.json'), 'utf8'));
const TABLES = { 2: 'ko-g2.ctb', 1: 'ko-g1.ctb' };

let louisMissing = false;
function louis(text, grade) {
  if (louisMissing) return null;
  try {
    return execFileSync('lou_translate', ['--forward', `unicode.dis,${TABLES[grade]}`], { input: text, encoding: 'utf8' }).replace(/\n$/, '');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('[2] lou_translate를 찾지 못해 liblouis 비교는 건너뜁니다 (macOS: brew install liblouis).');
      louisMissing = true;
      return null;
    }
    throw error;
  }
}

const dots = (unicode) => [...unicode].map((ch) => hangulBraille.dotNumbers(ch.codePointAt(0) - 0x2800)).join('-');
let total = 0;
let same = 0;
const diffs = [];
for (const grade of [2, 1]) {
  for (const text of sentences) {
    total++;
    const ours = hangulBraille.toUnicode(hangulBraille.translate(text, { grade }).cells);
    const ref = louis(text, grade).replace(/⠀+$/, '');
    if (ours === ref) same++;
    else diffs.push({ grade, text, ours, ref });
  }
}
if (!louisMissing) console.log(`[2] liblouis 참고 비교: 일치 ${same}/${total} (${((same / total) * 100).toFixed(1)}%)\n`);
for (const d of diffs) {
  console.log(`[${d.grade}종] ${d.text}`);
  console.log(`  온글    ${d.ours}  ${dots(d.ours)}`);
  console.log(`  liblouis ${d.ref}  ${dots(d.ref)}`);
}
const out = path.join(here, '..', 'results');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'braille-compare.json'), JSON.stringify({ rule: { total: rule.examples.length, same: ruleSame, diffs: ruleDiffs }, liblouis: { total, same, diffs } }, null, 2));
if (ruleDiffs.length) process.exitCode = 1;
