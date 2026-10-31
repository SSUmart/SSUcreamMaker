import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GENERIC_ERROR, RAW_ERROR, userMessage } from '../lib/errors.js';

const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
};

test('온글이 만든 한국어 안내는 그대로 전한다', () => {
  for (const text of [
    'Gemini 서버가 붐빕니다. 잠시 뒤 다시 시도하거나 온글 설정에서 다른 모델을 고르세요.',
    'NVIDIA NIM API 키가 올바르지 않습니다. 온글 설정에서 API 키를 확인하세요.',
    '상세 이미지 4개를 Gemini로 읽는 중, 15초 지남',
    '배송비 3,000원, 500ml 텀블러',
    '온글과 연결이 끊겼습니다. 페이지를 새로고침(F5)한 뒤 다시 시도하세요.'
  ]) {
    assert.equal(userMessage(new Error(text)), text);
  }
});

test('오류 코드·JSON·영어 원문이 섞이면 일반 안내로 바꾼다', () => {
  quiet(() => {
    for (const text of [
      // 26.1.x까지 사용자에게 그대로 보이던 형식
      'Gemini 오류 (503) { "error": { "code": 503, "message": "This model is currently experiencing high demand.", "status": "UNAVAILABLE" } }',
      'Gemini가 요청을 받지 않았습니다 (오류 400).',
      'NVIDIA NIM 요청 실패 (429)',
      '서버 오류 502가 났습니다',
      '모델 주소 https://x.y/?key=abc 확인',
      'Could not establish connection. Receiving end does not exist.',
      ''
    ]) {
      assert.equal(userMessage(new Error(text)), GENERIC_ERROR, text);
    }
    assert.equal(userMessage('문자열 오류 code 7'), GENERIC_ERROR);
    assert.equal(userMessage(new Error('Failed'), '다른 안내'), '다른 안내');
  });
});

// content script(page-text.js)는 모듈을 불러올 수 없어 같은 규칙을 옮겨 두었다. 한쪽만 고치지 않도록 확인한다
test('page-text.js의 원문 거름 규칙은 lib/errors.js와 같다', () => {
  const source = fs.readFileSync(new URL('../content/page-text.js', import.meta.url), 'utf8');
  const copied = source.match(/const RAW_ERROR = (\/.+\/i);/)?.[1];
  assert.equal(copied, RAW_ERROR.toString());
});
