// 가상 쇼핑몰(온글몰) 상품 데이터. 실제 판매하지 않는 가상 상품이다.
// 텀블러는 평가용 쇼핑몰(/shop/)의 사진과 상세 이미지를 다시 쓰고, 나머지 상품 사진은 SVG로 그린다.

export const FREE_SHIPPING_MIN = 30000;
export const SHIPPING_FEE = 3000;

export const CATEGORIES = [
  { id: 'all', name: '전체' },
  { id: 'kitchen', name: '주방' },
  { id: 'living', name: '생활' },
  { id: 'fashion', name: '패션잡화' },
  { id: 'digital', name: '디지털' }
];

// 상품 사진 SVG (색과 모양만 다르게). 글자를 넣지 않는다.
function drawing(shape, color) {
  const shapes = {
    mug: `<rect x="70" y="80" width="120" height="140" rx="14" fill="${color}"/><path d="M190 110 h22 a26 26 0 0 1 0 52 h-22" fill="none" stroke="${color}" stroke-width="14"/>`,
    bottle: `<rect x="105" y="40" width="50" height="30" rx="6" fill="#555"/><rect x="85" y="68" width="90" height="170" rx="30" fill="${color}"/>`,
    bag: `<path d="M95 95 q35 -70 70 0" fill="none" stroke="#8a6d46" stroke-width="10"/><rect x="60" y="95" width="140" height="150" rx="8" fill="${color}"/>`,
    socks: `<path d="M90 50 h50 v120 l40 30 a22 22 0 0 1 -20 40 l-60 -40 a20 20 0 0 1 -10 -16 z" fill="${color}"/>`,
    earphone: `<ellipse cx="100" cy="140" rx="30" ry="38" fill="${color}"/><rect x="92" y="170" width="16" height="60" rx="8" fill="${color}"/><ellipse cx="170" cy="140" rx="30" ry="38" fill="${color}"/><rect x="162" y="170" width="16" height="60" rx="8" fill="${color}"/>`
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 280"><rect width="260" height="280" fill="#f4f4f2"/>${shapes[shape]}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// options: 고르는 순서대로. values의 soldOut은 품절(고를 수 없음), extra는 추가 금액
export const PRODUCTS = [
  {
    id: 'tumbler',
    category: 'kitchen',
    name: '스텐 진공 텀블러 500ml',
    brand: '온글리빙',
    price: 32000,
    salePrice: 24900,
    rating: 4.7,
    reviewCount: 3,
    images: [
      { src: '../shop/images/product-white.jpg', alt: '화이트 색상 진공 텀블러 정면' },
      { src: '../shop/images/product-colors.jpg', alt: '화이트, 블랙, 민트 세 가지 색상 텀블러' },
      { src: '../shop/images/lid-detail.jpg', alt: '슬라이드 뚜껑을 연 모습' }
    ],
    // 상세 이미지: 대체 텍스트 없이 넣는다 (국내 쇼핑몰에 흔한 형태, 온글의 상세 이미지 읽기 대상)
    detailImages: ['../shop/images/detail-01.jpg', '../shop/images/detail-02.jpg', '../shop/images/detail-03.jpg', '../shop/images/detail-04.jpg'],
    options: [{ name: '색상', values: [{ name: '화이트' }, { name: '블랙' }, { name: '민트', soldOut: true }] }],
    summary: '12시간 보온, 24시간 보냉. 슬라이드 뚜껑으로 한 손으로 열고 닫습니다.'
  },
  {
    id: 'mug',
    category: 'kitchen',
    name: '도자기 머그컵 350ml',
    brand: '온글리빙',
    price: 12900,
    rating: 4.5,
    reviewCount: 2,
    images: [{ src: drawing('mug', '#e9e2d0'), alt: '아이보리 색 도자기 머그컵' }],
    options: [{ name: '색상', values: [{ name: '아이보리' }, { name: '네이비' }] }],
    summary: '전자레인지와 식기세척기에 쓸 수 있는 도자기 머그컵입니다.',
    detailText: ['용량 350ml, 높이 9.5cm, 지름 8cm', '소재: 도자기 (전자레인지·식기세척기 사용 가능)', '오븐과 직화에는 쓰지 마세요.']
  },
  {
    id: 'bottle',
    category: 'living',
    name: '보온보냉 물병 750ml',
    brand: '온글리빙',
    price: 29900,
    rating: 4.6,
    reviewCount: 2,
    images: [{ src: drawing('bottle', '#b8bec4'), alt: '실버 색 보온보냉 물병' }],
    options: [
      { name: '색상', values: [{ name: '실버' }, { name: '블랙' }, { name: '핑크' }] },
      { name: '뚜껑', values: [{ name: '기본 뚜껑' }, { name: '빨대 뚜껑', extra: 3000 }] }
    ],
    summary: '빨대 뚜껑을 고르면 3,000원이 추가됩니다.',
    detailText: ['용량 750ml, 보온 12시간, 보냉 24시간', '소재: 스테인리스 304', '빨대 뚜껑은 분리해 세척할 수 있습니다.']
  },
  {
    id: 'ecobag',
    category: 'fashion',
    name: '캔버스 에코백',
    brand: '온글잡화',
    price: 15900,
    rating: 4.3,
    reviewCount: 1,
    images: [{ src: drawing('bag', '#e6dcc3'), alt: '내추럴 색 캔버스 에코백' }],
    options: [{ name: '색상', values: [{ name: '내추럴' }, { name: '블랙' }] }],
    summary: 'A4 서류와 노트북(14인치)이 들어가는 크기입니다.',
    detailText: ['크기: 가로 38cm, 세로 42cm, 바닥 폭 10cm', '소재: 면 100% (캔버스 12수)', '안쪽 주머니 1개']
  },
  {
    id: 'socks',
    category: 'fashion',
    name: '면 양말 5켤레 세트',
    brand: '온글잡화',
    price: 9900,
    rating: 4.4,
    reviewCount: 2,
    images: [{ src: drawing('socks', '#9fb7a8'), alt: '세이지 그린 색 면 양말' }],
    // 사이즈는 버튼 묶음으로 고른다 (select가 아닌 형태)
    options: [{ name: '사이즈', type: 'buttons', values: [{ name: '230mm' }, { name: '250mm' }, { name: '270mm', soldOut: true }] }],
    summary: '5가지 색이 한 켤레씩 들어 있습니다.',
    detailText: ['소재: 면 80%, 폴리에스터 18%, 스판덱스 2%', '구성: 5켤레 (색상 혼합)', '세탁망에 넣어 찬물로 세탁하세요.']
  },
  {
    id: 'earphone',
    category: 'digital',
    name: '무선 이어폰 (블루투스 5.3)',
    brand: '온글사운드',
    price: 59000,
    salePrice: 49900,
    rating: 4.2,
    reviewCount: 2,
    images: [{ src: drawing('earphone', '#f2f2f2'), alt: '화이트 무선 이어폰 한 쌍' }],
    options: [{ name: '색상', values: [{ name: '화이트' }, { name: '블랙', soldOut: true }] }],
    summary: '한 번 충전으로 6시간, 충전 케이스와 함께 24시간 사용합니다.',
    detailText: ['블루투스 5.3, 생활 방수(IPX4)', '재생 시간: 이어폰 6시간, 케이스 포함 24시간', '구성: 이어폰, 충전 케이스, USB-C 케이블']
  }
];

export const REVIEWS = {
  tumbler: [
    { author: 'kim***', rating: 5, text: '오후까지 커피가 따뜻해요. 뚜껑이 한 손으로 열려서 편합니다.' },
    { author: 'lee***', rating: 5, text: '민트 색이 품절이라 화이트로 샀는데 깔끔해요.' },
    { author: 'par***', rating: 4, text: '식기세척기에 못 넣는 점만 아쉬워요.' }
  ],
  mug: [
    { author: 'cho***', rating: 5, text: '두께가 적당하고 손잡이가 편해요.' },
    { author: 'jun***', rating: 4, text: '네이비 색이 사진보다 조금 진해요.' }
  ],
  bottle: [
    { author: 'han***', rating: 5, text: '빨대 뚜껑 추가했는데 운동할 때 좋아요.' },
    { author: 'yoo***', rating: 4, text: '조금 무겁지만 보냉은 확실해요.' }
  ],
  ecobag: [{ author: 'kan***', rating: 4, text: '노트북이 들어가고 튼튼해요.' }],
  socks: [
    { author: 'shi***', rating: 5, text: '목이 늘어나지 않아요.' },
    { author: 'oh***', rating: 4, text: '270은 품절이라 아쉬웠어요.' }
  ],
  earphone: [
    { author: 'lim***', rating: 4, text: '가격 대비 소리가 좋아요.' },
    { author: 'seo***', rating: 4, text: '케이스가 작아서 주머니에 쏙 들어가요.' }
  ]
};

// 기본 배송지 (가상)
export const SAVED_ADDRESS = {
  name: '김온글',
  phone: '010-1234-5678',
  zipcode: '06978',
  address: '서울특별시 동작구 상도로 369',
  detail: '숭실대학교 정보과학관 101호'
};

// 우편번호 찾기 결과 (가상). 검색어가 들어간 주소만 보여 준다
export const ADDRESS_BOOK = [
  { zipcode: '06978', address: '서울특별시 동작구 상도로 369' },
  { zipcode: '04524', address: '서울특별시 중구 세종대로 110' },
  { zipcode: '13529', address: '경기도 성남시 분당구 판교역로 166' },
  { zipcode: '48058', address: '부산광역시 해운대구 센텀중앙로 79' }
];

export const BANKS = ['국민은행', '신한은행', '우리은행', '하나은행', '농협은행'];
export const CARD_COMPANIES = ['신한카드', '삼성카드', '현대카드', 'KB국민카드', '롯데카드'];
export const EASY_PAYS = [
  { id: 'naverpay', name: '네이버페이', color: '#03c75a' },
  { id: 'kakaopay', name: '카카오페이', color: '#fee500' },
  { id: 'tosspay', name: '토스페이', color: '#0064ff' }
];

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id) ?? null;
}
