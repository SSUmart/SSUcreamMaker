import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { aiPrompt, analyze, checkAnswers, parseAiAnswer, parseQuestions, responsesCsv, stats } from '../survey/analysis.js';
import { createSurveyServer } from '../survey/server.mjs';
import { createStore } from '../survey/store.js';

const QUESTIONS_TEXT = `# 시작하기
1. 첫 안내에 얼마나 만족하셨나요?
A2 키 도움말에 얼마나 만족하셨나요?

# AI 기능
- 상세 이미지 읽기에 얼마나 만족하셨나요?`;

test('문항 글: 번호를 떼고, # 줄로 영역을 묶는다', () => {
  const qs = parseQuestions(QUESTIONS_TEXT);
  assert.deepEqual(qs, [
    { id: 'q1', group: '시작하기', text: '첫 안내에 얼마나 만족하셨나요?' },
    { id: 'q2', group: '시작하기', text: '키 도움말에 얼마나 만족하셨나요?' },
    { id: 'q3', group: 'AI 기능', text: '상세 이미지 읽기에 얼마나 만족하셨나요?' }
  ]);
  assert.deepEqual(parseQuestions('\n\n'), []);
  // "1.5배속"은 번호가 아니고, # 뒤에 띄어쓰기가 없으면 영역이 아니라 문항
  assert.equal(parseQuestions('1.5배속 읽기 속도가 적절한가요?')[0].text, '1.5배속 읽기 속도가 적절한가요?');
  assert.equal(parseQuestions('#태그 기능에 만족하셨나요?')[0].text, '#태그 기능에 만족하셨나요?');
});

test('응답 확인: 1~5와 해당 없음(0)만 받고 빠진 문항을 알려 준다', () => {
  const qs = parseQuestions(QUESTIONS_TEXT);
  assert.deepEqual(checkAnswers(qs, { q1: 5, q2: 0, q3: 3 }).missing, []);
  assert.deepEqual(checkAnswers(qs, { q1: 6, q2: '3', q3: 2.5 }).missing, ['q1', 'q2', 'q3']);
  assert.deepEqual(checkAnswers(qs, { q1: 4, q2: 4, q3: 4, extra: 1 }).answers, { q1: 4, q2: 4, q3: 4 });
});

test('AI 답 읽기: 기본 형식, 마크다운 표, NA, 빠진 문항', () => {
  const qs = parseQuestions(QUESTIONS_TEXT);
  const plain = parseAiAnswer('설명 문장은 건너뜀\n1 | 4 | 첫 안내가 친절하다\n2 | NA | 확인할 수 없음\n3 | 5 | 상세 이미지를 읽는다', qs);
  assert.deepEqual(plain.missing, []);
  assert.deepEqual(plain.scores.q1, { score: 4, reason: '첫 안내가 친절하다' });
  assert.equal(plain.scores.q2.score, 0);
  const table = parseAiAnswer('| 번호 | 점수 | 이유 |\n|---|---|---|\n| 1 | 3 | 보통 |\n| 3 | **5** | 좋음 |', qs);
  assert.deepEqual(table.missing, [2]);
  assert.equal(table.scores.q3.score, 5);
  assert.equal(parseAiAnswer('1. 2점 - 아쉬움\n2: 해당 없음', qs).scores.q1.score, 2);
  assert.equal(parseAiAnswer('9 | 5 | 없는 문항', qs).missing.length, 3);
  const variants = parseAiAnswer('1 | 0 | 해당 없음으로 0을 씀\n**2** | 4 | 굵은 번호\n| **3** | 3 | 표 속 굵은 번호 |', qs);
  assert.deepEqual(variants.missing, []);
  assert.deepEqual([variants.scores.q1.score, variants.scores.q2.score, variants.scores.q3.score], [0, 4, 3]);
});

test('AI 질문 글에 문항과 답 형식이 모두 들어간다', () => {
  const prompt = aiPrompt({ title: '1차 평가', questions: parseQuestions(QUESTIONS_TEXT) });
  assert.match(prompt, /번호 \| 점수 \| 이유/);
  assert.match(prompt, /\[AI 기능\]\n3\. 상세 이미지 읽기/);
});

test('통계: 해당 없음은 평균에서 빼고, 4점 이상 비율을 낸다', () => {
  assert.deepEqual(stats([5, 4, 2, 0]), { n: 3, na: 1, mean: 3.67, satisfied: 0.667, dist: [0, 1, 0, 1, 1] });
  assert.equal(stats([0, 0]).mean, null);
});

test('분석표: AI·팀원·사용자 점수와 차이, 영역, 눈여겨볼 문항', () => {
  const survey = {
    questions: parseQuestions(QUESTIONS_TEXT),
    aiAnswers: [
      { source: 'A', scores: { q1: { score: 4, reason: '' }, q2: { score: 4, reason: '' }, q3: { score: 5, reason: '' } } },
      { source: 'B', scores: { q1: { score: 5, reason: '' }, q2: { score: 0, reason: '' }, q3: { score: 5, reason: '' } } }
    ],
    responses: [
      { role: 'team', answers: { q1: 4, q2: 4, q3: 5 } },
      { role: 'user', answers: { q1: 4, q2: 3, q3: 2 }, comment: '상세 이미지가 느려요' },
      { role: 'user', answers: { q1: 5, q2: 0, q3: 3 } }
    ]
  };
  const a = analyze(survey);
  assert.deepEqual(a.counts, { ai: 2, team: 1, user: 2 });
  const q3 = a.rows[2];
  assert.equal(q3.ai.mean, 5);
  assert.equal(q3.user.mean, 2.5);
  assert.equal(q3.userMinusAi, -2.5);
  assert.equal(q3.userMinusTeam, -2.5);
  assert.equal(a.rows[1].ai.mean, 4); // B의 해당 없음은 뺀다
  assert.equal(a.rows[1].user.n, 1);
  assert.deepEqual(a.groups.map((g) => g.name), ['시작하기', 'AI 기능']);
  assert.equal(a.groups[1].user, 2.5);
  assert.equal(a.notable[0].no, 3);
  assert.equal(a.lowest[0].no, 3);
  assert.equal(a.comments.length, 1);
  const csv = responsesCsv({ ...survey, aiAnswers: survey.aiAnswers.map((x) => ({ ...x, enteredAt: '' })), responses: survey.responses.map((r) => ({ ...r, submittedAt: '' })) });
  assert.ok(csv.startsWith('﻿평가자,'));
  assert.equal(csv.trim().split('\r\n').length, 1 + 2 + 3);
});

test('CSV: =, +, -, @로 시작하는 칸은 엑셀 수식으로 실행되지 않게 막는다', () => {
  const survey = { questions: [{ id: 'q1', text: '문항' }], aiAnswers: [], responses: [
    { role: 'user', submittedAt: '', answers: { q1: 3 }, comment: '=HYPERLINK("http://e","c")' },
    { role: 'user', submittedAt: '', answers: { q1: 3 }, comment: '-느려요' }
  ] };
  const lines = responsesCsv(survey).trim().split('\r\n');
  assert.ok(lines[1].endsWith(`"'=HYPERLINK(""http://e"",""c"")"`), lines[1]);
  assert.ok(lines[2].endsWith(`"'-느려요"`), lines[2]);
});

test('저장소: 서버를 켠 직후 동시에 온 링크 요청도 모두 찾고, 깨진 파일 하나는 건너뛴다', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-store-'));
  try {
    const first = createStore(dataDir);
    const s = await first.create({ title: 't', description: '', questions: parseQuestions('문항') });
    fs.writeFileSync(path.join(dataDir, 'brokenfile123.json'), '{ 깨진');
    const fresh = createStore(dataDir); // 서버를 다시 켠 것과 같다
    const hits = await Promise.all([s.tokens.user, s.tokens.team, s.tokens.user].map((t) => fresh.byToken(t)));
    assert.deepEqual(hits.map((h) => h?.role), ['user', 'team', 'user']);
    assert.equal((await fresh.list()).length, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

// ----- 서버 (임시 폴더에 실제로 띄워서) -----
async function withServer(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-test-'));
  const server = createSurveyServer({ dataDir, password: 'pw-1234' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (p, { method = 'GET', body, admin = true, csrf = true } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (admin && cookie) headers.cookie = cookie;
    if (csrf) headers['x-survey-admin'] = '1';
    const res = await fetch(base + p, { method, headers, body: body && JSON.stringify(body), redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  try {
    await run({ call, dataDir, base });
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('서버: 관리자 로그인 없이는 관리 API를 쓸 수 없다', () =>
  withServer(async ({ call, base }) => {
    assert.equal((await call('/api/admin/surveys')).status, 401);
    assert.equal((await call('/api/admin/session', { method: 'POST', body: { password: 'wrong' } })).status, 401);
    assert.equal((await call('/api/admin/session', { method: 'POST', body: { password: 'pw-1234' } })).status, 200);
    assert.equal((await call('/api/admin/surveys')).status, 200);
    // 다른 사이트에서 보낸 요청(전용 머리글 없음)은 거부
    assert.equal((await call('/api/admin/surveys', { method: 'POST', body: { title: 'x', questionsText: 'a' }, csrf: false })).status, 403);
    assert.equal((await call('/')).status, 302);
    assert.equal((await call('/admin')).status, 200);
    // 정규화되지 않은 경로를 그대로 보내 서버의 경로 방어를 시험한다 (fetch는 ..를 미리 지움)
    const port = new URL(base).port;
    for (const raw of ['/assets/%2e%2e/server.mjs', '/assets/../server.mjs', '/assets/..%2fserver.mjs']) {
      const status = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: raw }, (r) => { r.resume(); resolve(r.statusCode); }));
      assert.equal(status, 404, raw);
    }
    // JSON 객체가 아닌 본문은 400 (서버 오류 500이 아님)
    for (const raw of ['null', '[]', '"x"']) {
      const res = await fetch(`${base}/api/admin/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
      assert.equal(res.status, 400, raw);
    }
  }));

test('서버: 비밀번호를 1분에 10번 넘게 틀리면 (동시에 넣어도) 잠시 막는다', () =>
  withServer(async ({ call }) => {
    const tries = await Promise.all(Array.from({ length: 12 }, () => call('/api/admin/session', { method: 'POST', body: { password: 'wrong' } })));
    assert.equal(tries.filter((r) => r.status === 401).length, 10);
    assert.equal(tries.filter((r) => r.status === 429).length, 2);
    assert.equal((await call('/api/admin/session', { method: 'POST', body: { password: 'pw-1234' } })).status, 429);
  }));

test('서버: 설문 만들기 → 팀원·사용자 링크로 응답 → 끝내기 → 분석표', () =>
  withServer(async ({ call, dataDir }) => {
    await call('/api/admin/session', { method: 'POST', body: { password: 'pw-1234' } });
    assert.equal((await call('/api/admin/surveys', { method: 'POST', body: { title: '', questionsText: '' } })).status, 400);
    const created = await call('/api/admin/surveys', { method: 'POST', body: { title: '1차 평가', description: '안내', questionsText: QUESTIONS_TEXT } });
    assert.equal(created.status, 201);
    const s = created.data;
    assert.equal(s.questions, 3);
    assert.equal(s.analysis, null);
    assert.notEqual(s.tokens.team, s.tokens.user);

    // 응답자: 로그인 없이 링크로
    const form = await call(`/api/s/${s.tokens.user}`, { admin: false, csrf: false });
    assert.equal(form.data.role, 'user');
    assert.equal(form.data.questions.length, 3);
    assert.equal(form.data.tokens, undefined);
    assert.equal((await call('/api/s/no-such-token', { admin: false })).status, 404);
    const partial = await call(`/api/s/${s.tokens.user}`, { method: 'POST', body: { answers: { q1: 5 } }, admin: false, csrf: false });
    assert.equal(partial.status, 400);
    assert.deepEqual(partial.data.missing, ['q2', 'q3']);
    // 동시에 여러 응답이 와도 모두 남는다
    await Promise.all([
      call(`/api/s/${s.tokens.user}`, { method: 'POST', body: { answers: { q1: 5, q2: 4, q3: 2 }, comment: '<b>좋아요</b>' }, admin: false, csrf: false }),
      call(`/api/s/${s.tokens.user}`, { method: 'POST', body: { answers: { q1: 4, q2: 0, q3: 3 } }, admin: false, csrf: false }),
      call(`/api/s/${s.tokens.team}`, { method: 'POST', body: { answers: { q1: 4, q2: 4, q3: 5 } }, admin: false, csrf: false })
    ]);

    // AI 답: 빠진 문항이 있으면 묻고, 허락하면 해당 없음으로
    const ai1 = await call(`/api/admin/surveys/${s.id}/ai`, { method: 'POST', body: { source: 'Claude', text: '1 | 5 | 좋음\n3 | 5 | 좋음' } });
    assert.equal(ai1.status, 400);
    assert.deepEqual(ai1.data.missing, [2]);
    assert.equal((await call(`/api/admin/surveys/${s.id}/ai`, { method: 'POST', body: { source: 'Claude', text: '1 | 5 | 좋음\n3 | 5 | 좋음', allowMissing: true } })).status, 201);
    const extra = await call(`/api/admin/surveys/${s.id}/ai`, { method: 'POST', body: { source: 'GPT', text: '1|3|x\n2|3|x\n3|3|x' } });
    const gptId = extra.data.aiAnswers.find((a) => a.source === 'GPT').id;
    assert.equal((await call(`/api/admin/surveys/${s.id}/ai/${gptId}`, { method: 'DELETE' })).data.counts.ai, 1);

    const before = (await call(`/api/admin/surveys/${s.id}`)).data;
    assert.deepEqual(before.counts, { team: 1, user: 2, ai: 1 });
    assert.equal(before.analysis, null);

    const closed = (await call(`/api/admin/surveys/${s.id}/close`, { method: 'POST' })).data;
    assert.equal(closed.status, 'closed');
    assert.equal(closed.analysis.rows[2].user.mean, 2.5);
    assert.equal(closed.analysis.rows[2].ai.mean, 5);
    assert.equal(closed.analysis.rows[2].team.mean, 5);
    assert.equal(closed.analysis.comments[0].comment, '<b>좋아요</b>'); // 저장은 그대로, 화면은 글자로만 넣는다

    // 끝난 설문은 응답을 받지 않는다
    assert.equal((await call(`/api/s/${s.tokens.user}`, { admin: false })).data.status, 'closed');
    assert.equal((await call(`/api/s/${s.tokens.user}`, { method: 'POST', body: { answers: { q1: 1, q2: 1, q3: 1 } }, admin: false, csrf: false })).status, 409);

    const csv = await call(`/api/admin/surveys/${s.id}/responses.csv`);
    assert.match(csv.headers.get('content-disposition'), /attachment/);
    assert.equal(csv.data.trim().split('\r\n').length, 1 + 1 + 3);

    // 파일로 남고, 서버를 새로 띄워도 링크가 그대로 동작한다
    assert.equal(fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).length, 1);
    const again = createSurveyServer({ dataDir, password: 'pw-1234' });
    await new Promise((r) => again.listen(0, '127.0.0.1', r));
    const res = await fetch(`http://127.0.0.1:${again.address().port}/api/s/${s.tokens.team}`);
    assert.equal((await res.json()).title, '1차 평가');
    again.close();
  }));

test('서버: 비밀번호 없이는 시작하지 않는다', () => {
  assert.throws(() => createSurveyServer({ dataDir: os.tmpdir(), password: '' }), /비밀번호/);
});

test('합친 서버(web.mjs): 쇼핑몰과 설문을 한 포트에서, 설문은 /survey 아래만', async () => {
  const { createWebServer } = await import('../web.mjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'survey-web-'));
  const server = createWebServer({ survey: { dataDir, password: 'pw-1234', basePath: '/survey' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, init) => fetch(base + p, { redirect: 'manual', ...init });
  try {
    assert.equal((await get('/')).headers.get('location'), '/mall/');
    assert.equal((await get('/mall/')).status, 200);
    assert.equal((await get('/shop/')).status, 200);
    assert.equal((await get('/healthz')).status, 200);
    assert.equal((await get('/survey')).headers.get('location'), '/survey/admin');
    assert.equal((await get('/survey/')).headers.get('location'), '/survey/admin');
    assert.equal((await get('/survey/admin')).status, 200);
    assert.equal((await get('/survey/assets/common.js')).status, 200);
    // 설문 주소는 /survey 밖에서는 열리지 않고, /surveyX 같은 비슷한 주소도 설문으로 보지 않는다
    assert.equal((await get('/admin')).status, 404);
    assert.equal((await get('/api/admin/session')).status, 404);
    assert.equal((await get('/surveyx/admin')).status, 404);
    // 로그인 쿠키는 /survey에만 붙는다 (쇼핑몰 요청에는 보내지 않음)
    const login = await get('/survey/api/admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'pw-1234' }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /Path=\/survey;/);
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('합친 서버: 비밀번호가 없으면 설문만 끄고 쇼핑몰은 연다', async () => {
  const { createWebServer } = await import('../web.mjs');
  const server = createWebServer({});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/mall/`)).status, 200);
    assert.equal((await fetch(`${base}/survey/admin`)).status, 503);
  } finally {
    server.close();
  }
});

test('설문 경로가 이상하면 시작하지 않는다', () => {
  assert.throws(() => createSurveyServer({ dataDir: os.tmpdir(), password: 'x', basePath: '/../x' }), /설문 경로/);
});
