// 온글 평가 설문 서버: 응답자는 링크(/s/<토큰>)로 답하고, 관리자(/admin)는 설문을 만들고·보고·끝낸다.
// 끝낸 설문의 분석표는 결과 페이지(/result-<순번>)에서 본다. 관리자는 언제나, 그 밖의 사람은 관리자가 공개한 결과만.
// 외부 패키지 없이 Node만으로 동작한다. 응답은 DATA_DIR(기본 eval/survey/data)의 JSON 파일에 남는다.
//
// 실행 (eval 폴더에서): SURVEY_ADMIN_PASSWORD=<비밀번호> npm run survey
//   PORT(기본 8090), HOST(기본 127.0.0.1, 다른 PC에서 열려면 0.0.0.0), DATA_DIR
// 테스트 페이지와 한 포트로 함께 띄우려면 eval/web.mjs (설문은 /survey/ 아래)
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, analyze, checkAnswers, parseAiAnswer, parseQuestions, questionsToText, responsesCsv, validateSurveyInput, aiPrompt } from './analysis.js';
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

// 설문 요청을 처리하는 함수를 만든다. basePath('/survey' 등)를 주면 그 아래 주소만 처리한다 (다른 서버에 붙일 때).
// 반환한 함수는 처리했으면 true, basePath 밖의 주소면 false를 돌려준다.
export function createSurveyHandler({ dataDir, password, basePath = '' }) {
  if (!password) throw new Error('관리자 비밀번호(SURVEY_ADMIN_PASSWORD)가 필요합니다.');
  const base = basePath.replace(/\/+$/, '');
  if (base && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) throw new Error(`설문 경로가 올바르지 않습니다: ${basePath}`);
  const cookiePath = base || '/';
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
    no: s.no,
    title: s.title,
    status: s.status,
    createdAt: s.createdAt,
    closedAt: s.closedAt,
    resultPublic: Boolean(s.resultPublic),
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
    questionsText: questionsToText(s.questions),
    // 응답이나 AI 답을 받은 뒤 문항을 바꾸면 이미 받은 점수가 다른 문항의 점수가 되므로, 그 전까지만 문항을 고칠 수 있다
    questionsEditable: !s.responses.length && !s.aiAnswers.length,
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

  async function route(req, res, p) {
    const m = (re) => p.match(re);
    let hit;

    // ----- 화면 -----
    if (req.method === 'GET') {
      if (p === '/' || p === '') return send(res, 302, '', { location: `${base}/admin` });
      if (p === '/admin') return serveFile(res, 'admin.html');
      if (m(/^\/s\/[A-Za-z0-9_-]+$/)) return serveFile(res, 'respond.html');
      if (m(/^\/result-[1-9]\d{0,6}$/)) return serveFile(res, 'result.html');
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

    // ----- 결과 페이지 -----
    // 공개하지 않은 결과는 관리자가 아니면 없는 결과와 똑같이 답한다 (어떤 번호가 있는지 알 수 없게)
    if ((hit = m(/^\/api\/result\/([1-9]\d{0,6})$/)) && req.method === 'GET') {
      const s = await store.byNumber(Number(hit[1]));
      const admin = isAdmin(req);
      if (!s || (!s.resultPublic && !admin)) throw new HttpError(404, '결과를 찾을 수 없습니다. 주소를 확인하거나, 설문 관리자에게 결과를 공개했는지 물어보세요.');
      if (s.status !== 'closed') throw new HttpError(409, '아직 끝나지 않은 설문입니다. 설문을 끝내면 이 주소에서 분석표를 볼 수 있습니다.');
      return json(res, 200, {
        no: s.no,
        title: s.title,
        createdAt: s.createdAt,
        closedAt: s.closedAt,
        questions: s.questions.length,
        resultPublic: Boolean(s.resultPublic),
        // 관리자에게만: 설문 관리 화면으로 돌아갈 주소에 쓰는 설문 ID
        ...(admin ? { admin: true, id: s.id } : {}),
        analysis: analyze(s)
      });
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
        return json(res, 200, { admin: true }, { 'set-cookie': `survey_admin=${token}; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}` });
      }
      if (req.method === 'DELETE') {
        sessions.delete(cookie(req, 'survey_admin'));
        return json(res, 200, { admin: false }, { 'set-cookie': `survey_admin=; Path=${cookiePath}; HttpOnly; SameSite=Strict; Max-Age=0` });
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

      // 수정: 제목·안내 문구는 언제나, 문항은 응답·AI 답이 없을 때만 (questionsText를 보냈을 때만 문항을 바꿈)
      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)$/)) && req.method === 'PATCH') {
        await adminSurvey(hit[1]);
        const data = await body(req);
        const s = await store.update(hit[1], (s) => {
          const next = {
            title: data.title === undefined ? s.title : text(data.title, LIMITS.title),
            description: data.description === undefined ? s.description : text(data.description, LIMITS.description),
            questions: s.questions
          };
          if (data.questionsText !== undefined) {
            const questions = parseQuestions(data.questionsText);
            if (JSON.stringify(questions) !== JSON.stringify(s.questions)) {
              if (s.responses.length || s.aiAnswers.length) {
                throw new HttpError(409, '응답이나 AI 답을 받은 설문은 문항을 고칠 수 없습니다. 설문을 복제해서 새 설문으로 고치세요.');
              }
              next.questions = questions;
            }
          }
          const errors = validateSurveyInput(next);
          if (errors.length) throw new HttpError(400, errors.join(' '), { errors });
          Object.assign(s, next);
          // 결과 공개: 켜면 로그인 없이 결과 페이지 주소로 분석표를 볼 수 있다
          if (data.resultPublic !== undefined) {
            if (typeof data.resultPublic !== 'boolean') throw new HttpError(400, '결과 공개 값이 올바르지 않습니다.');
            s.resultPublic = data.resultPublic;
          }
        });
        if (!s) throw new HttpError(404, '설문을 찾을 수 없습니다.');
        return json(res, 200, detail(s));
      }

      // 삭제: 휴지통(데이터 폴더의 trash/)으로 옮기고 링크를 끊는다
      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)$/)) && req.method === 'DELETE') {
        if (!(await store.remove(hit[1]))) throw new HttpError(404, '설문을 찾을 수 없습니다.');
        return json(res, 200, { ok: true });
      }

      // 복제: 제목·안내·문항만 복사한 새 설문 (새 링크, 응답 없음)
      if ((hit = m(/^\/api\/admin\/surveys\/([A-Za-z0-9_-]+)\/copy$/)) && req.method === 'POST') {
        const src = await adminSurvey(hit[1]);
        const copy = await store.create({ title: `${src.title} (복사본)`.slice(0, LIMITS.title), description: src.description, questions: src.questions });
        return json(res, 201, detail(copy));
      }

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

  return function handle(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return false;
    route(req, res, pathname.slice(base.length)).catch((e) => {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...e.extra });
      console.error(e);
      json(res, 500, { error: '서버 오류가 생겼습니다. 잠시 뒤 다시 시도해 주세요.' });
    });
    return true;
  };
}

// 설문만 따로 띄우는 서버 (주소 앞부분 없이 /admin, /s/<토큰>)
export function createSurveyServer(options) {
  const handle = createSurveyHandler(options);
  return http.createServer((req, res) => {
    if (!handle(req, res)) send404(res);
  });
}
const send404 = (res) => {
  res.writeHead(404);
  res.end();
};

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
