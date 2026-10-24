import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURE_PROMPT, SECTION_TITLES, isNoText, parseSections } from '../lib/structure.js';

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

test('글자 없는 조각의 답은 모양이 조금 달라도 알아본다', () => {
  for (const text of ['없음', '없음.', ' 글자 없음 ', '"없음"', '(없음)']) assert.ok(isNoText(text), text);
  for (const text of ['재고 없음', '없음 표시 상품', '정가 39,000원']) assert.ok(!isNoText(text), text);
});

test('정리 프롬프트에 모든 섹션 제목과 분류 기준이 들어 있다', () => {
  for (const title of SECTION_TITLES) assert.match(STRUCTURE_PROMPT, new RegExp(`  ${title} \\(.+\\)`));
});
