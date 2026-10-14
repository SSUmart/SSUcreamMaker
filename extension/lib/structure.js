// AI 응답을 화면에 넣을 섹션 목록으로 정리한다.
export const SECTION_TITLES = [
  '상품 요약',
  '가격·할인',
  '옵션·구성',
  '소재·성분',
  '사이즈·규격',
  '사용법',
  '배송·교환·반품',
  '주의사항',
  '기타'
];

export const TRANSCRIBE_PROMPT = [
  '이 이미지는 쇼핑몰 상품 상세페이지의 일부입니다.',
  '이미지 안에 보이는 글자를 위에서 아래 순서대로 빠짐없이 그대로 옮겨 적으세요.',
  '글자가 없으면 "없음"이라고만 쓰세요. 설명이나 추측은 덧붙이지 마세요.'
].join('\n');

export const STRUCTURE_PROMPT = [
  '쇼핑몰 상품 상세 이미지의 글자를 시각장애인이 스크린리더로 읽기 쉽게 정리하세요.',
  '규칙:',
  '- 이미지에 실제로 적힌 내용만 사용하세요. 없는 내용은 절대 만들지 마세요.',
  '- 각 항목은 짧은 한 문장으로 쓰세요. 이모지와 장식 문구는 빼세요.',
  `- title은 다음 중 하나만 쓰세요: ${SECTION_TITLES.join(', ')}`,
  '- 내용이 없는 title은 넣지 마세요.',
  '반드시 다음 JSON 형식으로만 답하세요:',
  '{"sections":[{"title":"가격·할인","items":["정가 39,000원, 할인가 29,000원"]}]}'
].join('\n');

// AI 응답에서 JSON을 꺼낸다. 코드 블록이나 앞뒤 설명 문장이 붙어 와도 처리한다.
export function parseJsonText(text) {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(json);
  } catch {
    const start = json.indexOf('{');
    const end = json.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(json.slice(start, end + 1));
      } catch {
        // 아래에서 같은 오류로 처리
      }
    }
    throw new Error('AI 응답을 해석하지 못했습니다.');
  }
}

export function parseSections(text) {
  const parsed = parseJsonText(text);
  if (!Array.isArray(parsed?.sections)) throw new Error('AI 응답 형식이 올바르지 않습니다.');

  const byTitle = new Map();
  for (const section of parsed.sections) {
    const title = SECTION_TITLES.includes(section?.title) ? section.title : '기타';
    const items = (Array.isArray(section?.items) ? section.items : [])
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length) byTitle.set(title, [...(byTitle.get(title) ?? []), ...items]);
  }
  return SECTION_TITLES.filter((t) => byTitle.has(t)).map((title) => ({
    title,
    items: byTitle.get(title)
  }));
}
