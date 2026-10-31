import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, percentile, scoreCase, summarize, summarizeCases, toMarkdown } from '../score.js';

const sections = [
  { title: '가격·할인', items: ['정가 39,000 원'] },
  { title: '기타', items: ['면 100%'] }
];

test('띄어쓰기·쉼표·대소문자 차이는 무시한다', () => {
  assert.equal(normalize('39,000 원 ABC'), '39000원abc');
});

test('인식률과 분류 정확도를 따로 센다', () => {
  const score = scoreCase(sections, {
    '가격·할인': ['39000원'],
    '소재·성분': ['면 100%'],
    주의사항: ['세탁기 사용 불가']
  });
  assert.equal(score.total, 3);
  assert.equal(score.recall, 2 / 3);
  assert.equal(score.sectionAccuracy, 1 / 3);
  assert.deepEqual(score.missing, ['주의사항: 세탁기 사용 불가']);
  assert.deepEqual(score.misplaced, ['소재·성분: 면 100%']);
});

test('정답이 없으면 비율은 null', () => {
  assert.equal(scoreCase(sections, {}).recall, null);
});

test('공급자별 요약: 실패 사례는 비율과 시간에서 빼고 오류로 센다', () => {
  const results = [
    { provider: 'gemini', caseId: 'a', ok: true, ms: 1000, score: { total: 2, recall: 1, sectionAccuracy: 0.5 } },
    { provider: 'gemini', caseId: 'b', ok: true, ms: 3000, score: { total: 2, recall: 0.5, sectionAccuracy: 0.5 } },
    { provider: 'gemini', caseId: 'c', ok: false, error: '차단' }
  ];
  const [summary] = summarize(results);
  assert.deepEqual(summary, {
    provider: 'gemini',
    cases: 3,
    errors: 1,
    recall: 0.75,
    minRecall: 0.5,
    sectionAccuracy: 0.5,
    medianMs: 2000,
    p95Ms: 3000
  });
  const md = toMarkdown([summary], results);
  assert.match(md, /\| gemini \| 3 \| 1 \| 75% \| 50% \| 2\.0초 \| 3\.0초 \|/);
  assert.match(md, /\| gemini \| c \| 1 \| 실패 .*\| 차단 \|/);
  // 한 번씩만 돌렸으면 사례별 반복 표는 없다
  assert.doesNotMatch(md, /인식률 최저/);
});

test('p95는 가장 가까운 순위로 고르고, 값이 없으면 null', () => {
  const times = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
  assert.equal(percentile(times, 95), 1900);
  assert.equal(percentile(times, 50), 1000);
  assert.equal(percentile([5000, 1000], 95), 5000);
  assert.equal(percentile([], 95), null);
});

test('반복 실행: 사례마다 묶어 평균·최저·실패를 따로 센다', () => {
  const results = [
    { provider: 'gemini', caseId: 'a', run: 1, ok: true, ms: 1000, score: { total: 2, recall: 1, sectionAccuracy: 1 } },
    { provider: 'gemini', caseId: 'b', run: 1, ok: false, error: '시간 초과' },
    { provider: 'gemini', caseId: 'a', run: 2, ok: true, ms: 3000, score: { total: 2, recall: 0.5, sectionAccuracy: 0.5 } },
    { provider: 'gemini', caseId: 'b', run: 2, ok: true, ms: 2000, score: { total: 1, recall: 1, sectionAccuracy: 1 } }
  ];
  const [a, b] = summarizeCases(results);
  assert.deepEqual(a, {
    provider: 'gemini',
    caseId: 'a',
    runs: 2,
    errors: 0,
    recall: 0.75,
    minRecall: 0.5,
    sectionAccuracy: 0.75,
    medianMs: 2000,
    p95Ms: 3000
  });
  assert.equal(b.runs, 2);
  assert.equal(b.errors, 1);
  assert.equal(b.recall, 1);

  const md = toMarkdown(summarize(results), results);
  assert.match(md, /\| gemini \| a \| 2 \| 0 \| 75% \| 50% \| 75% \| 2\.0초 \| 3\.0초 \|/);
  assert.match(md, /\| gemini \| b \| 1 \| 실패 .*\| 시간 초과 \|/);
});
