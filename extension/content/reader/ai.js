// A1 AI 자동 보완과 AI 결과 모음.
// - 이름이 없어 읽을 수 없는 항목(이름 없는 버튼·링크, alt 없는 그림 등)을 읽으면 "AI 분석 중"이라고 알리고 탐색을 계속하게 한다.
//   분석이 끝났을 때 아직 그 항목에 있으면 바로 이어 읽고, 다른 곳에 있으면 알리지 않는다(궁금하면 AI 결과 모음에서 확인).
//   결과는 그 항목의 이름으로 붙어 다시 오면 "…, AI 추정"으로 읽는다. 페이지를 열면 앞쪽 몇 개는 미리 분석한다.
// - AI 결과 모음(Alt+Shift+I): 자동 보완, 요약, 상세 이미지 읽기, 질문 답, 항목 설명 결과를 모아 다시 듣는다.
// - 현재 항목 AI 설명(Alt+Shift+E, 기능 키는 설정에서 바꿈): 지금 읽는 항목을 AI가 1~3문장으로 설명한다 (예전 항목 설명 모드를 대신함).
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.ai) return;

  const PREFETCH = 5;
  const MAX_AUTO_PER_PAGE = 30;
  // 파괴적 동작 단서: 요소의 클래스·아이디·주소 등에 이런 말이 있는데 AI 이름에 그런 뜻이 없으면 "용도 불명확"으로 읽는다
  const DESTRUCTIVE_HINT = /(delete|remove|trash|cancel|withdraw|leave|unsubscribe|logout|signout|payment|checkout|purchase|삭제|취소|탈퇴|결제|구매|해지)/i;
  const DESTRUCTIVE_WORD = /(삭제|지우|제거|취소|탈퇴|결제|구매|주문|로그아웃|해지|비우|휴지통|초기화)/;

  const labels = new WeakMap(); // 요소 → { label, confident }
  const pending = new WeakSet();
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

  // 알고 있는 AI 이름을 읽기 항목에 붙인다 (목록을 만들 때, 이동할 때)
  function decorate(item) {
    const known = item && labels.get(item.el);
    if (!known || !item.needsName) return item;
    const next = { ...item, name: known.label, aiName: true, needsName: false };
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
    if (labels.has(el) || pending.has(el) || autoCount >= MAX_AUTO_PER_PAGE || aiError) return false;
    pending.add(el);
    autoCount++;
    const entry = addResult({ kind: 'label', title: `${roleName(item)}, AI 분석 중`, el, status: 'pending' });
    queue.push({ item, entry, announce });
    pump();
    return true;
  }

  // 한 번에 하나씩 분석한다 (무료 AI 한도와 요금 보호)
  async function pump() {
    if (running || !queue.length) return;
    running = true;
    const { item, entry, announce } = queue.shift();
    try {
      const response = await chrome.runtime.sendMessage({ type: 'label-item', item: ns.describe.describeElement(item.el, item) });
      if (!response || response.error) throw new Error(response?.error ?? '응답이 없습니다.');
      const label = finalLabel(item.el, response);
      labels.set(item.el, { label });
      entry.status = 'done';
      entry.title = `${label}, ${roleName(item)}, AI 추정`;
      delivered(item);
    } catch (error) {
      entry.status = 'error';
      entry.title = `${roleName(item)}, AI 분석 실패`;
      // AI가 꺼져 있거나 키가 없으면 더 묻지 않고 한 번만 알린다
      if (/꺼져 있습니다|API 키가 없습니다|모델을 고르지/.test(error.message)) {
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
      running = false;
      pump();
    }
  }

  // 분석 결과 전달: 아직 그 항목에 있으면 바로 이어 읽는다. 다른 곳에 있으면 알리지 않는다
  // (분석이 끝날 때마다 말하면 너무 많으므로, 궁금하면 사용자가 AI 결과 모음을 연다)
  function delivered(item) {
    const r = reader();
    if (!r?.enabled) return;
    r.rebuild();
    const current = r.items[r.index];
    if (current?.el === item.el && !r.sayingAll) say(`분석 결과: ${current.phrase}`, { interrupt: false });
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
      const text = `AI 설명: ${response.description}`;
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
  ns.ai = { decorate, onItemRead, prefetch, addResult, openResults, explainCurrent, results, finalLabel };
})();
