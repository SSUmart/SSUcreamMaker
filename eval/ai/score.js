// AI 기능(A1 자동 보완, A3 요약, A4 질문 응답) 결과를 정답지(eval/ai/*.json)와 비교한다.
// 말 비교는 상세 이미지 평가와 같이 띄어쓰기·쉼표·대소문자 차이를 무시한다.
import { normalize } from '../score.js';

const hasAny = (text, words = []) => {
  const t = normalize(text ?? '');
  return words.some((w) => t.includes(normalize(w)));
};

// 온글이 파괴적 동작 교차 검증에서 쓰는 말과 같게 둔다 (extension/content/reader/ai.js의 DESTRUCTIVE_WORD)
const DESTRUCTIVE_WORD = /(삭제|지우|제거|취소|탈퇴|결제|구매|주문|로그아웃|해지|비우|휴지통|초기화)/;

// --- A4 질문 응답
// verdict: correct 맞음 / wrong 답했지만 정답 사실이 빠짐(표현이 달라 틀리게 나왔을 수 있어 사람이 확인) /
//          missed 답이 있는데 찾지 못함 / abstained 답이 없어 찾지 못함(바른 동작) /
//          referred 답이 없는데 "이미지를 보라"처럼 안내만 함(바른 동작) / fabricated 답이 없는데 지어냄
export function expectedFacts(question, { detail = false } = {}) {
  return detail && 'detailMust' in question ? question.detailMust : question.must;
}

export function scoreQuestion(question, result, { detail = false, paragraphs = [] } = {}) {
  const must = expectedFacts(question, { detail });
  const found = Boolean(result?.found);
  let verdict;
  if (!must) {
    if (!found) verdict = 'abstained';
    else verdict = hasAny(result.answer, question.alsoOk) ? 'referred' : 'fabricated';
  } else if (!found) {
    verdict = 'missed';
  } else {
    verdict = must.every((alternatives) => hasAny(result.answer, alternatives)) ? 'correct' : 'wrong';
  }
  // 근거 위치: 답을 했고 정답지에 근거 글이 있으면, AI가 고른 근거 문단 중 하나에 그 글이 있어야 한다
  let evidenceOk = null;
  if (found && must && question.evidence && !(detail && 'detailMust' in question)) {
    evidenceOk = (result.sources ?? []).some((n) => hasAny(paragraphs[n - 1], [question.evidence]));
  }
  return { verdict, answerable: Boolean(must), evidenceOk };
}

// --- A3 요약
export function scoreSummary(gold, result, { detail = false } = {}) {
  const items = result?.items ?? [];
  const text = [result?.overview ?? '', ...items.map((i) => i.text)].join('\n');
  const missing = gold.facts.filter((f) => !hasAny(text, f.any)).map((f) => f.id);
  const fabricated = [...(detail ? [] : gold.detailOnly ?? []), ...(gold.neverOnPage ?? [])].filter((w) => hasAny(text, [w]));
  return {
    total: gold.facts.length,
    coverage: gold.facts.length ? (gold.facts.length - missing.length) / gold.facts.length : null,
    missing,
    fabricated,
    items: items.length,
    itemsWithoutSource: items.filter((i) => !i.sources?.length).length
  };
}

// --- A1 자동 보완
// final은 사용자가 실제로 듣는 이름(교차 검증과 확신 정도를 반영한 것).
// verdict: correct 맞음 / unsure 맞지만 "~일 수 있음"으로 읽음 / warned "용도 불명확"으로 경고함 / wrong 틀림
export function scoreLabel(gold, final) {
  let verdict;
  if (final.startsWith('용도 불명확')) verdict = 'warned';
  else if (!hasAny(final, gold.accept)) verdict = 'wrong';
  else verdict = final.endsWith('일 수 있음') ? 'unsure' : 'correct';
  return {
    verdict,
    // 위험한 오답: 되돌리기 어려운 동작을 경고 없이 다른 동작으로 읽음
    dangerous: Boolean(gold.destructive) && verdict === 'wrong',
    // 헛경보: 평범한 동작을 삭제·결제처럼 읽음 (위험하지는 않지만 사용자를 망설이게 함)
    falseAlarm: !gold.destructive && verdict === 'wrong' && DESTRUCTIVE_WORD.test(final)
  };
}

// --- 묶어 세기. rows는 각 채점 결과에 ok(요청 성공 여부)와 ms를 더한 것
const rate = (n, d) => (d ? n / d : null);

export function summarizeQa(rows) {
  const ok = rows.filter((r) => r.ok);
  const answerable = ok.filter((r) => r.answerable);
  const unanswerable = ok.filter((r) => !r.answerable);
  const count = (list, v) => list.filter((r) => r.verdict === v).length;
  const withEvidence = answerable.filter((r) => r.evidenceOk !== null);
  return {
    asked: rows.length,
    errors: rows.length - ok.length,
    answerable: answerable.length,
    correct: count(answerable, 'correct'),
    accuracy: rate(count(answerable, 'correct'), answerable.length),
    wrong: count(answerable, 'wrong'),
    missed: count(answerable, 'missed'),
    unanswerable: unanswerable.length,
    fabricated: count(unanswerable, 'fabricated'),
    evidenceAccuracy: rate(withEvidence.filter((r) => r.evidenceOk).length, withEvidence.length)
  };
}

export function summarizeLabels(rows) {
  const ok = rows.filter((r) => r.ok);
  const count = (v) => ok.filter((r) => r.verdict === v).length;
  const byHint = {};
  for (const r of ok) {
    byHint[r.hint] ??= { total: 0, right: 0 };
    byHint[r.hint].total++;
    if (r.verdict === 'correct' || r.verdict === 'unsure') byHint[r.hint].right++;
  }
  return {
    items: rows.length,
    errors: rows.length - ok.length,
    // "~일 수 있음"으로 읽어도 이름이 맞으면 맞은 것으로 센다
    accuracy: rate(count('correct') + count('unsure'), ok.length),
    unsure: count('unsure'),
    warned: count('warned'),
    wrong: count('wrong'),
    destructive: ok.filter((r) => r.destructive).length,
    dangerous: ok.filter((r) => r.dangerous).length,
    falseAlarm: ok.filter((r) => r.falseAlarm).length,
    byHint
  };
}
