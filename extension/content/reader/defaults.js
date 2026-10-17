// 온글 스크린리더 설정 기본값. content script와 lib/settings.js(import로 불러옴)가 같이 쓴다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.defaults) return;

  ns.defaults = {
    reader: {
      // Alt+Shift(macOS는 Option+Shift)와 함께 누르는 기능 키 (event.code)
      commandKeys: { summary: 'KeyS', ask: 'KeyQ', detail: 'KeyD', explain: 'KeyE', menu: 'KeyM' },
      // 이름 없는 항목을 읽을 때 AI로 자동 분석 (AI 기능이 켜져 있을 때만)
      autoSupplement: true,
      // 안내 자세히: auto(처음 3번 자세히), detailed(항상 자세히), short(항상 짧게)
      verbosity: 'auto',
      // 자막 패널 위치: bottom(아래) 또는 top(위)
      captionPosition: 'bottom'
    },
    speech: { voiceName: '', rate: 1 },
    // 점자: grade 2(약자 사용) 또는 1(약자 없음), 디스플레이 칸 수, 관리자 도구(점자 전달 테스트 버튼)
    braille: { grade: 2, cells: 40, adminTools: false },
    // 기능 키로 고를 수 없는 키: Alt+Shift와 함께 이미 다른 명령에 쓰는 글자
    reservedCommandKeys: {
      KeyA: '계속 읽기',
      KeyR: '현재 위치 다시 읽기',
      KeyX: '읽기 멈춤',
      KeyO: '온글 켜기/끄기',
      KeyI: 'AI 결과 모음'
    }
  };

  // 저장된 설정에 기본값을 채운다
  // 예전 설정의 온글 키(ongeulKeys)는 버리고, 이제 다른 명령에 쓰는 글자로 저장된 기능 키는 기본값으로 되돌린다
  ns.mergeReaderSettings = (stored = {}) => {
    const { ongeulKeys, ...reader } = stored.reader ?? {};
    const commandKeys = { ...ns.defaults.reader.commandKeys };
    for (const [name, code] of Object.entries(reader.commandKeys ?? {})) {
      if (name in commandKeys && !ns.defaults.reservedCommandKeys[code]) commandKeys[name] = code;
    }
    // 되돌린 기본값이 다른 기능 키와 겹치면 기능 키를 모두 기본값으로 되돌린다
    if (new Set(Object.values(commandKeys)).size < Object.keys(commandKeys).length) {
      Object.assign(commandKeys, ns.defaults.reader.commandKeys);
    }
    return {
      reader: { ...ns.defaults.reader, ...reader, commandKeys },
      speech: { ...ns.defaults.speech, ...stored.speech },
      braille: { ...ns.defaults.braille, ...stored.braille }
    };
  };
})();
