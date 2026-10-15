// 아이콘 클릭이나 단축키로 주입된다. 다시 주입되면 이미 정의된 run만 다시 실행한다.
(() => {
  if (window.__ssucreamDetail) {
    window.__ssucreamDetail();
    return;
  }

  // 화면에는 보이지 않고 스크린리더만 읽는 스타일
  const SR_ONLY =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
    'clip:rect(0,0,0,0);white-space:nowrap;border:0;';
  const LAZY_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'ec-data-src'];
  const MAX_IMAGES = 60;
  const MIN_RENDERED_WIDTH = 300;
  let busy = false;

  function statusRegion() {
    let region = document.getElementById('ssucream-status');
    if (!region) {
      region = document.createElement('div');
      region.id = 'ssucream-status';
      region.setAttribute('role', 'status');
      region.style.cssText = SR_ONLY;
      document.body.append(region);
    }
    return region;
  }

  // 진행 상태(running, done, error). 평가 도구가 끝났는지 판단할 때 쓴다.
  function setState(state) {
    statusRegion().dataset.state = state;
  }

  let announceTimer = null;
  function announce(text) {
    const region = statusRegion();
    // 같은 문장도 다시 읽히도록 비운 뒤 채운다.
    region.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => (region.textContent = text), 100);
  }

  function imageUrl(img) {
    for (const attr of LAZY_ATTRS) {
      const value = img.getAttribute(attr);
      if (value && !value.startsWith('data:')) return new URL(value, document.baseURI).href;
    }
    const src = img.currentSrc || img.src;
    return src && !src.startsWith('data:') ? src : null;
  }

  // 문서 순서대로 후보 이미지를 모은다. 정확한 판별은 서비스 워커가 실제 크기로 한다.
  function collectImages() {
    const found = new Map();
    for (const img of document.images) {
      if (img.closest('header, nav, footer, #ssucream-detail')) continue;
      const width = img.getBoundingClientRect().width;
      if (width > 0 && width < MIN_RENDERED_WIDTH) continue;
      const url = imageUrl(img);
      if (!url || found.has(url)) continue;
      found.set(url, img);
      if (found.size >= MAX_IMAGES) break;
    }
    return found;
  }

  function el(tag, text) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    return node;
  }

  function render(result, images) {
    document.getElementById('ssucream-detail')?.remove();

    const section = el('section');
    section.id = 'ssucream-detail';
    section.setAttribute('aria-labelledby', 'ssucream-detail-title');
    section.style.cssText = SR_ONLY;

    const title = el('h2', '상세 이미지 내용, AI 추출');
    title.id = 'ssucream-detail-title';
    title.tabIndex = -1;
    section.append(title);

    let note = `상세 이미지 ${result.imageCount}개에서 AI가 읽은 내용입니다. 틀릴 수 있으니 가격 같은 중요한 정보는 판매자에게 확인하세요.`;
    if (result.truncated) note += ' 이미지가 많아 앞부분만 읽었습니다.';
    if (result.failedCount) note += ` 이미지 ${result.failedCount}개는 가져오지 못했습니다.`;
    section.append(el('p', note));

    if (!result.sections.length) section.append(el('p', '이미지에서 읽을 글자를 찾지 못했습니다.'));
    for (const { title: heading, items } of result.sections) {
      const list = el('ul');
      for (const item of items) list.append(el('li', item));
      section.append(el('h3', heading), list);
    }

    const anchor = images.get(result.firstUrl);
    if (anchor) (anchor.closest('a') ?? anchor).before(section);
    else document.body.prepend(section);

    title.focus();
    setState('done');
    // 온글 스크린리더가 켜져 있으면 추출한 내용을 처음부터 끝까지 바로 읽고, 아니면 안내 영역으로 알린다
    const reader = globalThis.__ongeul?.reader;
    globalThis.__ongeul?.ai?.addResult({ kind: 'detail', title: `상세 이미지 내용, ${result.sections.length}개 항목`, el: section });
    if (reader?.enabled) {
      // 끝난 진행 안내("읽은 내용 정리 중" 등)가 결과 읽기 사이에 끼지 않게 지운다
      clearTimeout(announceTimer);
      statusRegion().textContent = '';
      reader.readElement(section);
    } else announce('완료. 상세 이미지 내용으로 이동했습니다.');
  }

  async function run() {
    if (busy) {
      announce('이미 상세 이미지를 읽는 중입니다.');
      return;
    }
    busy = true;
    setState('running');
    const fail = (text) => {
      setState('error');
      announce(text);
    };
    try {
      const images = collectImages();
      if (!images.size) {
        fail('이 페이지에서 이미지를 찾지 못했습니다.');
        return;
      }
      announce('상세 이미지를 찾는 중입니다.');
      const result = await chrome.runtime.sendMessage({ type: 'extract-detail', urls: [...images.keys()] });
      if (result?.error) fail(result.error);
      else render(result, images);
    } catch (error) {
      fail(`오류가 발생했습니다. ${error.message}`);
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'progress') announce(message.text);
  });

  window.__ssucreamDetail = run;
  run();
})();
