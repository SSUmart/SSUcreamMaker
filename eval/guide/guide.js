// 온글 설치 가이드: 운영체제(Windows·Mac) 고르기, 단계 마침 체크(이 브라우저에만 기억), 복사 버튼
(() => {
  const KEY = 'ongeul-guide';
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  const save = (state) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 저장할 수 없는 브라우저(사생활 보호 창 등)에서는 기억하지 않는다
    }
  };
  const state = load();

  // 운영체제: 저장한 값 → 브라우저가 알려 주는 값 → Windows
  const detected = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent) ? 'mac' : 'win';
  const status = document.getElementById('os-status');
  function setOs(os) {
    document.body.classList.remove('os-win', 'os-mac');
    document.body.classList.add(`os-${os}`);
    for (const b of document.querySelectorAll('.os-btn')) b.setAttribute('aria-pressed', String(b.dataset.os === os));
    const text = os === 'mac' ? 'Mac(애플 실리콘) 기준으로 안내합니다.' : 'Windows 기준으로 안내합니다.';
    status.textContent = text;
    state.os = os;
  }
  setOs(state.os === 'mac' || state.os === 'win' ? state.os : detected);
  for (const b of document.querySelectorAll('.os-btn')) {
    b.addEventListener('click', () => {
      setOs(b.dataset.os);
      save(state);
    });
  }

  // 단계 마침 체크
  const boxes = [...document.querySelectorAll('.done input[data-step]')];
  const bar = document.getElementById('bar');
  const progress = document.getElementById('progress-text');
  state.done = state.done || {};
  function render() {
    let count = 0;
    for (const box of boxes) {
      const on = Boolean(state.done[box.dataset.step]);
      box.checked = on;
      box.closest('.step').classList.toggle('is-done', on);
      if (on) count++;
    }
    bar.style.width = `${(count / boxes.length) * 100}%`;
    progress.textContent = count === boxes.length ? `${count} / ${boxes.length} 단계 모두 마침. 설치가 끝났습니다!` : `${count} / ${boxes.length} 단계 마침`;
  }
  for (const box of boxes) {
    box.addEventListener('change', () => {
      state.done[box.dataset.step] = box.checked;
      save(state);
      render();
    });
  }
  render();
  document.getElementById('reset').addEventListener('click', () => {
    state.done = {};
    save(state);
    render();
    document.getElementById('steps').scrollIntoView();
  });

  // 복사 버튼
  for (const btn of document.querySelectorAll('.copy')) {
    btn.addEventListener('click', async () => {
      const label = btn.textContent;
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = '복사했어요';
      } catch {
        btn.textContent = '직접 입력하세요';
      }
      setTimeout(() => (btn.textContent = label), 2000);
    });
  }
})();
