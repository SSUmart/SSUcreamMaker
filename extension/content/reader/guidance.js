// 온글 안내 문구. 화면을 볼 수 없는 사용자에게 안내마다 네 가지를 알린다:
//   1) 지금 어디에 있는지  2) 어떤 키를 누르는지  3) 누르면 무슨 일이 일어나는지  4) 그다음 무엇을 하면 되는지
// 자세한 안내(detailed)와 짧은 안내(short)를 두고, 설정(reader.verbosity)에 따라 고른다.
//   auto: 같은 안내를 처음 3번은 자세히, 그 뒤로는 짧게 / detailed: 항상 자세히 / short: 항상 짧게
// 오류와 막힌 상황(always: true)은 설정과 관계없이 항상 자세히 읽는다.
// content script와 서비스 워커(import로 불러옴)가 같이 쓰므로 모듈 문법 없이 globalThis.__ongeul에 둔다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.guidance) return;

  const AUTO_DETAILED_TIMES = 3;
  const IS_MAC = /Mac/i.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');

  // 온글 명령은 모두 이 조합키와 함께 누른다 (크롬 단축키 4개와 같은 조합, macOS의 Alt는 Option)
  const MODIFIER = IS_MAC ? 'Option+Shift' : 'Alt+Shift';
  // 기능 키 기본값 (설정이 아직 없을 때)
  const DEFAULT_COMMAND_KEYS = { summary: 'KeyS', ask: 'KeyQ', detail: 'KeyD', explain: 'KeyE', menu: 'KeyM' };

  // 키 이름을 읽을 때 쓰는 말. 키 조합은 "Alt와 Shift와 O"처럼 읽는다.
  const KEY_NAMES = {
    ArrowDown: '아래 화살표',
    ArrowUp: '위 화살표',
    Space: '스페이스',
    Tab: 'Tab',
    Enter: 'Enter',
    Escape: 'Esc'
  };

  // 크롬 단축키 문자열을 읽는 말로 바꾼다. Windows는 "Alt+Shift+O", macOS는 "⌥⇧O"처럼 기호로 온다.
  const MAC_SYMBOLS = { '⌃': 'Control', '⌥': 'Option', '⇧': 'Shift', '⌘': 'Command' };
  function shortcutText(shortcut) {
    if (!shortcut) return '';
    const parts = shortcut.includes('+')
      ? shortcut.split('+')
      : [...shortcut].reduce((list, ch) => {
          if (MAC_SYMBOLS[ch]) list.push(MAC_SYMBOLS[ch]);
          else if (list.length && !Object.values(MAC_SYMBOLS).includes(list.at(-1))) list[list.length - 1] += ch;
          else list.push(ch);
          return list;
        }, []);
    const names = parts.map((part) => ({ MacCtrl: 'Control' })[part] ?? part);
    // 조사는 한국어로 읽는 소리에 맞춘다: 컨트롤·옵션·Ctrl은 받침이 있어 "과", 알트·시프트·커맨드는 "와"
    const WITH_GWA = new Set(['Ctrl', 'Control', 'Option']);
    return names.map((name, i) => (i < names.length - 1 ? `${name}${WITH_GWA.has(name) ? '과' : '와'}` : name)).join(' ');
  }

  // event.code("KeyS", "Digit1")를 읽는 말로 바꾼다
  function codeText(code) {
    if (!code) return '';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return KEY_NAMES[code] ?? code;
  }

  // 단축키를 누르라는 말. 크롬이 단축키를 지정하지 못했으면(다른 확장과 겹침) 대신 갈 길을 알려 준다.
  function pressText(shortcut, purpose) {
    return shortcut
      ? `${shortcut} 키를 누르세요`
      : `${purpose} 단축키가 지정되어 있지 않습니다. 다른 확장 프로그램과 겹쳤거나 업데이트로 새로 생긴 단축키라서 크롬이 지정하지 못한 것입니다. 온글 메뉴의 온글 설정에서 지정 방법을 확인하세요`;
  }

  // 온글 켜기 단축키가 비어 있으면 지정 안내가 필요하다. commands: chrome.commands.getAll()의 결과.
  // 크롬은 manifest의 기본 단축키(suggested_key)를 최초 설치 때만 지정하므로, 업데이트로 새로 생긴 명령이나
  // 다른 확장과 겹친 명령은 빈 채로 남는다. 켜기 단축키가 없으면 온글을 켤 수 없어 안내조차 들을 수 없다.
  function needsShortcutSetup(commands = []) {
    return !commands.find((c) => c.name === 'toggle-reader')?.shortcut;
  }

  // 안내에 넘어온 키 이름 (없으면 기본 기능 키로)
  const keysOf = (p) => p.keys ?? keyNames();

  // 조합키와 함께 누르는 온글 명령의 읽는 말 ("Alt와 Shift와 S")
  function comboText(code) {
    return shortcutText(`${MODIFIER}+${codeText(code)}`);
  }

  // 온글 명령마다 지금 설정된 실제 키의 읽는 말. 안내·도움말·메뉴·가이드가 모두 이것을 쓴다.
  function keyNames(commandKeys = {}) {
    const keys = { ...DEFAULT_COMMAND_KEYS, ...commandKeys };
    return {
      ...Object.fromEntries(Object.entries(keys).map(([name, code]) => [name, comboText(code)])),
      sayAll: comboText('ArrowDown'),
      sayAllAlt: comboText('KeyA'),
      reread: comboText('KeyR'),
      stop: comboText('KeyX'),
      mode: comboText('Space'),
      help: comboText('Digit1'),
      results: comboText('KeyI'),
      modifier: shortcutText(MODIFIER)
    };
  }

  // p: 안내에 넣을 값. toggle(켜기/끄기 단축키), menu(메뉴 단축키), keys(keyNames의 온글 명령 키 이름) 등.
  // 키 이름 뒤에는 조사 대신 "키를"을 붙여 어떤 키 이름이든 자연스럽게 읽히게 한다.
  // action은 "온글 메뉴를 열"처럼 "수 없습니다" 앞에 바로 붙는 말, result는 완성된 문장으로 넘긴다.
  const MESSAGES = {
    'reader-on': {
      detailed: (p) =>
        `온글이 켜졌습니다. 지금 페이지는 ${p.title || '제목 없는 페이지'}입니다. ${p.counts ? `${p.counts}. ` : ''}아래 화살표를 누르면 페이지를 한 항목씩 읽습니다. ` +
        `${p.menu || keysOf(p).menu} 키를 누르면 온글 메뉴가 열립니다. ` +
        '메뉴의 첫 항목은 사용 가이드이고, 그 아래에서 요약, 질문 같은 기능을 고를 수 있습니다. ' +
        `${keysOf(p).help} 키를 누르면 키 도움말을 듣습니다.`,
      short: (p) => `온글 켜짐. ${p.title || ''}${p.counts ? `, ${p.counts}` : ''}`
    },
    // 설치 직후 서비스 워커가 읽는 시작 안내 (항상 자세히)
    'welcome': {
      always: true,
      detailed: (p) =>
        '온글이 설치되었습니다. 온글은 웹페이지를 화면 자막, 음성, 점자로 읽어 주고, 읽을 수 없는 부분은 AI로 채우는 스크린리더입니다. ' +
        'NVDA나 센스리더 같은 다른 스크린리더를 쓰고 있다면 먼저 꺼 주세요. ' +
        `온글을 켜려면 ${pressText(p.toggle, '온글 켜기')}. ` +
        `켠 다음 ${p.menu || keysOf(p).menu} 키를 누르면 온글 메뉴가 열리고, 첫 항목에서 사용 가이드를 들을 수 있습니다. ` +
        '지금 열린 온글 설정 화면에서는 AI 기능, 음성, 점자를 설정할 수 있습니다.'
    },
    // 설치·업데이트 뒤 켜기 단축키가 비어 있을 때 서비스 워커가 크롬 단축키 설정 화면을 열고 읽는 안내 (항상 자세히)
    'shortcut-missing': {
      always: true,
      detailed: () =>
        '온글 단축키가 지정되지 않아 지금은 온글을 켤 수 없습니다. 방금 크롬 단축키 설정 화면을 새 탭으로 열었습니다. ' +
        '이 화면은 크롬 설정 화면이라 온글이 읽을 수 없으므로, 다른 스크린리더나 주변 사람의 도움을 받으세요. ' +
        `열린 화면의 온글 항목에서 온글 켜기/끄기에 ${comboText('KeyO')} 키를 지정하세요. ` +
        `온글 메뉴 열기, 읽기 멈춤, 현재 위치 다시 읽기가 비어 있으면 ${comboText('KeyM')}, ${comboText('KeyX')}, ${comboText('KeyR')} 키를 지정합니다. ` +
        `지정한 뒤 ${comboText('KeyO')} 키를 누르면 온글이 켜집니다.`
    },
    'reader-off': {
      detailed: (p) => `온글이 꺼졌습니다. 이제 온글이 페이지를 읽지 않습니다. 다시 켜려면 ${pressText(p.toggle, '온글 켜기')}.`,
      short: () => '온글 꺼짐'
    },
    'reader-off-command': {
      always: true,
      detailed: (p) =>
        `온글이 꺼져 있어서 ${p.action} 수 없습니다. 온글을 켜려면 ${pressText(p.toggle, '온글 켜기')}. 켠 다음 다시 시도하세요.`
    },
    'focus-mode': {
      detailed: (p) =>
        `글쓰기 모드. 지금 ${p.field || '편집창'}에 있고, 이제 누르는 키가 그대로 입력됩니다. ` +
        `다 입력했으면 Esc를 누르세요. 읽기 모드로 돌아가 화살표로 페이지를 다시 읽을 수 있습니다.`,
      short: () => '글쓰기 모드'
    },
    'browse-mode': {
      detailed: () => '읽기 모드. 이제 화살표와 한 글자 키로 페이지를 읽고 이동합니다. 편집창에서 Enter를 누르면 다시 글쓰기 모드가 됩니다.',
      short: () => '읽기 모드'
    },
    'page-start': {
      detailed: () => '페이지 처음입니다. 위쪽에는 더 읽을 항목이 없습니다. 아래 화살표를 누르면 다음 항목을 읽습니다.',
      short: () => '페이지 처음'
    },
    'page-end': {
      detailed: () =>
        '페이지 끝입니다. 아래쪽에는 더 읽을 항목이 없습니다. 위 화살표를 누르면 이전 항목을, Ctrl과 Home을 누르면 페이지 처음을 읽습니다.',
      short: () => '페이지 끝'
    },
    'not-found': {
      detailed: (p) =>
        p.backward
          ? `위쪽에 남은 ${p.label} 없음. 지금 위치는 그대로입니다. 아래쪽에서 찾으려면 ${p.key} 키만 누르세요.`
          : `아래쪽에 남은 ${p.label} 없음. 지금 위치는 그대로입니다. 위쪽에서 찾으려면 Shift와 ${p.key} 키를 누르세요.`,
      short: (p) => `${p.backward ? '이전' : '다음'} ${p.label} 없음`
    },
    'unreadable-page': {
      always: true,
      detailed: (p) =>
        `${p.title || '이 탭'}. 이 페이지는 크롬 설정 화면이나 웹스토어처럼 확장 프로그램이 들어갈 수 없는 페이지라서 온글이 읽을 수 없습니다. ` +
        'Ctrl과 W를 누르면 이 탭을 닫고, Ctrl과 Tab을 누르면 다음 탭으로 이동합니다. 일반 웹페이지로 가면 온글이 다시 읽습니다.'
    },
    'reload-needed': {
      always: true,
      detailed: (p) =>
        `${p.title || '이 페이지'}. 이 페이지는 온글을 설치하거나 업데이트하기 전에 열려 있어서 아직 온글이 들어가 있지 않습니다. ` +
        'F5 키를 누르면 페이지를 새로 불러오고, 그다음부터 온글이 읽습니다.'
    },
    'ai-requested': {
      detailed: (p) => `${p.task} 작업을 시작했습니다. 끝나면 바로 읽어 드립니다. 기다리는 동안 다른 곳을 읽어도 됩니다.`,
      short: (p) => `${p.task} 중`
    },
    'ai-analyzing': {
      detailed: (p) =>
        `${p.kind} 이름이 없어 읽을 수 없는 부분입니다. AI가 내용을 분석하고 있습니다. 이 자리에 있으면 끝나는 대로 읽어 드리고, ` +
        `다른 곳으로 이동해도 분석은 계속됩니다. 결과는 ${keysOf(p).results} 키를 누르면 AI 결과 모음에서 들을 수 있습니다.`,
      short: () => 'AI 분석 중'
    },
    'ai-supplement-off': {
      detailed: (p) => `이름 없는 항목을 AI로 분석하지 못했습니다. ${p.error}`,
      short: () => 'AI 분석 안 됨, AI 설정 확인 필요'
    },
    'ai-results-empty': {
      always: true,
      detailed: (p) =>
        `AI 결과 모음이 비어 있습니다. 이름 없는 항목을 읽거나, ${keysOf(p).summary} 키로 요약하거나, ${keysOf(p).ask} 키로 질문하면 결과가 여기에 모입니다.`
    },
    'focus-outside-page': {
      always: true,
      detailed: (p) =>
        `지금 키보드 초점이 주소창이나 크롬 메뉴처럼 웹페이지 밖에 있어서 ${p.action} 수 없습니다. ` +
        `F6 키를 누르면 초점이 주소창에서 웹페이지 본문으로 옮겨지고, 이어서 ${p.result}`
    },
    'returned-to-page': {
      detailed: () => '웹페이지 본문으로 이동했습니다.',
      short: () => '웹페이지로 이동'
    },
    'menu-opened': {
      detailed: (p) =>
        `온글 메뉴. ${p.count}개 중 ${p.position}번, ${p.label}. ` +
        '위아래 화살표로 기능을 고르고 Enter를 누르면 실행합니다. 기능 이름의 첫 글자를 누르면 그 기능으로 이동합니다. Esc를 누르면 메뉴를 닫고 읽던 위치로 돌아갑니다.',
      short: (p) => `온글 메뉴. ${p.count}개 중 ${p.position}번, ${p.label}`
    },
    'menu-closed': {
      detailed: () => '온글 메뉴를 닫았습니다. 원래 읽던 위치로 돌아왔습니다.',
      short: () => '메뉴 닫음'
    },
    'list-opened': {
      detailed: (p) =>
        `${p.title}. ${p.count}개 중 ${p.position}번, ${p.label}. ` +
        '위아래 화살표로 고르고 Enter를 누르면 그 위치로 이동해 읽습니다. Esc를 누르면 온글 메뉴로 돌아갑니다.',
      short: (p) => `${p.title}. ${p.count}개 중 ${p.position}번, ${p.label}`
    },
    'list-empty': {
      always: true,
      detailed: (p) => `이 페이지에서 찾은 ${p.label}, 0개. 온글 메뉴로 돌아갑니다. 다른 기능을 고르거나 Esc로 메뉴를 닫으세요.`
    },
    'pending-menu': {
      detailed: () => '웹페이지 본문으로 이동했습니다. 온글 메뉴를 엽니다.',
      short: () => '웹페이지로 이동'
    },
    'activate-unavailable': {
      detailed: () => '이 항목은 누를 수 있는 항목이 아닙니다. 위아래 화살표로 링크나 버튼으로 이동한 뒤 Enter를 누르세요.',
      short: () => '누를 수 없는 항목'
    }
  };

  function help(p) {
    const k = keysOf(p);
    return [
      `키 도움말. 온글 명령은 모두 ${k.modifier}를 누른 채 다른 키를 함께 누릅니다.`,
      `${p.menu && p.menu !== k.menu ? `${p.menu} 키 또는 ` : ''}${k.menu} 키를 누르면 온글 메뉴가 열립니다. 모든 기능을 목록에서 골라 실행할 수 있습니다.`,
      '읽기. 아래 화살표, 다음 항목. 위 화살표, 이전 항목. Ctrl과 Home, 페이지 처음. Ctrl과 End, 페이지 끝. Ctrl, 읽기 멈춤.',
      `${k.sayAll} 또는 ${k.sayAllAlt}, 지금 위치부터 끝까지 계속 읽기. ${p.reread || k.reread}, 어디서든 현재 위치 다시 읽기. ${p.stop || k.stop}, 어디서든 읽기 멈춤.`,
      '한 글자로 이동. H 제목, K 링크, B 버튼, F 입력 요소, E 편집창, X 체크박스, R 라디오 버튼, C 콤보 상자, T 표, L 목록, G 그래픽, D 영역. Shift를 함께 누르면 위쪽으로 찾습니다. 숫자 1부터 6은 그 수준의 제목입니다.',
      `Enter 또는 스페이스, 지금 항목 누르기. 편집창에서 Enter를 누르면 글쓰기 모드가 되고, Esc를 누르면 읽기 모드로 돌아옵니다. ${k.mode}로도 두 모드를 바꿉니다.`,
      `기능. ${k.summary}, 페이지 요약. ${k.ask}, 페이지에 질문. ${k.detail}, 상세 이미지 읽기. ${k.explain}, 현재 항목 AI 설명. ${k.results}, AI 결과 모음. ${k.help}, 이 도움말.`,
      '이름 없는 버튼이나 그림을 읽으면 AI가 자동으로 분석해 이름을 붙이고, AI가 붙인 이름 뒤에는 AI 추정이라고 읽습니다.',
      `온글을 켜고 끄려면 ${pressText(p.toggle, '온글 켜기')}. 기능 키 글자는 온글 설정에서 바꿀 수 있습니다.`
    ].join(' ');
  }

  // 안내 문장 고르기. seen: 안내별로 읽은 횟수(자동 모드에서 씀)
  function message(id, params = {}, { verbosity = 'auto', seen = 0 } = {}) {
    const entry = MESSAGES[id];
    if (!entry) return '';
    const detailed =
      entry.always || !entry.short || verbosity === 'detailed' || (verbosity === 'auto' && seen < AUTO_DETAILED_TIMES);
    return (detailed ? entry.detailed : entry.short)(params);
  }

  ns.guidance = { MESSAGES, AUTO_DETAILED_TIMES, MODIFIER, message, help, shortcutText, codeText, comboText, keyNames, pressText, needsShortcutSetup };
})();
