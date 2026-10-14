import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../lib/providers.js';
import { DEFAULT_SETTINGS, activeProvider, mergeSettings } from '../lib/settings.js';

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
  assert.deepEqual(progress, ['이미지 조각 1/2 읽는 중', '이미지 조각 2/2 읽는 중', '읽은 내용 정리 중']);
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
  const ok = activeProvider(mergeSettings({ aiEnabled: true, provider: 'nim', nim: { apiKey: 'nv' } }));
  assert.equal(ok.name, 'nim');
  assert.equal(ok.config.baseUrl, DEFAULT_SETTINGS.nim.baseUrl);
});
