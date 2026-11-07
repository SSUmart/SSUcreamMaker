// 설문 저장소: 설문 하나를 JSON 파일 하나(<dataDir>/<id>.json)로 둔다. 외부 DB 없이 서버 한 대에서 쓴다.
// 쓰기는 임시 파일에 쓴 뒤 이름을 바꿔(rename) 중간에 꺼져도 파일이 깨지지 않게 하고, 설문마다 순서대로 처리한다.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ID = /^[A-Za-z0-9_-]{8,64}$/;
export const newToken = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');

export function createStore(dataDir) {
  const file = (id) => path.join(dataDir, `${id}.json`);
  const queues = new Map();
  // 토큰(링크) → { id, role }. 처음 한 번 읽어 채우고, 설문을 만들 때 더한다.
  // 결과가 아니라 읽는 중인 Promise를 담아 두어, 서버를 켠 직후 동시에 온 요청도 모두 같은 목록을 기다린다
  let tokensReady = null;

  async function read(id) {
    if (!ID.test(id)) return null;
    try {
      return JSON.parse(await fs.readFile(file(id), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  }

  async function write(survey) {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file(survey.id)}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(survey, null, 2));
    await fs.rename(tmp, file(survey.id));
  }

  // 같은 설문에 대한 읽기-고치기-쓰기를 하나씩 차례로 (동시에 두 응답이 와도 하나가 사라지지 않게)
  function update(id, change) {
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const survey = await read(id);
      if (!survey) return null;
      const result = await change(survey);
      await write(survey);
      return result === undefined ? survey : result;
    });
    queues.set(id, run.catch(() => {}));
    return run;
  }

  // 파일 하나가 깨져 있어도(손으로 고치다 망가짐 등) 나머지 설문은 계속 쓸 수 있게 건너뛴다
  async function list() {
    let names = [];
    try {
      names = await fs.readdir(dataDir);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const surveys = await Promise.all(
      names
        .filter((n) => n.endsWith('.json'))
        .map((n) =>
          read(n.slice(0, -5)).catch((e) => {
            console.error(`설문 파일을 읽지 못해 건너뜀: ${n} (${e.message})`);
            return null;
          })
        )
    );
    return surveys.filter((s) => s?.id && s.tokens && s.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function tokenMap() {
    tokensReady ??= list()
      .then((all) => {
        const map = new Map();
        for (const s of all) for (const [role, t] of Object.entries(s.tokens)) map.set(t, { id: s.id, role });
        return map;
      })
      .catch((e) => {
        tokensReady = null; // 실패하면 다음 요청에서 다시 읽는다
        throw e;
      });
    return tokensReady;
  }

  async function create({ title, description, questions }) {
    const survey = {
      id: newToken(9),
      title,
      description,
      questions,
      status: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
      tokens: { team: newToken(), user: newToken() },
      responses: [],
      aiAnswers: []
    };
    await write(survey);
    const map = await tokenMap();
    for (const [role, t] of Object.entries(survey.tokens)) map.set(t, { id: survey.id, role });
    return survey;
  }

  async function byToken(token) {
    const hit = (await tokenMap()).get(token);
    if (!hit) return null;
    const survey = await read(hit.id);
    return survey && { survey, role: hit.role };
  }

  // 설문 삭제: 파일을 지우지 않고 trash/ 폴더로 옮긴다 (서버에서 다시 옮겨 놓으면 되살아남). 링크도 바로 끊는다.
  // 같은 설문의 쓰기 대기열 뒤에서 실행해, 저장 중인 응답과 엇갈리지 않게 한다
  function remove(id) {
    if (!ID.test(id)) return Promise.resolve(false);
    const run = (queues.get(id) ?? Promise.resolve()).then(async () => {
      const survey = await read(id);
      if (!survey) return false;
      const trash = path.join(dataDir, 'trash');
      await fs.mkdir(trash, { recursive: true });
      await fs.rename(file(id), path.join(trash, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      const map = await tokenMap();
      for (const t of Object.values(survey.tokens)) map.delete(t);
      return true;
    });
    queues.set(id, run.catch(() => {}));
    return run;
  }

  return { read, list, create, update, remove, byToken };
}
