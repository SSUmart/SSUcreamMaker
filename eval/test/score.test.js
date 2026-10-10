import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, scoreCase, summarize, toMarkdown } from '../score.js';

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
    sectionAccuracy: 0.5,
    medianMs: 2000
  });
  const md = toMarkdown([summary], results);
  assert.match(md, /\| gemini \| 3 \| 1 \| 75% \| 50% \| 2\.0초 \|/);
  assert.match(md, /\| gemini \| c \| 실패 .*\| 차단 \|/);
});
