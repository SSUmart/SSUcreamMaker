// 온글 평가 설문 서버: 응답자는 링크(/s/<토큰>)로 답하고, 관리자(/admin)는 설문을 만들고·보고·끝내고 분석표를 본다.
// 외부 패키지 없이 Node만으로 동작한다. 응답은 DATA_DIR(기본 eval/survey/data)의 JSON 파일에 남는다.
//
// 실행 (eval 폴더에서): SURVEY_ADMIN_PASSWORD=<비밀번호> npm run survey
//   PORT(기본 8090), HOST(기본 127.0.0.1, 다른 PC에서 열려면 0.0.0.0), DATA_DIR
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, analyze, checkAnswers, parseAiAnswer, parseQuestions, responsesCsv, validateSurveyInput, aiPrompt } from './analysis.js';
import { createStore, newToken } from './store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const SESSION_HOURS = 12;
// 비밀번호를 1분 안에 10번 넘게 틀리면 그 1분이 지날 때까지 로그인을 막는다 (동시에 여러 번 넣어 보는 것도 함께 센다)
const LOGIN_WINDOW_MS = 60e3;
const LOGIN_MAX_FAILS = 10;
const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const text = (v, max) => String(v ?? '').trim().slice(0, max);

export function createSurveyServer({ dataDir, password }) {
  if (!password) throw new Error('관리자 비밀번호(SURVEY_ADMIN_PASSWORD)가 필요합니다.');
  const store = createStore(dataDir);
  const sessions = new Map(); // 세션 토큰 → 만료 시각
  let loginFails = []; // 최근 1분 동안 틀린 시각
  const passwordHash = sha(password);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(body);
  };
  const json = (res, status, data, headers) => send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', ...headers });

  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, '보낸 내용이 너무 큽니다.');
      chunks.push(chunk);
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new HttpError(400, '요청 형식이 올바르지 않습니다.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, '요청 형식이 올바르지 않습니다.');
    return data;
  }

  function cookie(req, name) {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === name) return v.join('=');
    }
    return '';
  }

  function isAdmin(req) {
    const token = cookie(req, 'survey_admin');
    const until = token && sessions.get(token);
    if (!until) return false;
    if (until < Date.now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  // 관리자 요청 확인. 쓰기 요청은 다른 사이트에서 보낼 수 없는 머리글을 함께 요구한다 (CSRF 방지)
  function requireAdmin(req) {
    if (!isAdmin(req)) throw new HttpError(401, '로그인이 필요합니다.');
    if (req.method !== 'GET' && req.headers['x-survey-admin'] !== '1') throw new HttpError(403, '허용되지 않은 요청입니다.');
  }

  function serveFile(res, name) {
    const file = path.join(PUBLIC, name);
    if (!file.startsWith(PUBLIC + path.sep) || !TYPES[path.extname(file)] || !fs.existsSync(file)) return send(res, 404, '찾을 수 없습니다.');
    send(res, 200, fs.readFileSync(file), { 'content-type': TYPES[path.extname(file)] });
  }

  // 관리자 목록·상세에 내려줄 모양
  const summary = (s) => ({
    id: s.id,
    title: s.title,
    status: s.status,
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    questions: s.questions.length,
    counts: {
      team: s.responses.filter((r) => r.role === 'team').length,
      user: s.responses.filter((r) => r.role === 'user').length,
      ai: s.aiAnswers.length
    }
  });
  const detail = (s) => ({
    ...summary(s),
    description: s.description,
    questionList: s.questions,
    tokens: s.tokens,
    aiPrompt: aiPrompt(s),
    aiAnswers: s.aiAnswers.map((a) => ({ id: a.id, source: a.source, enteredAt: a.enteredAt, answered: Object.values(a.scores).filter((v) => v.score).length })),
    // 분석표는 설문을 끝낸 뒤에만 준다
    analysis: s.status === 'closed' ? analyze(s) : null
  });

  async function adminSurvey(id) {
    const s = await store.read(id);
    if (!s) throw new HttpError(404, '설문을 찾을 수 없습니다.');
    return s;
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const m = (re) => p.match(re);
    let hit;

    // ----- 화면 -----
    if (req.method === 'GET') {
      if (p === '/') return send(res, 302, '', { location: '/admin' });
      if (p === '/admin') return serveFile(res, 'admin.html');
      if (m(/^\/s\/[A-Za-z0-9_-]+$/)) return serveFile(res, 'respond.html');
      if ((hit = m(/^\/assets\/([a-z0-9-]+\.(?:css|js))$/))) return serveFile(res, hit[1]);
    }

    // ----- 응답자 -----
    if ((hit = m(/^\/api\/s\/([A-Za-z0-9_-]+)$/))) {
      const found = await store.byToken(hit[1]);
      if (!found) throw new HttpError(404, '설문을 찾을 수 없습니다. 받은 링크를 다시 확인해 주세요.');
      const { survey, role } = found;
      if (req.method === 'GET') {
        return json(res, 200, { title: survey.title, description: survey.description, status: survey.status, role, questions: survey.questions });
      }
      if (req.method === 'POST') {
        const data = await body(req);
        const { answers, missing } = checkAnswers(survey.questions, data.answers);
        if (missing.length) throw new HttpError(400, `답하지 않은 문항이 ${missing.length}개 있습니다.`, { missing });
        const saved = await store.update(survey.id, (s) => {
          if (s.status !== 'open') throw new HttpError(409, '종료된 설문입니다. 더 이상 응답을 받지 않습니다.');
          s.responses.push({ id: newToken(8), role, submittedAt: new Date().toISOString(), answers, comment: text(data.comment, LIMITS.comment) });
          return true;
        });
        if (!saved) throw new HttpError(404, '설문을 찾을 수 없습니다.');
        return json(res, 201, { ok: true });
      }
    }

    // ----- 관리자 로그인 -----
    if (p === '/api/admin/session') {
      if (req.method === 'GET') return json(res, 200, { admin: isAdmin(req) });
      if (req.method === 'POST') {
        const data = await body(req);
        const now = Date.now();
        loginFails = loginFails.filter((t) => now - t < LOGIN_WINDOW_MS);
        if (loginFails.length >= LOGIN_MAX_FAILS) throw new HttpError(429, '비밀번호를 여러 번 틀렸습니다. 1분 뒤 다시 시도해 주세요.');
        const ok = crypto.timingSafeEqual(sha(String(data.password ?? '')), passwordHash);
        if (!ok) {
          loginFails.push(now);
          await new Promise((r) => setTimeout(r, 800));
          throw new HttpError(401, '비밀번호가 맞지 않습니다.');
        }
        const token = newToken(24);
        sessions.set(token, Date.now() + SESSION_HOURS * 3600e3);
        return json(res, 200, { admin: true }, { 'set-cookie': `survey_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}` });
      }
      if (req.method === 'DELETE') {
        sessions.delete(cookie(req, 'survey_admin'));
        return json(res, 200, { admin: false }, { 'set-cookie': 'survey_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
      }
    }

    // ----- 관리자 -----
    if (p.startsWith('/api/admin/')) {
      requireAdmin(req);

      if (p === '/api/admin/surveys' && req.method === 'GET') return json(res, 200, (await store.list()).map(summary));
      if (p === '/api/admin/surveys' && req.method === 'POST') {
        const data = await body(req);
        const input = { title: text(data.title, LIMITS.title), description: text(data.description, LIMITS.description), questions: parseQuestions(data.questionsText) };
        const errors = validateSurveyInput(input);
        if (errors.length) throw new HttpError(400, errors.join(' '), { errors });
        return json(res, 201, detail(await store.create(input)));
      }

      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)$/)) && req.method === 'GET') return json(res, 200, detail(await adminSurvey(hit[1])));

      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)\/close$/)) && req.method === 'POST') {
        await adminSurvey(hit[1]);
        const s = await store.update(hit[1], (s) => {
          if (s.status !== 'closed') {
            s.status = 'closed';
            s.closedAt = new Date().toISOString();
          }
        });
        return json(res, 200, detail(s));
      }

      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)\/ai$/)) && req.method === 'POST') {
        const survey = await adminSurvey(hit[1]);
        const data = await body(req);
        const source = text(data.source, LIMITS.source);
        if (!source) throw new HttpError(400, 'AI 이름(예: Claude, ChatGPT)을 입력해 주세요.');
        const { scores, missing } = parseAiAnswer(String(data.text ?? '').slice(0, LIMITS.aiText), survey.questions);
        if (!Object.keys(scores).length) throw new HttpError(400, '읽을 수 있는 답이 없습니다. "번호 | 점수 | 이유" 형식인지 확인해 주세요.', { missing });
        if (missing.length && !data.allowMissing) {
          throw new HttpError(400, `${missing.join(', ')}번 문항의 답을 찾지 못했습니다. 답을 고치거나, 빠진 문항을 해당 없음으로 저장하세요.`, { missing });
        }
        const s = await store.update(hit[1], (s) => {
          s.aiAnswers.push({ id: newToken(8), source, enteredAt: new Date().toISOString(), scores, raw: String(data.text).slice(0, LIMITS.aiText) });
        });
        return json(res, 201, detail(s));
      }

      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)\/ai\/([A-Za-z0-9_-]+)$/)) && req.method === 'DELETE') {
        await adminSurvey(hit[1]);
        const s = await store.update(hit[1], (s) => {
          s.aiAnswers = s.aiAnswers.filter((a) => a.id !== hit[2]);
        });
        return json(res, 200, detail(s));
      }

      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)\/responses\.csv$/)) && req.method === 'GET') {
        const s = await adminSurvey(hit[1]);
        return send(res, 200, responsesCsv(s), {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="survey-${s.id}.csv"`
        });
      }
    }

    throw new HttpError(404, '찾을 수 없습니다.');
  }

  return http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...e.extra });
      console.error(e);
      json(res, 500, { error: '서버 오류가 생겼습니다. 잠시 뒤 다시 시도해 주세요.' });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8090;
  const host = process.env.HOST || '127.0.0.1';
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(HERE, 'data'));
  const password = process.env.SURVEY_ADMIN_PASSWORD;
  if (!password) {
    console.error('관리자 비밀번호가 없습니다. SURVEY_ADMIN_PASSWORD=<비밀번호> npm run survey 처럼 실행하세요.');
    process.exit(1);
  }
  createSurveyServer({ dataDir, password }).listen(port, host, () => {
    console.log(`설문 관리자: http://${host}:${port}/admin`);
    console.log(`응답 저장 위치: ${dataDir}`);
  });
}
