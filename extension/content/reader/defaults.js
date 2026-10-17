// 온글 스크린리더 설정 기본값. content script와 lib/settings.js(import로 불러옴)가 같이 쓴다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.defaults) return;

  ns.defaults = {
    reader: {
      // 온글 키: Insert, CapsLock(Windows에서만), CtrlAlt(Ctrl과 Alt를 함께, macOS는 Control과 Option)
      ongeulKeys: ['Insert', 'CapsLock', 'CtrlAlt'],
      // 온글 키와 함께 누르는 기능 키 (event.code)
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
    // 기능 키로 고를 수 없는 키: 온글 키+A(계속 읽기), L(다시 읽기), I(AI 결과 모음, 6단계)
    reservedCommandKeys: { KeyA: '계속 읽기', KeyL: '현재 항목 다시 읽기', KeyI: 'AI 결과 모음' }
  };

  // 저장된 설정에 기본값을 채운다
  ns.mergeReaderSettings = (stored = {}) => ({
    reader: {
      ...ns.defaults.reader,
      ...stored.reader,
      commandKeys: { ...ns.defaults.reader.commandKeys, ...stored.reader?.commandKeys }
    },
    speech: { ...ns.defaults.speech, ...stored.speech },
    braille: { ...ns.defaults.braille, ...stored.braille }
  });
})();
