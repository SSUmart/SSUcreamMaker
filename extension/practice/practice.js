// 온글 연습: 단계마다 맞게 눌렀는지 확인하고, 맞으면 "잘했습니다"와 다음 단계를 알려 준다.
// 온글(reader.js)이 키를 먼저 처리하므로, 처리가 끝난 뒤(keyup)에 읽기 위치와 페이지 상태를 보고 판단한다.
(() => {
  const ns = globalThis.__ongeul;
  const steps = [...document.querySelectorAll('.step[data-step]')].filter((step) => step.dataset.step !== 'finish');
  const progress = document.getElementById('progress');
  let current = 0;
  let menuWasOpen = false;

  const at = (id) => ns.reader?.items[ns.reader.index]?.el?.id === id;

  // 단계별 확인. code: 방금 뗀 키
  const CHECKS = {
    read: () => at('read-goal'),
    heading: (code) => code === 'KeyH' && at('heading-goal'),
    button: () => false, // 버튼 클릭으로 확인 (아래 click)
    // 고른 뒤 Esc로 읽기 모드로 돌아와야 끝 (글쓰기 모드에 머물면 화살표가 페이지를 읽지 않음)
    choose: () => document.getElementById('choose-goal').value === '파랑' && !ns.reader?.focusMode,
    // 메뉴를 열었다가 닫으면 끝
    menu: () => {
      if (ns.menu?.isOpen) menuWasOpen = true;
      return menuWasOpen && !ns.menu?.isOpen;
    }
  };

  function render() {
    steps.forEach((step, i) => {
      step.classList.toggle('done', i < current);
      step.classList.toggle('current', i === current);
    });
    progress.textContent = `${current}/${steps.length} 단계 완료`;
  }

  function complete() {
    current++;
    render();
    const next = steps[current];
    const text = next
      ? `잘했습니다. ${current}단계 완료. 다음은 ${next.querySelector('h2').textContent}. 아래 화살표로 설명을 들으세요.`
      : '잘했습니다. 다섯 단계를 모두 마쳤습니다. 아래 화살표로 다음에 할 일을 들으세요.';
    // 온글이 방금 한 동작(버튼 누름 알림, 메뉴 닫힘 등)을 읽은 뒤에 이어서 읽는다
    setTimeout(() => ns.reader?.say(text, { interrupt: false }), 400);
  }

  function check(code) {
    const step = steps[current];
    if (step && CHECKS[step.dataset.step](code)) complete();
  }

  document.addEventListener('keyup', (event) => setTimeout(() => check(event.code), 50), true);
  document.getElementById('button-goal').addEventListener('click', () => {
    if (steps[current]?.dataset.step === 'button') complete();
  });
  document.getElementById('choose-goal').addEventListener('change', () => check(''));

  // 맥에서는 Alt 대신 Option
  if (/Mac/i.test(navigator.platform)) {
    document.getElementById('menu-key').textContent = 'Option과 Shift와 M을 함께 눌러 온글 메뉴를 열었다가 Esc로 닫아 보세요.';
  }
  render();
})();
