import { test, mock } from 'node:test';
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

test('따로 쓰인 자모: 온표와 받침 (제8항), 낱말에 붙은 자음 (제10항, 제23항)', () => {
  // 규정 예문: 삼각형 ㄱㄴㄷ, 낫 놓고 ㄱ자도 모른다, [봉주ㄹ흐]
  assert.equal(dots('ㄱㄴㄷ'), '123456-1-123456-25-123456-35');
  assert.equal(dots('ㄱ자도'), '123456-1-46-24-136');
  assert.equal(dots('봉주ㄹ흐'), '45-123456-46-134-456-2-245-246');
  // 웹 글에 흔한 낱자
  assert.equal(dots('ㅋㅋ'), '123456-235-123456-235');
  assert.equal(dots('ㅠㅠ'), '123456-146-123456-146');
  assert.deepEqual(hangulBraille.translate('ㅋㅋ').unknown, []);
});

test("로마자 사이의 아포스트로피는 3점 (제61항), 따옴표 짝을 바꾸지 않음", () => {
  assert.equal(dots("It's"), '356-6-24-2345-3-234-256');
  // 아포스트로피 뒤의 작은따옴표도 여는 것·닫는 것이 바르게
  assert.equal(dots("It's '좋다'"), '356-6-24-2345-3-234-256-빈칸-6-236-46-136-356-24-356-3');
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

test('점자 알림: 4초 보인 뒤 읽던 항목과 읽던 줄로 돌아감 (NVDA 점자 메시지)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const long = '가나다라마바사 '.repeat(12);
    braille.write(long);
    assert.ok(braille.state.lines.length >= 3);
    braille.pan(1);
    braille.pan(1);
    braille.flash('장바구니에 담았습니다');
    assert.equal(braille.state.text, '장바구니에 담았습니다');
    assert.equal(braille.state.line, 0);
    assert.equal(braille.showingMessage, true);
    // 알림이 이어서 오면 새 알림으로 바꾸고, 돌아갈 곳은 그대로
    braille.flash('남은 시간 5분');
    mock.timers.tick(3999);
    assert.equal(braille.state.text, '남은 시간 5분');
    mock.timers.tick(1);
    assert.equal(braille.state.text, long);
    assert.equal(braille.state.line, 2);
    assert.equal(braille.showingMessage, false);
  } finally {
    mock.timers.reset();
  }
});

test('점자 알림: 줄 넘기기는 알림 안에서(시간 다시 셈), 커서 이동 버튼은 알림을 닫음, 새 항목이 오면 알림 끝', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    braille.write('항목 하나');
    const longMessage = '온글 키 도움말입니다 '.repeat(10);
    braille.flash(longMessage);
    mock.timers.tick(3000);
    assert.equal(braille.pan(1), true);
    assert.equal(braille.state.line, 1);
    mock.timers.tick(3000);
    assert.equal(braille.state.text, longMessage);
    braille.transport.press({ type: 'routing', cell: 0 });
    assert.equal(braille.state.text, '항목 하나');
    assert.equal(braille.showingMessage, false);
    braille.flash('페이지 끝입니다');
    braille.write('다음 항목, 링크');
    mock.timers.tick(5000);
    assert.equal(braille.state.text, '다음 항목, 링크');
  } finally {
    mock.timers.reset();
  }
});

test('점자 알림: 알림 중에 돌아갈 내용을 바꿀 수 있음 (메뉴를 닫으면 읽던 위치로)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    braille.write('사용 가이드, 1/9');
    braille.flash('메뉴를 닫았습니다');
    braille.setContent('장바구니 담기, 버튼');
    assert.equal(braille.state.text, '메뉴를 닫았습니다');
    mock.timers.tick(4000);
    assert.equal(braille.state.text, '장바구니 담기, 버튼');
  } finally {
    mock.timers.reset();
  }
});

test('점자 칸 수를 바꾸면 지금 글을 새 칸 수로 다시 나누고, 읽던 글자부터 보임 (알림이 끝나 돌아갈 글도)', async () => {
  const ns = globalThis.__ongeul;
  // 전송 결과(lastWrite)는 기기에 쓰기를 마친 뒤 기록된다
  const sent = () => new Promise((resolve) => setImmediate(resolve));
  const long = '가나다라마바사아자차카타파하 '.repeat(8);
  try {
    ns.reader = { settings: { braille: { cells: 40 } } };
    braille.refreshAdmin();
    braille.write(long);
    braille.pan(1);
    const firstChar = braille.state.translation.source[braille.state.lines[braille.state.line].start];
    braille.flash('알림');
    ns.reader = { settings: { braille: { cells: 20 } } };
    braille.refreshAdmin();
    await sent();
    assert.equal(braille.state.lastWrite.ok, true);
    assert.equal(braille.state.lastWrite.bytes.length, 20);
    // 알림이 끝나면 돌아가는 글도 20칸으로 나뉘어 있고, 읽던 글자가 든 줄로 돌아감
    braille.transport.press({ type: 'routing', cell: 0 });
    await sent();
    assert.equal(braille.state.text, long);
    assert.equal(braille.state.lastWrite.ok, true);
    assert.ok(braille.state.lines.every(({ start, end }) => end - start <= 20));
    const { start, end } = braille.state.lines[braille.state.line];
    const chars = braille.state.translation.source.slice(start, end);
    assert.ok(chars.includes(firstChar));
    assert.equal(braille.pan(1), true);
    await sent();
    assert.equal(braille.state.lastWrite.ok, true);
    assert.equal(braille.state.lastWrite.bytes.length, 20);
  } finally {
    delete ns.reader;
  }
});
