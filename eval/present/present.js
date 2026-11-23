// 한 장씩 넘기기: ←/→, PageUp/PageDown, 스페이스, Home/End, 화면 아래 단추. 주소 끝 #번호로 그 장을 바로 연다
const slides = [...document.querySelectorAll('.slide')];
const prev = document.getElementById('prev');
const next = document.getElementById('next');
const count = document.getElementById('count');
const live = document.getElementById('live');
let cur = -1;

function show(i) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur) return;
  cur = i;
  slides.forEach((s, n) => { s.hidden = n !== cur; });
  count.textContent = `${cur + 1} / ${slides.length}`;
  prev.disabled = cur === 0;
  next.disabled = cur === slides.length - 1;
  history.replaceState(null, '', `#${cur + 1}`);
  // 스크린리더에 바뀐 장의 제목을 알린다
  live.textContent = slides[cur].getAttribute('aria-label');
}

const fromHash = () => show((parseInt(location.hash.slice(1), 10) || 1) - 1);
window.addEventListener('hashchange', fromHash);
prev.addEventListener('click', () => show(cur - 1));
next.addEventListener('click', () => show(cur + 1));
document.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (step) show(cur + (e.shiftKey && e.key === ' ' ? -1 : step));
  else return;
  e.preventDefault();
});
fromHash();
