// 가상 쇼핑몰(온글몰) 상품 데이터. 실제 판매하지 않는 가상 상품이다.
// 텀블러는 평가용 쇼핑몰(/shop/)의 사진과 상세 이미지를 다시 쓴다.
// 상세 정보는 모든 상품이 대체 텍스트 없는 상세 이미지로만 있다 (국내 쇼핑몰에 흔한 형태, 온글의 상세 이미지 읽기 대상).

export const FREE_SHIPPING_MIN = 30000;
export const SHIPPING_FEE = 3000;

export const CATEGORIES = [
  { id: 'all', name: '전체' },
  { id: 'kitchen', name: '주방' },
  { id: 'living', name: '생활' },
  { id: 'fashion', name: '패션잡화' },
  { id: 'digital', name: '디지털' }
];

// 사진은 Codex 이미지 생성으로 만들었다(글자 없음). 상세 이미지는 detail/detail.html을 렌더링한 것 (npm run mall:build)
const img = (name) => `images/${name}.jpg`;
const details = (id, n = 3) => Array.from({ length: n }, (_, i) => img(`${id}-detail-0${i + 1}`));

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
      { src: '../shop/images/product-colors.jpg', alt: '화이트, 블랙, 세이지그린 세 가지 색상 텀블러' },
      { src: '../shop/images/lid-detail.jpg', alt: '슬라이드 뚜껑을 연 모습' }
    ],
    detailImages: ['../shop/images/detail-01.jpg', '../shop/images/detail-02.jpg', '../shop/images/detail-03.jpg', '../shop/images/detail-04.jpg'],
    options: [{ name: '색상', values: [{ name: '화이트' }, { name: '블랙' }, { name: '세이지그린', soldOut: true }] }],
    summary: '6시간 보온, 12시간 보냉. 슬라이드 뚜껑으로 한 손으로 열고 닫습니다.'
  },
  {
    id: 'mug',
    category: 'kitchen',
    name: '도자기 머그컵 350ml',
    brand: '온글리빙',
    price: 12900,
    rating: 4.5,
    reviewCount: 2,
    images: [
      { src: img('mug-ivory'), alt: '아이보리 색 도자기 머그컵' },
      { src: img('mug-navy'), alt: '네이비 색 도자기 머그컵' },
      { src: img('mug-lifestyle'), alt: '나무 책상 위 커피가 담긴 아이보리 머그컵' }
    ],
    detailImages: details('mug'),
    options: [{ name: '색상', values: [{ name: '아이보리' }, { name: '네이비' }] }],
    summary: '전자레인지와 식기세척기에 쓸 수 있는 도자기 머그컵입니다.',
  },
  {
    id: 'bottle',
    category: 'living',
    name: '보온보냉 물병 750ml',
    brand: '온글리빙',
    price: 29900,
    rating: 4.6,
    reviewCount: 2,
    images: [
      { src: img('bottle-silver'), alt: '실버 색 보온보냉 물병' },
      { src: img('bottle-colors'), alt: '실버, 블랙, 핑크 세 가지 색상 물병' },
      { src: img('bottle-straw-lid'), alt: '빨대 뚜껑을 끼운 물병 윗부분' }
    ],
    detailImages: details('bottle'),
    options: [
      { name: '색상', values: [{ name: '실버' }, { name: '블랙' }, { name: '핑크' }] },
      { name: '뚜껑', values: [{ name: '기본 뚜껑' }, { name: '빨대 뚜껑', extra: 3000 }] }
    ],
    summary: '빨대 뚜껑을 고르면 3,000원이 추가됩니다.',
  },
  {
    id: 'ecobag',
    category: 'fashion',
    name: '캔버스 에코백',
    brand: '온글잡화',
    price: 15900,
    rating: 4.3,
    reviewCount: 1,
    images: [
      { src: img('ecobag-natural'), alt: '내추럴 색 캔버스 에코백' },
      { src: img('ecobag-black'), alt: '블랙 캔버스 에코백' },
      { src: img('ecobag-inside'), alt: '에코백 안쪽 주머니에 휴대폰을 넣은 모습' }
    ],
    detailImages: details('ecobag'),
    options: [{ name: '색상', values: [{ name: '내추럴' }, { name: '블랙' }] }],
    summary: 'A4 서류와 노트북(14인치)이 들어가는 크기입니다.',
  },
  {
    id: 'socks',
    category: 'fashion',
    name: '면 양말 5켤레 세트',
    brand: '온글잡화',
    price: 9900,
    rating: 4.4,
    reviewCount: 2,
    images: [
      { src: img('socks-set'), alt: '세이지그린, 아이보리, 그레이, 네이비, 머스터드 다섯 가지 색 면 양말' },
      { src: img('socks-lifestyle'), alt: '세이지그린 양말을 신은 발' },
      { src: img('socks-detail'), alt: '양말 발목 골지 부분 접사' }
    ],
    detailImages: details('socks'),
    // 사이즈는 버튼 묶음으로 고른다 (select가 아닌 형태)
    options: [{ name: '사이즈', type: 'buttons', values: [{ name: '230mm' }, { name: '250mm' }, { name: '270mm', soldOut: true }] }],
    summary: '5가지 색이 한 켤레씩 들어 있습니다.',
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
    images: [
      { src: img('earphone-white'), alt: '화이트 무선 이어폰 한 쌍과 열린 충전 케이스' },
      { src: img('earphone-parts'), alt: '이어폰, 충전 케이스, USB-C 케이블, 이어팁 구성품' },
      { src: img('earphone-wear'), alt: '귀에 낀 화이트 무선 이어폰' }
    ],
    detailImages: details('earphone'),
    options: [{ name: '색상', values: [{ name: '화이트' }, { name: '블랙', soldOut: true }] }],
    summary: '한 번 충전으로 6시간, 충전 케이스와 함께 24시간 사용합니다.',
  }
];

export const REVIEWS = {
  tumbler: [
    { author: 'kim***', rating: 5, text: '오후까지 커피가 따뜻해요. 뚜껑이 한 손으로 열려서 편합니다.' },
    { author: 'lee***', rating: 5, text: '세이지그린이 품절이라 화이트로 샀는데 깔끔해요.' },
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
