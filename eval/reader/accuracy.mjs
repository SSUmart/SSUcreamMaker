// 읽기 정확성 측정: 평가용 쇼핑몰을 온글 읽기 엔진(model.js)으로 읽기 목록으로 만들고, 사람이 만든 정답표
// (shop-expected.json, 순서·종류·이름·상태)와 항목 단위로 비교한다. 상태가 바뀐 뒤와 숨겨져 있던 탭,
// 상세 이미지 안내(alt="" 상세 이미지)와 상세 이미지 읽기 결과가 있을 때도 본다.
// 사용법: eval 폴더에서 npm run reader:accuracy   (API 키 불필요)
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveShop } from '../shop/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = path.resolve(here, '../../extension/content/reader/model.js');
const { scenarios } = JSON.parse(fs.readFileSync(path.join(here, 'shop-expected.json'), 'utf8'));

// 두 목록을 순서대로 맞춰(최장 공통 부분 수열) 맞은 것, 틀리게 읽은 것, 빠진 것, 더 읽은 것을 나눈다
function compare(expected, actual) {
  const n = expected.length;
  const m = actual.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = expected[i] === actual[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const missing = [];
  const extra = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (expected[i] === actual[j]) {
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) missing.push(expected[i++]);
    else extra.push(actual[j++]);
  }
  missing.push(...expected.slice(i));
  extra.push(...actual.slice(j));
  // 빠진 것과 더 읽은 것이 짝을 이루면 "틀리게 읽음"으로 본다
  const wrong = [];
  while (missing.length && extra.length) wrong.push({ expected: missing.shift(), actual: extra.shift() });
  return { correct: lcs[0][0], wrong, missing, extra };
}

const server = http.createServer((req, res) => {
  if (!serveShop(req, res)) {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/shop/`;
const browser = await chromium.launch({ channel: 'chromium' });

let total = 0;
let correct = 0;
let failed = false;
for (const scenario of scenarios) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR' });
  await page.goto(url);
  for (const step of scenario.steps) {
    if (step.check) await page.check(step.check);
    if (step.click) await page.click(step.click);
    if (step.script) await page.evaluate(step.script);
  }
  await page.addScriptTag({ path: MODEL });
  const actual = await page.evaluate((scope) => {
    const root = document.querySelector(scope);
    return globalThis.__ongeul.model
      .buildItems()
      .filter((item) => root.contains(item.el))
      .map((item) => item.phrase);
  }, scenario.scope);
  const result = compare(scenario.expect, actual);
  total += scenario.expect.length;
  correct += result.correct;
  const ok = result.correct === scenario.expect.length && !result.extra.length && !result.wrong.length;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${scenario.name}: ${result.correct}/${scenario.expect.length}`);
  for (const w of result.wrong) console.log(`  틀림  정답 "${w.expected}"\n        읽음 "${w.actual}"`);
  for (const text of result.missing) console.log(`  빠짐  "${text}"`);
  for (const text of result.extra) console.log(`  더 읽음 "${text}"`);
  await page.close();
}
console.log(`\n읽기 정확성: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)`);
await browser.close();
server.close();
process.exitCode = failed ? 1 : 0;
