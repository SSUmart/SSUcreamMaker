// 설문 계산: 문항 만들기, 응답 확인, AI 답 읽기, 분석표. 저장소·서버와 떼어 두어 테스트에서 바로 쓴다.
// 점수는 1(매우 불만족)~5(매우 만족), 0은 "해당 없음"(평균에서 뺀다).

export const SCALE = [
  { score: 1, label: '매우 불만족' },
  { score: 2, label: '불만족' },
  { score: 3, label: '보통' },
  { score: 4, label: '만족' },
  { score: 5, label: '매우 만족' }
];
export const NA = 0;
export const ROLES = { team: '팀원', user: '사용자' };
export const LIMITS = { title: 200, description: 2000, question: 500, questions: 100, comment: 2000, source: 60, aiText: 50000 };

// 관리자가 쓴 문항 글을 문항 목록으로. 한 줄에 한 문항, "# 영역 이름" 줄은 그 아래 문항의 영역.
// 줄 앞의 번호("1.", "A1", "- ")는 떼어 낸다.
export function parseQuestions(text) {
  const questions = [];
  let group = '';
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // 영역 줄은 "# " 처럼 # 뒤에 띄어쓰기가 있어야 한다 ("#태그 기능…" 같은 문항은 그대로 문항)
    if (/^#+\s/.test(line)) {
      group = line.replace(/^#+\s*/, '').slice(0, LIMITS.title);
      continue;
    }
    // "1.5배속"처럼 숫자가 이어지는 문항은 번호로 보지 않는다
    const body = line.replace(/^(?:[-*]\s+|\d+[.)](?!\d)\s*|[A-Za-z]\d+[.)]?\s+)/, '').trim();
    if (body) questions.push({ id: `q${questions.length + 1}`, group, text: body.slice(0, LIMITS.question) });
  }
  return questions;
}

// 새 설문 입력 확인. 문제 목록(빈 배열이면 통과)
export function validateSurveyInput({ title, questions }) {
  const errors = [];
  if (!String(title ?? '').trim()) errors.push('설문 제목을 입력해 주세요.');
  if (!questions.length) errors.push('문항을 한 개 이상 입력해 주세요.');
  if (questions.length > LIMITS.questions) errors.push(`문항은 ${LIMITS.questions}개까지 만들 수 있습니다.`);
  return errors;
}

// 응답 확인: 모든 문항에 1~5 또는 해당 없음(0). 깨끗하게 고친 답과 빠진 문항 id 목록
export function checkAnswers(questions, answers = {}) {
  const clean = {};
  const missing = [];
  for (const q of questions) {
    const v = answers?.[q.id];
    if (Number.isInteger(v) && v >= NA && v <= 5) clean[q.id] = v;
    else missing.push(q.id);
  }
  return { answers: clean, missing };
}

// 다른 AI에 붙여 넣을 질문 글
export function aiPrompt(survey) {
  const lines = [
    '당신은 웹 접근성과 보조기술(스크린리더)에 밝은 평가자입니다.',
    '아래 프로젝트를 실제 사용자가 써 본다고 가정하고, 설문 문항마다 1~5점으로 평가해 주세요.',
    '',
    '프로젝트: 온글 (AI를 결합한 웹 스크린리더 크롬 확장 프로그램)',
    '저장소: https://github.com/SSUmart/SSUcreamMaker',
    '근거: 저장소의 README.md와 docs 문서, 함께 첨부한 자료. 확인할 수 없는 기능은 추측하지 말고 해당 없음(NA)으로 답하세요.',
    '',
    '점수: 1 매우 불만족, 2 불만족, 3 보통, 4 만족, 5 매우 만족, NA 해당 없음',
    '',
    '답은 다른 설명 없이 문항마다 한 줄씩, 정확히 이 형식으로만 쓰세요:',
    '번호 | 점수 | 이유 한 문장',
    '예) 1 | 4 | 첫 안내에서 다음에 누를 키를 알려 준다.',
    '',
    `설문: ${survey.title}`
  ];
  let group = '';
  survey.questions.forEach((q, i) => {
    if (q.group && q.group !== group) {
      group = q.group;
      lines.push('', `[${group}]`);
    }
    lines.push(`${i + 1}. ${q.text}`);
  });
  return lines.join('\n');
}

// AI 답 읽기: "번호 | 점수 | 이유" 줄. 마크다운 표("| 1 | 4 | 이유 |")와 "1. 4 - 이유", "1: NA" 꼴도 받는다.
export function parseAiAnswer(text, questions) {
  const scores = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^\|/, '').replace(/\|$/, '').trim();
    const m = line.match(/^\**(?:Q|문항\s*)?(\d{1,3})\s*(?:번)?\**\s*[|.:)\-]\s*\**\s*([0-5]|NA|N\/A|해당\s*없음)(?:\s*점)?\**\s*(?:[|:\-–]\s*(.*))?$/i);
    if (!m) continue;
    const q = questions[Number(m[1]) - 1];
    if (!q || q.id in scores) continue;
    const score = /^[1-5]$/.test(m[2]) ? Number(m[2]) : NA; // 0, NA, 해당 없음은 모두 해당 없음
    scores[q.id] = { score, reason: (m[3] ?? '').replace(/\s*\|\s*$/, '').trim().slice(0, LIMITS.comment) };
  }
  const missing = questions.map((q, i) => (q.id in scores ? null : i + 1)).filter(Boolean);
  return { scores, missing };
}

const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

// 점수 묶음 통계. 해당 없음(0)은 na로 따로 센다
export function stats(values) {
  const scored = values.filter((v) => v >= 1 && v <= 5);
  const n = scored.length;
  const dist = [1, 2, 3, 4, 5].map((s) => scored.filter((v) => v === s).length);
  const mean = n ? scored.reduce((a, b) => a + b, 0) / n : null;
  return {
    n,
    na: values.length - n,
    mean: round(mean),
    satisfied: n ? round((dist[3] + dist[4]) / n, 3) : null, // 4점 이상 비율
    dist
  };
}

const diff = (a, b) => (a == null || b == null ? null : round(a - b));

// 분석표: 문항별·영역별·전체로 AI, 팀원, 사용자 점수를 나란히
export function analyze(survey) {
  const byRole = (role) => survey.responses.filter((r) => r.role === role);
  const team = byRole('team');
  const user = byRole('user');
  const ai = survey.aiAnswers ?? [];

  const rows = survey.questions.map((q, i) => {
    const aiScores = ai.map((a) => a.scores[q.id]?.score ?? NA);
    const row = {
      no: i + 1,
      id: q.id,
      group: q.group,
      text: q.text,
      ai: stats(aiScores),
      aiDetail: ai.map((a) => ({ source: a.source, ...(a.scores[q.id] ?? { score: NA, reason: '' }) })),
      team: stats(team.map((r) => r.answers[q.id] ?? NA)),
      user: stats(user.map((r) => r.answers[q.id] ?? NA))
    };
    row.userMinusAi = diff(row.user.mean, row.ai.mean);
    row.userMinusTeam = diff(row.user.mean, row.team.mean);
    return row;
  });

  // 영역·전체 점수는 문항 평균의 평균 (응답 수가 다른 문항이 섞여도 문항마다 같은 무게)
  const summarize = (list) => {
    const avg = (key) => {
      const means = list.map((r) => r[key].mean).filter((m) => m != null);
      return means.length ? round(means.reduce((a, b) => a + b, 0) / means.length) : null;
    };
    const s = { questions: list.length, ai: avg('ai'), team: avg('team'), user: avg('user') };
    s.userMinusAi = diff(s.user, s.ai);
    s.userMinusTeam = diff(s.user, s.team);
    return s;
  };
  const groups = [...new Set(rows.map((r) => r.group).filter(Boolean))].map((name) => ({
    name,
    ...summarize(rows.filter((r) => r.group === name))
  }));

  // 눈여겨볼 문항: 사용자 점수가 팀원·AI 평가와 0.5점 이상 다른 것, 차이가 큰 순
  const gap = (r) => Math.max(Math.abs(r.userMinusTeam ?? 0), Math.abs(r.userMinusAi ?? 0));
  const notable = rows
    .filter((r) => gap(r) >= 0.5)
    .sort((a, b) => gap(b) - gap(a))
    .slice(0, 5)
    .map((r) => ({ no: r.no, text: r.text, userMinusTeam: r.userMinusTeam, userMinusAi: r.userMinusAi }));
  const lowest = rows
    .filter((r) => r.user.mean != null)
    .sort((a, b) => a.user.mean - b.user.mean)
    .slice(0, 3)
    .map((r) => ({ no: r.no, text: r.text, mean: r.user.mean }));

  return {
    counts: { ai: ai.length, team: team.length, user: user.length },
    overall: summarize(rows),
    groups,
    rows,
    notable,
    lowest,
    comments: survey.responses.filter((r) => r.comment).map((r) => ({ role: r.role, comment: r.comment, submittedAt: r.submittedAt }))
  };
}

// 응답 내려받기 (엑셀에서 한글이 깨지지 않게 BOM을 붙인다)
export function responsesCsv(survey) {
  // 엑셀이 =, +, -, @로 시작하는 칸을 수식으로 실행하지 않게 앞에 '를 붙인다 (CSV 수식 주입 방지)
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['평가자', '응답 시각', ...survey.questions.map((q, i) => `${i + 1}. ${q.text}`), '의견'];
  const lines = [head.map(cell).join(',')];
  for (const a of survey.aiAnswers ?? []) {
    lines.push([`AI (${a.source})`, a.enteredAt, ...survey.questions.map((q) => a.scores[q.id]?.score || '해당 없음'), ''].map(cell).join(','));
  }
  for (const r of survey.responses) {
    lines.push([ROLES[r.role], r.submittedAt, ...survey.questions.map((q) => r.answers[q.id] || '해당 없음'), r.comment].map(cell).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
