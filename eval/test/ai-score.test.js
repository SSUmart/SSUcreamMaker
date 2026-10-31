import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../score.js';
import { scoreLabel, scoreQuestion, scoreSummary, summarizeLabels, summarizeQa } from '../ai/score.js';

const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gold = (name) => JSON.parse(fs.readFileSync(path.join(evalDir, 'ai', `${name}.json`), 'utf8'));
const textOf = (file) => {
  const html = fs.readFileSync(path.join(evalDir, 'shop', file), 'utf8');
  return normalize(html.slice(html.indexOf('<body>')).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' '));
};
const has = (text, word) => text.includes(normalize(word));

// --- 채점 규칙

test('질문 응답: 정답 사실이 모두 있으면 맞음, 하나라도 빠지면 틀림, 답을 못 찾으면 놓침', () => {
  const q = { must: [['3,000원'], ['30,000원']], evidence: '배송비 3,000원' };
  const paragraphs = ['가격', '배송비 3,000원 (30,000원 이상 무료)'];
  assert.deepEqual(scoreQuestion(q, { found: true, answer: '배송비는 3000원, 30,000원 이상 무료', sources: [2] }, { paragraphs }), {
    verdict: 'correct',
    answerable: true,
    evidenceOk: true
  });
  assert.equal(scoreQuestion(q, { found: true, answer: '3,000원입니다', sources: [1] }, { paragraphs }).verdict, 'wrong');
  assert.equal(scoreQuestion(q, { found: true, answer: '3,000원, 30,000원', sources: [1] }, { paragraphs }).evidenceOk, false);
  assert.equal(scoreQuestion(q, { found: false, answer: '페이지에서 찾지 못했습니다.', sources: [] }).verdict, 'missed');
});

test('질문 응답: 답 없는 질문은 찾지 못함이 바르고, 답하면 지어냄. 이미지를 보라는 안내는 바름', () => {
  const q = { must: null, alsoOk: ['이미지'] };
  assert.equal(scoreQuestion(q, { found: false }).verdict, 'abstained');
  assert.equal(scoreQuestion(q, { found: true, answer: '7일 이내입니다.' }).verdict, 'fabricated');
  assert.equal(scoreQuestion(q, { found: true, answer: '상세정보 이미지를 참고하라고 적혀 있습니다.' }).verdict, 'referred');
});

test('질문 응답: --detail이면 상세 이미지 정답(detailMust)으로 채점하고 근거 위치는 보지 않는다', () => {
  const q = { must: null, detailMust: [['320g']], evidence: '무게' };
  assert.equal(scoreQuestion(q, { found: true, answer: '320g입니다.' }).verdict, 'fabricated');
  assert.deepEqual(scoreQuestion(q, { found: true, answer: '320g입니다.', sources: [] }, { detail: true }), {
    verdict: 'correct',
    answerable: true,
    evidenceOk: null
  });
  // 상세 이미지에도 답이 없는 질문
  assert.equal(scoreQuestion({ must: null, detailMust: null }, { found: false }, { detail: true }).verdict, 'abstained');
});

test('요약: 핵심 사실 포함 비율과 지어낸 말, 근거 없는 항목을 센다', () => {
  const g = {
    facts: [
      { id: 'price', any: ['24,900원'] },
      { id: 'shipping', any: ['3,000원'] }
    ],
    detailOnly: ['식기세척기'],
    neverOnPage: ['보증']
  };
  const result = { overview: '텀블러', items: [{ text: '판매가 24900원', sources: [7] }, { text: '식기세척기 사용 불가', sources: [] }] };
  assert.deepEqual(scoreSummary(g, result), {
    total: 2,
    coverage: 0.5,
    missing: ['shipping'],
    fabricated: ['식기세척기'],
    items: 2,
    itemsWithoutSource: 1
  });
  assert.deepEqual(scoreSummary(g, result, { detail: true }).fabricated, []);
});

test('자동 보완: 맞음·확신 낮음·경고·틀림과 위험한 오답·헛경보', () => {
  const reset = { accept: ['초기화', '삭제'], destructive: true };
  const share = { accept: ['공유'] };
  assert.equal(scoreLabel(share, '공유하기').verdict, 'correct');
  assert.equal(scoreLabel(share, '공유하기일 수 있음').verdict, 'unsure');
  assert.deepEqual(scoreLabel(reset, '용도 불명확, delete 관련일 수 있음'), { verdict: 'warned', dangerous: false, falseAlarm: false });
  assert.deepEqual(scoreLabel(reset, '찜하기'), { verdict: 'wrong', dangerous: true, falseAlarm: false });
  assert.deepEqual(scoreLabel(share, '삭제'), { verdict: 'wrong', dangerous: false, falseAlarm: true });
});

test('묶어 세기: 오류는 비율에서 빼고, 지어낸 답·위험한 오답을 따로 센다', () => {
  const qa = summarizeQa([
    { ok: true, answerable: true, verdict: 'correct', evidenceOk: true },
    { ok: true, answerable: true, verdict: 'missed', evidenceOk: null },
    { ok: true, answerable: false, verdict: 'fabricated', evidenceOk: null },
    { ok: false }
  ]);
  assert.deepEqual(qa, {
    asked: 4,
    errors: 1,
    answerable: 2,
    correct: 1,
    accuracy: 0.5,
    wrong: 0,
    missed: 1,
    unanswerable: 1,
    fabricated: 1,
    evidenceAccuracy: 1
  });
  const labels = summarizeLabels([
    { ok: true, hint: 'hint', verdict: 'correct' },
    { ok: true, hint: 'hint', verdict: 'unsure' },
    { ok: true, hint: 'none', verdict: 'wrong', destructive: true, dangerous: true },
    { ok: true, hint: 'hint', verdict: 'warned', destructive: true }
  ]);
  assert.equal(labels.accuracy, 0.5);
  assert.equal(labels.dangerous, 1);
  assert.equal(labels.destructive, 2);
  assert.deepEqual(labels.byHint, { hint: { total: 3, right: 2 }, none: { total: 1, right: 0 } });
});

// --- 정답지가 원문과 맞는지 (정답지를 고치거나 쇼핑몰을 고치면 함께 확인)

test('질문 응답 정답지: 답 있는 질문의 정답과 근거는 쇼핑몰 페이지에, 상세 이미지 정답은 상세 이미지 원본에 있다', () => {
  const page = textOf('index.html');
  const detail = textOf('detail/detail.html');
  for (const q of gold('qa').questions) {
    for (const alternatives of q.must ?? []) {
      assert.ok(alternatives.some((w) => has(page, w)), `${q.id}: 페이지에 없는 정답 ${alternatives}`);
    }
    if (q.evidence) assert.ok(has(page, q.evidence), `${q.id}: 페이지에 없는 근거 ${q.evidence}`);
    for (const alternatives of q.detailMust ?? []) {
      assert.ok(alternatives.some((w) => has(detail, w)), `${q.id}: 상세 이미지에 없는 정답 ${alternatives}`);
    }
  }
});

test('요약 정답지: 핵심 사실은 페이지에, detailOnly는 상세 이미지에만, neverOnPage는 어디에도 없다', () => {
  const page = textOf('index.html');
  const detail = textOf('detail/detail.html');
  const g = gold('summary');
  for (const f of g.facts) assert.ok(f.any.some((w) => has(page, w)), `페이지에 없는 핵심 사실 ${f.id}`);
  for (const w of g.detailOnly) {
    assert.ok(has(detail, w) && !has(page, w), `상세 이미지에만 있어야 하는 말: ${w}`);
  }
  for (const w of g.neverOnPage) assert.ok(!has(page, w) && !has(detail, w), `페이지에 있는 말: ${w}`);
});

test('자동 보완 정답지: 요소마다 페이지에 하나씩 있고 정답 후보가 있다', () => {
  for (const { page, items } of gold('label').pages) {
    const html = fs.readFileSync(path.join(evalDir, 'shop', path.basename(page)), 'utf8');
    for (const item of items) {
      assert.ok(item.accept?.length, `${item.id}: 정답 후보 없음`);
      assert.ok(['hint', 'image', 'none'].includes(item.hint), `${item.id}: hint 값`);
      const evalId = item.selector.match(/^\[data-eval=([\w-]+)\]$/)?.[1];
      const marker = evalId ? `data-eval="${evalId}"` : item.selector.startsWith('#') ? `id="${item.selector.slice(1)}"` : `class="${item.selector.slice(1)}"`;
      assert.equal(html.split(marker).length - 1, 1, `${item.id}: 페이지에서 ${marker}가 하나가 아님`);
    }
  }
});
