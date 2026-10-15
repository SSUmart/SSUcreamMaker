import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import '../content/reader/defaults.js';
import '../content/reader/hangul-braille.js';
import '../content/reader/braille.js';

const { hangulBraille, braille } = globalThis.__ongeul;
const dots = (text, options) => hangulBraille.translate(text, options).cells.map(hangulBraille.dotNumbers).join('-');

// 한국 점자 규정의 규칙을 따른 기대값. 규정 예문·liblouis와의 대조는 테스트 단계에서 따로 한다.
test('초성·중성·종성과 첫소리 ㅇ 생략', () => {
  assert.equal(dots('라'), '5-126');
  assert.equal(dots('아'), '126');
  assert.equal(dots('텀'), '125-234-26');
  assert.equal(dots('있다'), '135-34-24'); // 받침 ㅆ 약자
  assert.equal(dots('계'), '4-34');
});

test('2종 약자: 가 사, ㅏ를 줄인 약자, 모음+받침 약자, 것', () => {
  assert.equal(dots('가'), '1246');
  assert.equal(dots('각'), '1246-1');
  assert.equal(dots('사'), '123');
  assert.equal(dots('하'), '245');
  assert.equal(dots('낙'), '14-1');
  assert.equal(dots('은'), '1356');
  assert.equal(dots('을'), '2346');
  assert.equal(dots('인'), '12345');
  assert.equal(dots('공'), '4-123456');
  assert.equal(dots('녕'), '14-12456');
  assert.equal(dots('것'), '456-234');
});

test('된소리표와 까 싸 껏', () => {
  assert.equal(dots('까'), '6-1246');
  assert.equal(dots('싸'), '6-123');
  assert.equal(dots('껏'), '6-456-234');
  assert.equal(dots('떡'), '6-24-1456');
});

test('약자 예외: 뒤에 모음이 오면 나·다 등은 풀어 씀, 팠, ㅅ ㅈ ㅊ 뒤 엉/영', () => {
  assert.equal(dots('나이'), '14-126-135');
  assert.equal(dots('팠'), '145-126-34');
  assert.equal(dots('성'), '6-12456');
  assert.equal(dots('정'), '46-12456');
  assert.equal(dots('셩'), '6-156-2356');
});

test('모음 사이 구분표 (예, 애)', () => {
  assert.equal(dots('아예'), '126-36-34');
  assert.equal(dots('야애'), '345-36-1235');
});

test('약어: 낱말 첫머리의 그래서·그리고', () => {
  assert.equal(dots('그래서'), '1-234');
  assert.equal(dots('그리고 사'), '1-136-빈칸-123');
});

test('숫자: 수표, 숫자 안의 쉼표, 숫자 뒤 ㄴ 등은 띄움', () => {
  assert.equal(dots('24'), '3456-12-145');
  assert.equal(dots('24,900원'), '3456-12-145-2-24-245-245-1234-25');
  assert.equal(dots('3년'), '3456-14-빈칸-14-16');
  assert.equal(dots('3개'), '3456-14-4-1235');
});

test('로마자: 로마자표·종료표(제29항), 대문자 기호표·단어표(제28항 붙임), 종료표를 쓰지 않는 경우(제33~35항)', () => {
  assert.equal(dots('A 컵'), '356-6-1-256-빈칸-124-234-12');
  assert.equal(dots('ml'), '356-134-123-256');
  assert.equal(dots('USB'), '356-6-6-136-234-12-256');
  assert.equal(dots('IoT'), '356-6-24-135-6-2345-256');
  assert.equal(dots('Los Angeles의').split('-빈칸-').length, 2); // 띄어 쓴 로마자는 한 덩어리
  assert.equal(dots('A4'), '356-6-1-3456-145'); // 숫자가 이어지면 종료표 없음
  assert.equal(dots('KTX, 새'), '356-6-6-13-2345-1346-5-빈칸-6-1235'); // 한글식 쉼표, 종료표 없음
});

test('문장 부호: 줄임표, 줄표, 중괄호, 낫표 (제49항)', () => {
  assert.equal(dots('…'), '6-6-6');
  assert.equal(dots('―'), '36-36');
  assert.equal(dots('{가}'), '236-2-1246-5-356');
  assert.equal(dots('「가」'), '5-236-1246-356-2');
});

test('약자 뒤에 남은 겹받침·쌍받침 (제15항 붙임)', () => {
  assert.equal(dots('넓다'), '14-2345-12-24');
  assert.equal(dots('꺾다'), '6-4-1456-1-24');
  assert.equal(dots('끊다'), '6-4-1356-356-24');
  assert.equal(dots('읊다'), '2346-256-24');
});

// 한국 점자 규정(2024) 예문 전체: eval/braille/rule-examples.json의 정답과 모두 같아야 한다
test('한국 점자 규정 예문과 모두 일치', () => {
  const BRF = ' a1b\'k2l@cif/msp"e3h9o6r^djg>ntq,*5<-u8v.%[$+x!&;:4\\0z7(_?w]#y)=';
  const ALIAS = { '{': '[', '|': '\\', '}': ']', '~': '^', '`': ' ' };
  const examples = JSON.parse(fs.readFileSync(new URL('../../eval/braille/rule-examples.json', import.meta.url), 'utf8')).examples;
  for (const { text, brf, rule } of examples) {
    const expected = [...brf.toLowerCase()].map((ch) => String.fromCodePoint(0x2800 + BRF.indexOf(ALIAS[ch] ?? ch))).join('');
    assert.equal(hangulBraille.toUnicode(hangulBraille.translate(text).cells), expected, `제${rule}항 ${text}`);
  }
  assert.ok(examples.length >= 140);
});

test('1종: 약자를 쓰지 않음', () => {
  assert.equal(dots('가', { grade: 1 }), '4-126');
  assert.equal(dots('은', { grade: 1 }), '246-25');
  assert.equal(dots('그래서', { grade: 1 }), '4-246-5-1235-6-234');
});

test('원문 위치와 바꾸지 못한 글자', () => {
  const result = hangulBraille.translate('가 ★');
  assert.deepEqual(result.source, [0, 1, 2]);
  assert.deepEqual(result.unknown, ['★']);
  assert.equal(hangulBraille.toUnicode([0x2b, 0]), '⠫⠀');
});

test('디스플레이 한 줄 나누기: 칸 수 안에서 낱말 사이로 끊음', () => {
  const cells = [1, 1, 0, 2, 2, 2, 0, 3, 3];
  assert.deepEqual(braille.splitLines(cells, 5), [{ start: 0, end: 3 }, { start: 3, end: 7 }, { start: 7, end: 9 }]);
  assert.deepEqual(braille.splitLines([], 40), [{ start: 0, end: 0 }]);
});
