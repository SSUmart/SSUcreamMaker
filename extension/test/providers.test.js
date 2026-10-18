import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, RETRY } from '../lib/providers.js';
import { DEFAULT_SETTINGS, NIM_RECOMMENDED_MODELS, activeProvider, mergeSettings } from '../lib/settings.js';

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return calls;
}

const tiles = [
  { mimeType: 'image/jpeg', data: 'AAA' },
  { mimeType: 'image/jpeg', data: 'BBB' }
];
const sectionsJson = '{"sections":[{"title":"가격·할인","items":["29,000원"]}]}';

test('Gemini: 조각을 순서대로 한 요청에 담고 JSON 응답을 요청한다', async () => {
  const calls = mockFetch([{ body: { candidates: [{ content: { parts: [{ text: sectionsJson }] } }] } }]);
  const text = await PROVIDERS.gemini.extract(tiles, { apiKey: 'k', model: 'gemini-3.8-flash' });
  assert.equal(text, sectionsJson);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
  );
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'k');
  const parts = calls[0].body.contents[0].parts;
  assert.ok(parts[0].text.includes('JSON'));
  assert.deepEqual(parts.slice(1).map((p) => p.inlineData.data), ['AAA', 'BBB']);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');
});

test('Gemini: 401이면 API 키 오류 메시지', async () => {
  mockFetch([{ status: 401, body: {} }]);
  await assert.rejects(PROVIDERS.gemini.test({ apiKey: 'bad', model: 'm' }), /API 키가 올바르지 않습니다/);
});

test('503·429는 잠깐 기다렸다가 다시 보낸다 (최대 2번)', async () => {
  const delays = RETRY.delays;
  RETRY.delays = [0, 0];
  try {
    const ok = { body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } };
    const calls = mockFetch([{ status: 503, body: {} }, { status: 429, body: {} }, ok]);
    await PROVIDERS.gemini.test({ apiKey: 'k', model: 'm' });
    assert.equal(calls.length, 3);
  } finally {
    RETRY.delays = delays;
  }
});

test('503이 계속되면 2번 다시 보낸 뒤 할 일을 알려 주는 오류', async () => {
  const delays = RETRY.delays;
  RETRY.delays = [0, 0];
  try {
    const calls = mockFetch([{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }]);
    await assert.rejects(PROVIDERS.gemini.test({ apiKey: 'k', model: 'm' }), /Gemini 서버가 붐빕니다.*다른 모델을 고르세요/);
    assert.equal(calls.length, 3);
  } finally {
    RETRY.delays = delays;
  }
});

test('400·401·403·404는 다시 보내지 않는다', async () => {
  for (const status of [400, 401, 403, 404]) {
    const calls = mockFetch([{ status, body: {} }]);
    await assert.rejects(PROVIDERS.gemini.test({ apiKey: 'k', model: 'm' }));
    assert.equal(calls.length, 1, `${status}`);
  }
});

test('NIM도 429는 다시 보낸다 (무료 키의 분당 요청 한도)', async () => {
  const delays = RETRY.delays;
  RETRY.delays = [0, 0];
  try {
    const calls = mockFetch([{ status: 429, body: {} }, { body: { choices: [{ message: { content: 'OK' } }] } }]);
    await PROVIDERS.nim.test({ apiKey: 'nv', model: 'x', baseUrl: 'http://localhost:9/v1' });
    assert.equal(calls.length, 2);
  } finally {
    RETRY.delays = delays;
  }
});

test('NIM: 조각별로 읽고 글자 없는 조각은 빼고 정리 요청을 보낸다', async () => {
  const calls = mockFetch([
    { body: { choices: [{ message: { content: '<think>음</think>정가 39,000원' } }] } },
    { body: { choices: [{ message: { content: '없음' } }] } },
    { body: { choices: [{ message: { content: sectionsJson } }] } }
  ]);
  const progress = [];
  const config = { apiKey: 'nv', model: 'nvidia/x-vl', baseUrl: 'http://localhost:9/v1/' };
  const text = await PROVIDERS.nim.extract(tiles, config, (p) => progress.push(p));

  assert.equal(text, sectionsJson);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'http://localhost:9/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer nv');
  const [image, prompt] = calls[0].body.messages[0].content;
  assert.equal(image.image_url.url, 'data:image/jpeg;base64,AAA');
  assert.equal(prompt.type, 'text');
  const finalPrompt = calls[2].body.messages[0].content;
  assert.ok(finalPrompt.includes('정가 39,000원'));
  assert.ok(!finalPrompt.includes('<think>'));
  assert.deepEqual(progress, ['상세 이미지 조각 1/2 읽는 중', '상세 이미지 조각 2/2 읽는 중', '읽은 내용 정리 중']);
});

test('NIM: 모든 조각에 글자가 없으면 정리 요청을 생략한다', async () => {
  const calls = mockFetch([
    { body: { choices: [{ message: { content: '없음' } }] } },
    { body: { choices: [{ message: { content: '없음' } }] } }
  ]);
  const text = await PROVIDERS.nim.extract(tiles, { ...DEFAULT_SETTINGS.nim, apiKey: 'nv' });
  assert.equal(text, '{"sections":[]}');
  assert.equal(calls.length, 2);
});

test('글만 보내기: Gemini는 JSON 모드, NIM은 텍스트 메시지 하나', async () => {
  const calls = mockFetch([
    { body: { candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }] } },
    { body: { choices: [{ message: { content: '<think>음</think>{"found":false}' } }] } }
  ]);
  assert.equal(await PROVIDERS.gemini.generateJson('요약해', { apiKey: 'k', model: 'm' }), '{"items":[]}');
  assert.deepEqual(calls[0].body.contents[0].parts, [{ text: '요약해' }]);
  assert.equal(calls[0].body.generationConfig.responseMimeType, 'application/json');

  const config = { apiKey: 'nv', model: 'x', baseUrl: 'http://localhost:9/v1' };
  assert.equal(await PROVIDERS.nim.generateJson('질문', config), '{"found":false}');
  assert.equal(calls[1].body.messages[0].content, '질문');
});

test('항목 설명: Gemini는 글과 그림 조각을 한 요청에, NIM은 그림 글자를 먼저 읽어 붙인다', async () => {
  const answer = '{"description":"장바구니 담기 버튼입니다."}';
  let calls = mockFetch([{ body: { candidates: [{ content: { parts: [{ text: answer }] } }] } }]);
  assert.equal(await PROVIDERS.gemini.describe('설명 요청', tiles, { apiKey: 'k', model: 'm' }), answer);
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts[0].text, '설명 요청');
  assert.deepEqual(parts.slice(1).map((p) => p.inlineData.data), ['AAA', 'BBB']);

  const config = { apiKey: 'nv', model: 'm', baseUrl: 'http://localhost:9/v1' };
  calls = mockFetch([
    { body: { choices: [{ message: { content: '할인가 24,900원' } }] } },
    { body: { choices: [{ message: { content: '없음' } }] } },
    { body: { choices: [{ message: { content: answer } }] } }
  ]);
  assert.equal(await PROVIDERS.nim.describe('설명 요청', tiles, config), answer);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].body.messages[0].content, '설명 요청\n\n그림에서 읽은 글자:\n할인가 24,900원');

  // 그림이 없으면 요청 한 번
  calls = mockFetch([{ body: { choices: [{ message: { content: answer } }] } }]);
  assert.equal(await PROVIDERS.nim.describe('설명 요청', [], config), answer);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.messages[0].content, '설명 요청');
});

test('설정: AI 꺼짐, 키 없음, 정상', () => {
  assert.match(activeProvider(mergeSettings()).error, /꺼져 있습니다/);
  assert.match(activeProvider(mergeSettings({ aiEnabled: true })).error, /API 키가 없습니다/);
  // NIM은 기본 모델이 없어 사용자가 골라야 한다.
  assert.match(
    activeProvider(mergeSettings({ aiEnabled: true, provider: 'nim', nim: { apiKey: 'nv' } })).error,
    /모델을 고르지 않았습니다/
  );
  // 서비스 종료된 예전 모델이 저장돼 있으면 고르지 않은 것으로 본다.
  assert.equal(mergeSettings({ nim: { model: 'nvidia/nemotron-nano-12b-v2-vl' } }).nim.model, '');
  const ok = activeProvider(
    mergeSettings({ aiEnabled: true, provider: 'nim', nim: { apiKey: 'nv', model: NIM_RECOMMENDED_MODELS[0] } })
  );
  assert.equal(ok.name, 'nim');
  assert.equal(ok.config.baseUrl, DEFAULT_SETTINGS.nim.baseUrl);
});

// 오류 안내는 사용자가 듣는 문장이라 서버 응답 원문(영어, 주소·쿼리)을 넣지 않고 한국어로 알린다
test('오류 안내: 서버 응답 원문 대신 상태별 한국어', async () => {
  const config = { apiKey: 'k', model: 'm', baseUrl: 'http://x/v1' };
  const reply = (status, text) => (globalThis.fetch = async () => new Response(text, { status }));
  const quiet = console.warn;
  console.warn = () => {};
  try {
    reply(500, '<html>Internal Server Error https://x.y/?key=abc</html>');
    await assert.rejects(PROVIDERS.nim.generateJson('p', config), (e) => /서버에 문제가 생겼습니다 \(오류 500\)/.test(e.message) && !/html|key=/.test(e.message));
    reply(400, '{"error":{"message":"Invalid model https://x.y/?key=abc"}}');
    await assert.rejects(PROVIDERS.nim.generateJson('p', config), (e) => /NVIDIA NIM이 요청을 받지 않았습니다/.test(e.message) && !/Invalid|key=/.test(e.message));
    reply(400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}');
    await assert.rejects(PROVIDERS.gemini.generateJson('p', config), /Gemini API 키가 올바르지 않습니다/);
    // 성공 응답인데 본문이 JSON이 아님
    reply(200, 'this is not json');
    await assert.rejects(PROVIDERS.nim.generateJson('p', config), (e) => /응답을 읽지 못했습니다/.test(e.message) && !/Unexpected|token/.test(e.message));
    // 연결 실패 (인터넷 끊김, 잘못된 주소)
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(PROVIDERS.nim.generateJson('p', config), (e) => /서버에 연결하지 못했습니다/.test(e.message) && !/Failed/.test(e.message));
  } finally {
    console.warn = quiet;
  }
});
