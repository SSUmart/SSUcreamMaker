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

// 분류 기준. 제목만 주면 AI가 같은 정보를 섹션마다 다르게 넣어서 무엇을 넣는지 함께 알려 준다.
const SECTION_GUIDE = {
  '상품 요약': '상품 이름, 브랜드, 핵심 특징',
  '가격·할인': '정가, 할인가, 할인율, 쿠폰, 적립금, 묶음 할인',
  '옵션·구성': '색상, 용량 같은 선택 옵션과 구성품, 세트 내용',
  '소재·성분': '소재, 원료, 전성분, 원산지',
  '사이즈·규격': '치수, 무게, 용량, 사이즈표',
  '사용법': '사용·조립·세탁·보관 방법',
  '배송·교환·반품': '출고일, 배송비, 교환·반품 조건과 비용',
  '주의사항': '경고, 금지 사항, 알레르기, 사용 시 주의',
  '기타': '인증, 제조사, 고객센터 등 위에 맞지 않는 정보'
};

// NIM은 이 글자만 보고 정리하므로(그림은 정리 단계에 가지 않음) 취소선·표처럼 모양으로만 알 수 있는 뜻도 글로 남기게 한다.
export const TRANSCRIBE_PROMPT = [
  '이 이미지는 쇼핑몰 상품 상세페이지의 일부입니다.',
  '이미지 안에 보이는 글자를 위에서 아래, 왼쪽에서 오른쪽 순서로 빠짐없이 그대로 옮겨 적으세요.',
  '- 작은 글씨, 흐린 글씨, 배경색 위 글씨, 표 안 글자, 배지·스티커, * 표시 각주도 모두 적으세요.',
  '- 숫자, 단위, 기호(%, ~, ×, *)는 보이는 그대로 쓰세요. 글자를 고치거나 번역하지 마세요.',
  '- 취소선이 그어진 글자는 앞에 "(취소선)"을 붙이세요. 예: (취소선) 39,000원',
  '- 표는 한 행을 한 줄로, 칸은 " | "로 나눠 쓰세요. 첫 행이 머리글이면 그대로 첫 줄에 쓰세요.',
  '- 알아볼 수 없는 글자는 추측하지 말고 "(읽기 어려움)"이라고 쓰세요.',
  '글자가 없으면 "없음"이라고만 쓰세요. 설명이나 추측은 덧붙이지 마세요.'
].join('\n');

export const STRUCTURE_PROMPT = [
  '쇼핑몰 상품 상세 이미지의 글자를 시각장애인이 스크린리더와 점자로 읽기 쉽게 정리하세요.',
  '이 정리가 이미지를 대신하므로, 구매에 필요한 정보는 하나도 빠뜨리면 안 됩니다.',
  '규칙:',
  '- 이미지에 실제로 적힌 내용만 쓰세요. 없는 내용은 절대 만들지 마세요. 알아볼 수 없는 글자는 추측하지 말고 빼세요.',
  '- 작은 글씨, 표, 각주(*), 배지에 적힌 정보도 넣으세요. 빼도 되는 것은 이모지, "BEST"·"NEW" 같은 장식 글자, 같은 문구 반복뿐입니다.',
  '- 숫자, 단위, 모델명, 옵션 이름은 적힌 그대로 쓰세요. 반올림하거나 바꾸지 마세요.',
  '- 취소선이 그어진 가격(글자로 받았다면 "(취소선)"이 붙은 가격)은 할인 전 정가입니다. 정가, 할인가, 할인율은 한 항목에 쓰세요. 예: 정가 39,000원, 할인가 29,000원 (25% 할인)',
  '- 표는 한 행을 한 항목으로, 머리글을 붙여 쓰세요. 예: M 사이즈: 가슴단면 52cm, 총장 70cm',
  '- 한 항목에는 한 가지 정보를 짧은 문장으로 쓰세요. 조건이나 예외(예: 제주 추가 3,000원)는 줄이지 말고 그 항목에 함께 쓰세요.',
  '- title은 아래 중 하나만 쓰고, 괄호 안 기준으로 고르세요. 내용이 없는 title은 넣지 마세요.',
  ...SECTION_TITLES.map((title) => `  ${title} (${SECTION_GUIDE[title]})`),
  '반드시 다음 JSON 형식으로만 답하세요:',
  '{"sections":[{"title":"가격·할인","items":["정가 39,000원, 할인가 29,000원 (25% 할인)"]},{"title":"사이즈·규격","items":["M 사이즈: 가슴단면 52cm, 총장 70cm"]}]}'
].join('\n');

// 글자 없는 조각의 답. 모델에 따라 "없음." "글자 없음" "\"없음\""처럼 조금씩 다르게 온다.
export function isNoText(text) {
  return /^["'(]*(글자\s*)?없음[.)"']*$/.test(text.trim());
}

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
