import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSections } from '../lib/structure.js';

test('코드 블록을 벗기고 정해진 순서로 정리한다', () => {
  const text = '```json\n{"sections":[{"title":"주의사항","items":["세탁기 사용 불가"]},{"title":"소재·성분","items":["면 100%"]}]}\n```';
  assert.deepEqual(parseSections(text), [
    { title: '소재·성분', items: ['면 100%'] },
    { title: '주의사항', items: ['세탁기 사용 불가'] }
  ]);
});

test('모르는 제목은 기타로, 같은 제목은 합치고 빈 항목은 버린다', () => {
  const text = JSON.stringify({
    sections: [
      { title: '이벤트', items: ['리뷰 작성 시 적립금'] },
      { title: '기타', items: ['', '  ', 3, '사은품 증정'] },
      { title: '사용법', items: [] }
    ]
  });
  assert.deepEqual(parseSections(text), [{ title: '기타', items: ['리뷰 작성 시 적립금', '사은품 증정'] }]);
});

test('JSON이 아니면 오류', () => {
  assert.throws(() => parseSections('죄송합니다'), /해석하지 못했습니다/);
  assert.throws(() => parseSections('{"foo":1}'), /형식이 올바르지 않습니다/);
});
