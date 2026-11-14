import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../content/reader/guidance.js';

const { guidance } = globalThis.__ongeul;

// chrome.commands.getAll()의 결과 모양. 업데이트 뒤 크롬이 지정하지 않은 단축키는 shortcut이 ''로 온다.
const commands = (toggle, others = 'Alt+Shift+M') => [
  { name: '_execute_action', shortcut: '' },
  { name: 'toggle-reader', shortcut: toggle },
  { name: 'open-menu', shortcut: others },
  { name: 'stop-speech', shortcut: others },
  { name: 'reread-current', shortcut: others }
];

test('켜기 단축키가 비어 있으면 지정 안내가 필요하다', () => {
  assert.equal(guidance.needsShortcutSetup(commands('')), true);
  assert.equal(guidance.needsShortcutSetup(commands(undefined)), true);
  assert.equal(guidance.needsShortcutSetup([]), true);
});

test('켜기 단축키가 지정돼 있으면 안내하지 않는다', () => {
  assert.equal(guidance.needsShortcutSetup(commands('Alt+Shift+O')), false);
  assert.equal(guidance.needsShortcutSetup(commands('⌥⇧O')), false);
  // 사용자가 다른 키로 바꿔 둔 경우도 지정된 것으로 본다
  assert.equal(guidance.needsShortcutSetup(commands('Ctrl+Shift+Y')), false);
  // 다른 단축키만 비어 있으면 온글은 켤 수 있으므로 안내하지 않는다
  assert.equal(guidance.needsShortcutSetup(commands('Alt+Shift+O', '')), false);
});

test('단축키 지정 안내는 위치, 읽을 수 없는 화면, 지정할 키, 다음 할 일을 알린다', () => {
  const text = guidance.message('shortcut-missing', {}, { verbosity: 'short', seen: 10 });
  const on = guidance.comboText('KeyO');
  assert.match(text, /크롬 단축키 설정 화면을 새 탭으로 열었습니다/);
  assert.match(text, /온글이 읽을 수 없으므로/);
  assert.ok(text.includes(`온글 켜기/끄기에 ${on} 키를 지정하세요`));
  assert.ok(text.includes(`지정한 뒤 ${on} 키를 누르면 온글이 켜집니다`));
});

test('키 도움말은 키 하나를 한 항목으로 나눈 목록이다 (하나씩 다시 들을 수 있게)', () => {
  const keys = guidance.keyNames({ summary: 'KeyY' });
  const entries = guidance.helpEntries({ keys, toggle: 'Alt와 Shift와 O' });
  assert.ok(entries.length > 20);
  for (const entry of entries) assert.ok(entry.label && !entry.action);
  assert.deepEqual(entries.find((e) => e.label === '페이지 요약'), { label: '페이지 요약', keyText: keys.summary });
  assert.equal(entries.find((e) => e.label === '다음 제목으로 이동').keyText, 'H');
  assert.equal(entries.find((e) => e.label === '온글 켜고 끄기').keyText, 'Alt와 Shift와 O');
});

test('키 도움말 안내는 하나씩 듣는 법과 Esc로 돌아갈 곳을 알린다', () => {
  const fromMenu = guidance.message('help-opened', { count: 37, position: 1, label: '첫 항목', back: true });
  assert.match(fromMenu, /37개 중 1번, 첫 항목/);
  assert.match(fromMenu, /위아래 화살표로 하나씩/);
  assert.match(fromMenu, /온글 메뉴로 돌아갑니다/);
  assert.match(guidance.message('help-opened', { count: 37, position: 1, label: 'x' }), /도움말을 닫고 읽던 위치로/);
});

test('새 탭 질문은 바꾼 내용, 이유, 되돌렸을 때 문제, 고르는 법을 읽는다', () => {
  const text = guidance.message('newtab-ask', { count: 2, position: 1, label: '구글 페이지 그대로 쓰기' }, { verbosity: 'short', seen: 9 });
  assert.match(text, /구글 페이지가 열리도록 기본 페이지를 바꿨습니다/);
  assert.doesNotMatch(text, /google\.com/); // 음성이 "구글점컴"으로 읽으므로 소리로 읽는 글에는 쓰지 않는다
  assert.match(text, /온글이 내용을 읽지 못하고/);
  assert.match(text, /되돌릴까요\?/);
  assert.match(text, /주소창에 직접 입력해야/);
  assert.match(text, /2개 중 1번, 구글 페이지 그대로 쓰기/);
});

test('크롬 기본 새 탭 안내는 할 수 있는 일과 바꾸는 법을 알리고, 켜짐 안내를 앞에 붙인다', () => {
  const text = guidance.message('new-tab-unreadable', { prefix: '온글이 켜졌습니다.' });
  assert.ok(text.startsWith('온글이 켜졌습니다. 새 탭.'));
  assert.match(text, /주소나 검색어를 입력하고 Enter/);
  assert.match(text, /온글 설정에서 새 탭 항목/);
});

test('그 자리에서 쓸 키 안내: 목록·표·선택 상자·편집창에만 붙이고, 익숙해지면(짧은 안내) 읽지 않는다', () => {
  assert.equal(guidance.hintFor({ category: 'list' }), 'hint-list');
  assert.equal(guidance.hintFor({ category: 'table' }), 'hint-table');
  assert.equal(guidance.hintFor({ category: 'field', role: 'combobox' }), 'hint-choose');
  assert.equal(guidance.hintFor({ category: 'field', role: 'combobox' }, true), 'hint-edit');
  assert.equal(guidance.hintFor({ category: 'button', role: 'button' }), null);
  assert.match(guidance.message('hint-list', {}, { verbosity: 'auto', seen: 0 }), /L 키/);
  assert.equal(guidance.message('hint-list', {}, { verbosity: 'auto', seen: guidance.AUTO_DETAILED_TIMES }), '');
  assert.equal(guidance.message('hint-table', {}, { verbosity: 'short', seen: 0 }), '');
});

test('같은 키로 두 번 못 찾으면 온글 메뉴의 목록을 알려 준다', () => {
  assert.equal(guidance.listFor('버튼'), '버튼 목록');
  assert.equal(guidance.listFor('제목 2'), '제목 목록');
  assert.equal(guidance.listFor('체크박스'), '입력 요소 목록');
  assert.equal(guidance.listFor('표'), '');
  const text = guidance.message('not-found-again', { label: '버튼', key: 'B', list: '버튼 목록', menu: 'Alt+Shift+M' }, { verbosity: 'short' });
  assert.match(text, /버튼 목록을 고르면/);
  assert.match(guidance.message('not-found-again', { label: '표', key: 'T', list: '' }, { verbosity: 'short' }), /Shift와 T 키로 반대쪽/);
});

test('키 도움말 맨 앞에 지금 위치에서 쓸 키를 둔다', () => {
  assert.equal(guidance.hereEntries(null).length, 0);
  assert.equal(guidance.hereEntries({ category: 'button', role: 'button' })[0].label, '지금 위치에서, 버튼 누르기');
  assert.equal(guidance.hereEntries({ category: 'heading', role: 'heading', level: 2 })[1].keyText, '숫자 2');
});
