// A1 AI 자동 보완과 AI 결과 모음.
// - 이름이 없어 읽을 수 없는 항목(이름 없는 버튼·링크, alt 없는 그림 등)을 읽으면 "AI 분석 중"이라고 알리고 탐색을 계속하게 한다.
//   분석이 끝났을 때 아직 그 항목에 있으면 바로 이어 읽고, 다른 곳에 있으면 알리지 않는다(궁금하면 AI 결과 모음에서 확인).
//   결과는 그 항목의 이름으로 붙어 다시 오면 "…, AI 추정"으로 읽는다. 페이지를 열면 앞쪽 몇 개는 미리 분석한다.
// - AI를 부르기 전에, 요소 단서(클래스·아이디·주소)가 흔한 아이콘 이름과 확실히 맞으면(cart → 장바구니, wish·heart → 찜하기 등)
//   기다리지 않고 바로 "…, 추정"으로 읽는다. AI가 꺼져 있어도 동작한다. 되돌리기 어려운 동작(삭제·결제 등)의 단서가 있으면 AI 교차 검증에 맡긴다.
// - 모양이 같은 항목(상품마다 반복되는 아이콘 버튼 등)은 한 번만 AI에 묻고 그 이름을 함께 쓴다.
// - AI 결과 모음(Alt+Shift+I): 자동 보완, 요약, 상세 이미지 읽기, 질문 답, 항목 설명 결과를 모아 다시 듣는다.
// - 현재 항목 AI 설명(Alt+Shift+E, 기능 키는 설정에서 바꿈): 지금 읽는 항목을 AI가 1~3문장으로 설명한다 (예전 항목 설명 모드를 대신함).
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.ai) return;

  const PREFETCH = 5;
  const MAX_AUTO_PER_PAGE = 30;
  // 파괴적 동작 단서: 요소의 클래스·아이디·주소 등에 이런 말이 있는데 AI 이름에 그런 뜻이 없으면 "용도 불명확"으로 읽는다
  // clear·empty는 clearfix처럼 흔한 CSS 클래스에도 들어 있어 장바구니·전체 같은 말과 붙은 경우만 본다
  const DESTRUCTIVE_HINT = /(delete|remove|trash|cancel|withdraw|leave|unsubscribe|logout|signout|payment|checkout|purchase|(?:clear|empty)[-_]?(?:all|cart|basket|bag|list)|(?:cart|basket|bag)[-_]?(?:clear|empty)|삭제|취소|탈퇴|결제|구매|해지|비우)/i;
  const DESTRUCTIVE_WORD = /(삭제|지우|제거|취소|탈퇴|결제|구매|주문|로그아웃|해지|비우|휴지통|초기화)/;

  // 요소 단서 → 이름. 뜻이 하나로 정해지는 아이콘 말만 둔다 (like는 좋아요·도움돼요 등 뜻이 여럿이라 AI에 맡김).
  // 앞쪽이 먼저: search-close는 닫기. 짧은 말은 앞뒤가 다른 글자가 아닐 때만 (context의 next, display의 play 등을 피함)
  const HINT_NAMES = [
    [/(?<![a-z])(close|dismiss)(?![a-z])/, '닫기'],
    [/(?<![a-z])(cart|basket)/, ({ role, counted }) => (role === 'link' || counted ? '장바구니' : '장바구니 담기')],
    [/(?<![a-z])(wish|zzim|jjim|heart)/, '찜하기'],
    [/(?<![a-z])(search|magnif)/, '검색'],
    [/(?<![a-z])share/, '공유하기'],
    [/(?<![a-z])(hamburger|all-?menu|menu-(toggle|btn|open)|btn-menu|nav-toggle|gnb-open)(?![a-z])/, '메뉴'],
    [/(?<![a-z])(log-?in|sign-?in)(?![a-z])/, '로그인'],
    [/(?<![a-z])(my-?page|my-?info)(?![a-z])/, '마이페이지'],
    [/(?<![a-z])(scroll-?top|go-?top|to-top|btn-top|top-btn|back-to-top)(?![a-z])/, '맨 위로'],
    [/(?<![a-z])(prev|previous)(?![a-z])/, '이전'],
    [/(?<![a-z])next(?![a-z])/, '다음'],
    [/(?<![a-z])play(?![a-z])/, '재생'],
    [/(?<![a-z])pause(?![a-z])/, '일시 정지'],
    [/(?<![a-z])(notification|alarm|bell)(?![a-z])/, '알림']
  ];
  const HINT_ROLES = new Set(['link', 'button']);

  const labels = new WeakMap(); // 요소 → { label, hint } (hint: 요소 단서로 붙인 이름)
  const pending = new WeakSet();
  const shapeLabels = new Map(); // 모양 → AI 이름
  const shapeWaiting = new Map(); // 모양 → AI 답을 기다리는 같은 모양 항목들
  const queue = [];
  let running = false;
  let autoCount = 0;
  let aiError = '';
  let aiErrorAnnounced = false;
  // AI 결과 모음 (최근 것이 앞)
  const results = [];

  const reader = () => ns.reader;
  const say = (text, options) => ns.output?.say(text, options);
  const roleName = (item) => (item.role === 'heading' ? `제목 ${item.level}` : ns.model.ROLE_NAMES[item.role] || '항목');

  function autoOn() {
    return reader()?.settings?.reader?.autoSupplement !== false;
  }

  // 요소 단서 글: 아이디, 클래스, name, data-action, 안의 아이콘(use·i·span·svg)의 주소·클래스, 링크 주소의 경로.
  // 그림 파일 이름(상품 사진 등)과 주소의 도메인은 넣지 않는다 (heart-bag.jpg, heartmall.com 같은 말에 속지 않게).
  // fooBar는 foo-bar로 나눠 소문자로 바꾼다
  function hintText(el) {
    const parts = [el.id, el.getAttribute('class'), el.getAttribute('name'), el.getAttribute('data-action')];
    el.querySelectorAll('use, i, span[class], svg[class]').forEach((child) => {
      parts.push(child.getAttribute('href') || child.getAttribute('xlink:href'), child.getAttribute('class'));
    });
    if (el.matches('a[href]')) {
      try {
        parts.push(new URL(el.href).pathname);
      } catch {
        // 주소가 아니면 넘어간다
      }
    }
    return parts
      .filter(Boolean)
      .join(' ')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
  }

  // 단서 글로 정한 이름 (없으면 ''). counted: 이름 대신 개수 숫자만 있던 항목(장바구니 개수 등)
  function hintName(text, { role, counted = false } = {}) {
    if (!text || DESTRUCTIVE_HINT.test(text)) return '';
    for (const [pattern, name] of HINT_NAMES) {
      if (pattern.test(text)) return typeof name === 'function' ? name({ role, counted }) : name;
    }
    return '';
  }

  // 모양: 같은 모양의 이름 없는 항목은 같은 이름을 갖는다고 본다 (상품마다 반복되는 찜 버튼 등).
  // 링크 주소와 그림 주소를 넣어, 주소나 그림이 다른 항목(상품마다 다른 사진 링크 등)은 서로 다른 모양이 된다.
  // 클래스·아이콘·그림·주소 단서가 하나도 없으면 같은 모양으로 묶지 않는다
  function shapeKey(item) {
    const el = item.el;
    const icons = [...el.querySelectorAll('svg, img, i, use')]
      .slice(0, 5)
      .map((child) => child.getAttribute('src') || child.getAttribute('href') || child.getAttribute('class') || child.innerHTML.slice(0, 300));
    const cls = el.getAttribute('class') ?? '';
    const href = el.getAttribute('href') ?? '';
    if (!cls.trim() && !href && !icons.some(Boolean)) return '';
    return [item.role, el.tagName, cls, href, ...icons].join('|');
  }

  // 이미 알고 있는 이름: 이 요소에 붙인 이름 → 요소 단서 → 같은 모양 항목의 AI 이름
  function knownLabel(item) {
    const el = item.el;
    let known = labels.get(el);
    if (known) return known;
    if (HINT_ROLES.has(item.role)) {
      const label = hintName(hintText(el), { role: item.role, counted: Boolean(item.countText) });
      if (label) known = { label, hint: true };
    }
    if (!known) {
      const key = shapeKey(item);
      if (key && shapeLabels.has(key)) known = { label: shapeLabels.get(key) };
    }
    if (known) labels.set(el, known);
    return known;
  }

  // 알고 있는 이름을 읽기 항목에 붙인다 (목록을 만들 때, 이동할 때)
  function decorate(item) {
    if (!item?.needsName) return item;
    const known = knownLabel(item);
    if (!known) return item;
    const next = { ...item, name: known.label, aiName: !known.hint, hintName: Boolean(known.hint), needsName: false };
    next.phrase = ns.model.phraseOf(next);
    return next;
  }

  // 파괴적 동작 교차 검증과 확신 정도를 반영한 이름
  function finalLabel(el, { label, confident }) {
    const hint = ns.describe.hintsOf(el).match(DESTRUCTIVE_HINT)?.[0];
    if (hint && !DESTRUCTIVE_WORD.test(label)) return `용도 불명확, ${hint} 관련일 수 있음`;
    return confident ? label : `${label}일 수 있음`;
  }

  function addResult(entry) {
    const existing = results.findIndex((r) => r.el && r.el === entry.el && r.kind === entry.kind);
    if (existing !== -1) results.splice(existing, 1);
    results.unshift({ at: new Date(), status: 'done', ...entry });
    return results[0];
  }

  function request(item, { announce }) {
    const el = item.el;
    if (labels.has(el) || pending.has(el) || aiError) return false;
    // 같은 모양 항목을 이미 묻고 있으면 새로 묻지 않고 그 답을 기다린다 (분석 개수에도 세지 않음)
    const key = shapeKey(item);
    if (key && shapeWaiting.has(key)) {
      pending.add(el);
      shapeWaiting.get(key).push(item);
      return true;
    }
    if (autoCount >= MAX_AUTO_PER_PAGE) return false;
    pending.add(el);
    autoCount++;
    if (key) shapeWaiting.set(key, []);
    const entry = addResult({ kind: 'label', title: `${roleName(item)}, AI 분석 중`, el, status: 'pending' });
    queue.push({ item, entry, announce, key });
    pump();
    return true;
  }

  // 한 번에 하나씩 분석한다 (무료 AI 한도와 요금 보호)
  async function pump() {
    if (running || !queue.length) return;
    running = true;
    const { item, entry, announce, key } = queue.shift();
    const waiting = () => (key && shapeWaiting.get(key)) || [];
    try {
      const response = await chrome.runtime.sendMessage({ type: 'label-item', item: ns.describe.describeElement(item.el, item) });
      if (!response || response.error) throw new Error(response?.error ?? '응답이 없습니다.');
      const label = finalLabel(item.el, response);
      labels.set(item.el, { label });
      if (key) shapeLabels.set(key, label);
      for (const other of waiting()) labels.set(other.el, { label });
      entry.status = 'done';
      entry.title = `${label}, ${roleName(item)}, AI 추정`;
      delivered([item, ...waiting()]);
    } catch (error) {
      entry.status = 'error';
      entry.title = `${roleName(item)}, AI 분석 실패`;
      // AI가 꺼져 있거나 키가 없거나, ChatGPT 연결이 준비되지 않았거나(연결 프로그램 없음, 로그인 안 됨) 사용 한도에 닿으면
      // 더 묻지 않고 한 번만 알린다
      if (/꺼져 있습니다|API 키가 없습니다|모델을 고르지|연결 프로그램이 설치되어 있지 않습니다|로그인되어 있지 않습니다|로그인이 풀렸습니다|사용 한도|Codex CLI를 찾지 못했습니다|Codex CLI를 실행하지 못했습니다/.test(error.message)) {
        aiError = error.message;
        queue.length = 0;
        // 미리 분석(사용자가 아직 그 항목에 가지 않음)에서 난 오류는 알리지 않고, 사용자가 이름 없는 항목에 갔을 때 알린다
        if (announce && !aiErrorAnnounced) {
          aiErrorAnnounced = true;
          reader()?.guide('ai-supplement-off', { error: error.message }, { interrupt: false });
        }
      }
    } finally {
      pending.delete(item.el);
      for (const other of waiting()) pending.delete(other.el);
      if (key) shapeWaiting.delete(key);
      running = false;
      pump();
    }
  }

  // 분석 결과 전달: 아직 그 항목에 있으면 바로 이어 읽는다. 다른 곳에 있으면 알리지 않는다
  // (분석이 끝날 때마다 말하면 너무 많으므로, 궁금하면 사용자가 AI 결과 모음을 연다)
  // items: 이 답으로 이름이 붙은 항목들 (같은 모양 항목 포함)
  function delivered(items) {
    const r = reader();
    if (!r?.enabled) return;
    r.rebuild();
    const current = r.items[r.index];
    if (current && items.some((item) => item.el === current.el) && !r.sayingAll) say(`분석 결과: ${current.phrase}`, { interrupt: false });
  }

  // 읽기 엔진이 항목을 읽을 때 부른다 (reader.moveTo)
  function onItemRead(item) {
    if (!item?.needsName || labels.has(item.el)) return;
    if (aiError) {
      if (!aiErrorAnnounced) {
        aiErrorAnnounced = true;
        reader()?.guide('ai-supplement-off', { error: aiError }, { interrupt: false });
      }
      return;
    }
    if (!autoOn() || !/^(https?|file):$/.test(location.protocol)) return;
    if (pending.has(item.el) || request(item, { announce: true })) {
      reader()?.guide('ai-analyzing', { kind: roleName(item) }, { interrupt: false });
    }
  }

  // 페이지를 열면 앞쪽의 이름 없는 항목 몇 개를 미리 분석한다 (기다리는 시간을 줄이기 위해)
  function prefetch(items) {
    if (!autoOn() || aiError || !/^(https?|file):$/.test(location.protocol)) return;
    items.filter((item) => item.needsName).slice(0, PREFETCH).forEach((item) => request(item, { announce: false }));
  }

  // AI 결과 모음: 고르면 그 위치로 가서 읽는다 (위치가 없으면 결과 글을 읽는다)
  function openResults() {
    if (!results.length) {
      reader()?.guide('ai-results-empty', {}, { interrupt: true });
      return;
    }
    ns.menu.openEntries(
      'AI 결과 모음',
      results.map((entry) => ({
        label: entry.title,
        action: () => {
          const r = reader();
          // 닫을 수 있는 결과(요약 대화상자, 상세 이미지 상자)는 다시 열어 처음부터 읽는다
          if (entry.open && entry.el?.isConnected) {
            entry.open();
          } else if (entry.el?.isConnected && entry.el.checkVisibility()) {
            if (entry.kind === 'summary' || entry.kind === 'detail') r.readElement(entry.el);
            else r.moveToElement(entry.el);
          } else if (entry.text) {
            say(entry.text, { interrupt: true, message: true });
          } else {
            say(`${entry.title}. 이 결과의 위치를 페이지에서 찾을 수 없습니다.`, { interrupt: true, message: true });
          }
        }
      }))
    );
  }

  // 현재 항목 AI 설명 (예전 항목 설명 모드를 대신함)
  // 설명을 기다리는 동안 다시 누르면 요청을 또 보내지 않는다 (요청 2번, 결과 2번 읽기 방지)
  let explaining = false;
  async function explainCurrent() {
    const r = reader();
    const item = r?.items[r.index];
    if (!item) {
      say('설명할 항목이 없습니다. 아래 화살표로 항목으로 이동한 뒤 다시 누르세요.', { interrupt: true, message: true });
      return;
    }
    if (explaining) {
      say('이미 현재 항목 설명을 만드는 중입니다. 끝나면 바로 읽어 드립니다.', { interrupt: true, message: true });
      return;
    }
    explaining = true;
    r.guide('ai-requested', { task: '현재 항목 설명' }, { interrupt: true, dropIfStale: true });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'explain-item', item: ns.describe.describeElement(item.el, item) });
      if (!response || response.error) throw new Error(response?.error ?? '응답이 없습니다.');
      let text = `AI 설명: ${response.description}`;
      if (response.imageMissing) text += ' 그림을 불러오지 못해 이름과 주변 글로만 설명했습니다.';
      if (response.imageTruncated) text += ' 그림이 길어 앞부분만 봤습니다.';
      addResult({ kind: 'explain', title: `${item.phrase}, 설명`, el: item.el, text });
      say(text, { interrupt: true, message: true });
    } catch (error) {
      // 브라우저의 영어 오류(연결 끊김 등)는 한국어로
      const reason = /[가-힣]/.test(error.message) ? error.message : '온글과 연결이 끊겼습니다. 페이지를 새로고침(F5)한 뒤 다시 시도하세요.';
      say(`현재 항목 설명 실패. ${reason}`, { interrupt: true, message: true });
    } finally {
      explaining = false;
    }
  }

  // finalLabel은 평가 도구(eval/ai-eval.mjs)가 사용자가 실제로 듣는 이름으로 채점할 때도 쓴다
  ns.ai = { decorate, onItemRead, prefetch, addResult, openResults, explainCurrent, results, finalLabel, hintName };
})();
