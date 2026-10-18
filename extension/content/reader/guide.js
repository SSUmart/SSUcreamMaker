// 온글 사용 가이드 (S10): 온글 메뉴의 첫 항목. 목차에서 장을 고르면 화면에 띄우고 문단 단위로 읽는다.
// 위아래 화살표로 문단 이동(장 끝에서 아래 화살표를 누르면 다음 장), Home·End로 장 처음·끝, Esc로 목차로 돌아감.
// 열려 있는 동안 키는 reader.js가 이 모듈의 handleKey로 먼저 넘긴다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.guide) return;

  const STYLE = `
    .guide {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -55%);
      box-sizing: border-box; width: min(720px, calc(100vw - 32px)); max-height: 70vh; overflow: auto;
      padding: 18px 20px; border-radius: 12px; background: #fff; color: #111; border: 3px solid #047857;
      font: 18px/1.6 system-ui, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45); z-index: 2147483647;
    }
    .guide[hidden] { display: none; }
    .guide .where { margin: 0 0 4px; font-size: 14px; color: #047857; font-weight: 600; }
    .guide h2 { margin: 0 0 10px; font-size: 22px; }
    .guide p { margin: 0 0 10px; padding: 6px 10px; border-radius: 6px; }
    .guide p.active { background: #d1fae5; outline: 2px solid #047857; }
    .guide .keys { margin: 8px 0 0; font-size: 14px; color: #4b5563; }
  `;

  let panel = null;
  let whereEl = null;
  let titleEl = null;
  let bodyEl = null;
  let open = false;
  let chapterIndex = 0;
  let paragraph = 0;

  const say = (text, options) => ns.output?.say(text, options);

  function params() {
    const r = ns.reader;
    return {
      toggle: r?.shortcuts?.toggle,
      menu: r?.shortcuts?.menu,
      stop: r?.shortcuts?.stop,
      reread: r?.shortcuts?.reread,
      keys: ns.guidance.keyNames(r?.settings?.reader?.commandKeys)
    };
  }

  function chapters() {
    return ns.guideContent.chapters(params());
  }

  function ensurePanel() {
    const root = ns.output.ui();
    if (panel?.isConnected) return;
    ns.output.addStyle(STYLE);
    panel = document.createElement('section');
    panel.className = 'guide';
    panel.hidden = true;
    whereEl = document.createElement('p');
    whereEl.className = 'where';
    titleEl = document.createElement('h2');
    bodyEl = document.createElement('div');
    const keys = document.createElement('p');
    keys.className = 'keys';
    keys.textContent = '위아래 화살표: 문단 이동 · Home/End: 장 처음/끝 · Esc: 목차로';
    panel.append(whereEl, titleEl, bodyEl, keys);
    root.append(panel);
  }

  function render() {
    const list = chapters();
    const chapter = list[chapterIndex];
    whereEl.textContent = `온글 사용 가이드 · ${chapterIndex + 1}/${list.length}장`;
    titleEl.textContent = chapter.title;
    bodyEl.replaceChildren(
      ...chapter.paragraphs.map((text, i) => {
        const p = document.createElement('p');
        p.textContent = text;
        if (i === paragraph) p.className = 'active';
        return p;
      })
    );
    bodyEl.children[paragraph]?.scrollIntoView({ block: 'nearest' });
  }

  function readParagraph(prefix = '') {
    const chapter = chapters()[chapterIndex];
    render();
    say(`${prefix}${chapter.paragraphs[paragraph]}`, { interrupt: true });
  }

  // 장 하나를 띄우고 제목과 첫 문단을 읽는다
  function showChapter(i) {
    ensurePanel();
    const list = chapters();
    chapterIndex = Math.max(0, Math.min(i, list.length - 1));
    paragraph = 0;
    open = true;
    panel.hidden = false;
    ns.output.raise?.();
    const chapter = list[chapterIndex];
    readParagraph(
      `사용 가이드 ${chapterIndex + 1}장, ${chapter.title}. 문단 ${chapter.paragraphs.length}개. ` +
        '아래 화살표로 다음 문단을 읽고, Esc를 누르면 목차로 돌아갑니다. '
    );
  }

  // 목차: 온글 메뉴와 같은 방식으로 장을 고른다
  function openContents() {
    close();
    const list = chapters();
    ns.menu.openEntries(
      '온글 사용 가이드 목차',
      list.map((chapter, i) => ({ label: `${i + 1}장, ${chapter.title}`, action: () => showChapter(i) }))
    );
  }

  function close() {
    if (!open) return;
    open = false;
    panel.hidden = true;
  }

  function move(delta) {
    const list = chapters();
    const chapter = list[chapterIndex];
    const next = paragraph + delta;
    if (next >= chapter.paragraphs.length) {
      if (chapterIndex + 1 < list.length) {
        chapterIndex++;
        paragraph = 0;
        readParagraph(`${chapterIndex + 1}장, ${list[chapterIndex].title}. `);
      } else {
        say('사용 가이드의 끝입니다. Esc를 누르면 목차로 돌아갑니다.', { interrupt: true, message: true });
      }
      return;
    }
    if (next < 0) {
      say(`${chapterIndex + 1}장의 처음입니다. Esc를 누르면 목차에서 다른 장을 고를 수 있습니다.`, { interrupt: true, message: true });
      return;
    }
    paragraph = next;
    readParagraph();
  }

  // 가이드가 열려 있을 때 키 처리. 처리했으면 true
  function handleKey(event) {
    if (!open) return false;
    if (event.ctrlKey || event.altKey || event.metaKey) return false;
    switch (event.code) {
      case 'ArrowDown':
        move(1);
        return true;
      case 'ArrowUp':
        move(-1);
        return true;
      case 'Home':
        paragraph = 0;
        readParagraph();
        return true;
      case 'End':
        paragraph = chapters()[chapterIndex].paragraphs.length - 1;
        readParagraph();
        return true;
      case 'Escape':
        openContents();
        return true;
      default:
        return true;
    }
  }

  ns.guide = {
    get isOpen() {
      return open;
    },
    openContents,
    showChapter,
    close,
    handleKey
  };
})();
