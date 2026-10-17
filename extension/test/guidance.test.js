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
