// 한국 점자 변환(R5): 글을 점자 칸으로 바꾼다. 한국 점자 규정을 따르고, 약자를 쓰는 2종(기본)과 약자 없는 1종을 지원한다.
// 칸 하나는 1바이트: 1~8번 점이 각 비트(1번 점 = 1, 2번 점 = 2, 3번 점 = 4, 4번 점 = 8, 5번 점 = 16, 6번 점 = 32).
// 유니코드 점자 문자(U+2800)와 같은 값이라 점자 모양은 String.fromCodePoint(0x2800 + 칸)으로 그린다.
// 화면 없이 동작하므로 content script, 확장 페이지, Node 테스트에서 같이 쓴다 (globalThis.__ongeul.hangulBraille).
// 정확도는 테스트 단계에서 한국 점자 규정 예문과 liblouis(ko-g1, ko-g2) 결과로 확인한다.
(() => {
  const ns = (globalThis.__ongeul ??= {});
  if (ns.hangulBraille) return;

  // "1246" → 점 1,2,4,6 → 칸 값
  const cell = (dots) => [...dots].reduce((sum, d) => sum | (1 << (Number(d) - 1)), 0);
  const cells = (...list) => list.map(cell);

  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

  // 된소리표(6점): ㄲ, ㄸ, ㅃ, ㅆ, ㅉ은 된소리표 + 예사소리
  const TENSE_MARK = cell('6');
  const TENSE = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

  // 첫소리 (ㅇ은 첫소리에서 적지 않는다)
  const INITIAL = {
    ㄱ: cells('4'), ㄴ: cells('14'), ㄷ: cells('24'), ㄹ: cells('5'), ㅁ: cells('15'), ㅂ: cells('45'), ㅅ: cells('6'),
    ㅇ: [], ㅈ: cells('46'), ㅊ: cells('56'), ㅋ: cells('124'), ㅌ: cells('125'), ㅍ: cells('145'), ㅎ: cells('245')
  };

  // 받침
  const FINAL = {
    ㄱ: cells('1'), ㄲ: cells('1', '1'), ㄳ: cells('1', '3'), ㄴ: cells('25'), ㄵ: cells('25', '13'), ㄶ: cells('25', '356'),
    ㄷ: cells('35'), ㄹ: cells('2'), ㄺ: cells('2', '1'), ㄻ: cells('2', '26'), ㄼ: cells('2', '12'), ㄽ: cells('2', '3'),
    ㄾ: cells('2', '236'), ㄿ: cells('2', '256'), ㅀ: cells('2', '356'), ㅁ: cells('26'), ㅂ: cells('12'), ㅄ: cells('12', '3'),
    ㅅ: cells('3'), ㅆ: cells('34'), ㅇ: cells('2356'), ㅈ: cells('13'), ㅊ: cells('23'), ㅋ: cells('235'), ㅌ: cells('236'),
    ㅍ: cells('256'), ㅎ: cells('356')
  };

  // 모음
  const VOWEL = {
    ㅏ: cells('126'), ㅑ: cells('345'), ㅓ: cells('234'), ㅕ: cells('156'), ㅗ: cells('136'), ㅛ: cells('346'),
    ㅜ: cells('134'), ㅠ: cells('146'), ㅡ: cells('246'), ㅣ: cells('135'), ㅐ: cells('1235'), ㅔ: cells('1345'),
    ㅒ: cells('345', '1235'), ㅖ: cells('34'), ㅘ: cells('1236'), ㅙ: cells('1236', '1235'), ㅚ: cells('13456'),
    ㅝ: cells('1234'), ㅞ: cells('1234', '1235'), ㅟ: cells('134', '1235'), ㅢ: cells('2456')
  };

  // 2종 약자: 모음 + 받침 묶음 (억 언 얼 연 열 영 옥 온 옹 운 울 은 을 인)
  const VOWEL_FINAL = {
    'ㅓㄱ': cells('1456'), 'ㅓㄴ': cells('23456'), 'ㅓㄹ': cells('2345'), 'ㅕㄴ': cells('16'), 'ㅕㄹ': cells('1256'),
    'ㅕㅇ': cells('12456'), 'ㅗㄱ': cells('1346'), 'ㅗㄴ': cells('12356'), 'ㅗㅇ': cells('123456'), 'ㅜㄴ': cells('1245'),
    'ㅜㄹ': cells('12346'), 'ㅡㄴ': cells('1356'), 'ㅡㄹ': cells('2346'), 'ㅣㄴ': cells('12345')
  };
  // 겹받침·쌍받침의 앞 받침과 뒤 받침. 약자가 앞 받침을 품으면 약자 뒤에 남은 받침만 적는다 (넓 = ㄴ+얼+ㅂ, 꺾 = ㄲ+억+ㄱ, 제15항 붙임)
  const SPLIT_FINAL = {
    ㄲ: ['ㄱ', 'ㄱ'], ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄶ: ['ㄴ', 'ㅎ'], ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'],
    ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅀ: ['ㄹ', 'ㅎ'], ㅄ: ['ㅂ', 'ㅅ']
  };
  // ㅅ, ㅆ, ㅈ, ㅉ, ㅊ 뒤의 '영' 약자는 '엉'으로 읽는다 (성, 정, 청)
  const EONG_AFTER = new Set(['ㅅ', 'ㅆ', 'ㅈ', 'ㅉ', 'ㅊ']);
  // 2종 약자: 'ㅏ'를 줄인 글자 (가 사는 따로 정한 칸, 나 다 마 바 자 카 타 파 하는 첫소리만)
  const A_SPECIAL = { ㄱ: cells('1246'), ㅅ: cells('123') };
  const A_DROP = new Set(['ㄴ', 'ㄷ', 'ㅁ', 'ㅂ', 'ㅈ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']);
  const GEOT = cells('456', '234'); // 것

  // 2종 약어: 낱말 첫머리의 그래서·그러나 등
  const WORD_ABBREV = [
    ['그래서', cells('1', '234')],
    ['그러나', cells('1', '14')],
    ['그러면', cells('1', '25')],
    ['그러므로', cells('1', '26')],
    ['그런데', cells('1', '1345')],
    ['그리고', cells('1', '136')],
    ['그리하여', cells('1', '156')]
  ];

  const NUMBER_SIGN = cell('3456');
  const DIGIT = { 1: '1', 2: '12', 3: '14', 4: '145', 5: '15', 6: '124', 7: '1245', 8: '125', 9: '24', 0: '245' };
  // 숫자 뒤에 이어 나오면 숫자로 잘못 읽힐 수 있어 한 칸 띄우는 첫소리 (ㄴ ㄷ ㅁ ㅋ ㅌ ㅍ ㅎ, 그리고 '운' 약자)
  const SPACE_AFTER_NUMBER = new Set(['ㄴ', 'ㄷ', 'ㅁ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']);

  const ROMAN_START = cell('356');
  const ROMAN_END = cell('256');
  const CAPITAL = cell('6');
  const LETTER = {
    a: '1', b: '12', c: '14', d: '145', e: '15', f: '124', g: '1245', h: '125', i: '24', j: '245', k: '13', l: '123', m: '134',
    n: '1345', o: '135', p: '1234', q: '12345', r: '1235', s: '234', t: '2345', u: '136', v: '1236', w: '2456', x: '1346',
    y: '13456', z: '1356'
  };

  // 문장 부호 (한국 점자 규정 2017년 개정 기준의 자주 쓰는 것)
  const PUNCT = {
    '.': cells('256'), '?': cells('236'), '!': cells('235'), ',': cells('5'), ':': cells('5', '2'), ';': cells('56', '23'),
    '-': cells('36'), '~': cells('4', '35'), '/': cells('456', '34'), '·': cells('5', '23'), '(': cells('236', '3'),
    ')': cells('6', '356'), '[': cells('236', '23'), ']': cells('56', '356'), '%': cells('456', '1234'),
    '…': cells('6', '6', '6'), '⋯': cells('6', '6', '6'), '―': cells('36', '36'), '{': cells('236', '2'), '}': cells('5', '356'),
    '『': cells('56', '236'), '』': cells('356', '23'), '「': cells('5', '236'), '」': cells('356', '2'),
    '《': cells('56', '2356'), '》': cells('2356', '23'), '〈': cells('5', '2356'), '〉': cells('2356', '2'),
    '₩': cells('4', '2456'), '&': cells('4', '1234'), '*': cells('35', '35'), '+': cells('346'), '=': cells('2356'), '@': cells('4')
  };
  // 로마자 뒤에 오면 로마자 종료표를 적지 않고 한글 점자로 적는 부호(제33항), 뒤에 종료표를 적지 않는 부호(제33항 다만)
  const KOREAN_PUNCT_AFTER_ROMAN = new Set([',', ':', ';', '―']);
  const NO_END_AFTER = new Set(['.', '?', '!', '…']);
  const CLOSERS = new Set(['"', "'", '”', '’', ')', ']', '}', '」', '』', '》', '〉']);
  const QUOTE_OPEN = { '"': cells('236'), '“': cells('236'), "'": cells('6', '236'), '‘': cells('6', '236') };
  const QUOTE_CLOSE = { '"': cells('356'), '”': cells('356'), "'": cells('356', '3'), '’': cells('356', '3') };
  // 모르는 글자: 6점 모두 (점자 사용자가 "여기 글자가 있다"는 것만 알 수 있게)
  const UNKNOWN = cell('123456');
  // 따로 쓰인 자모(ㅋㅋ, ㅠㅠ, ㄱㄴㄷ): 글자마다 앞에 온표, 자음은 받침으로 (제8항).
  // 낱말 중간이나 끝에 붙은 자음은 456점을 앞세워 받침으로 (제10항, 제23항)
  const ONPYO = cell('123456');
  const JAMO_ATTACHED = cell('456');
  // 로마자 낱말 안의 아포스트로피 (제61항, It's, don't)
  const APOSTROPHE = cell('3');
  const SPACE = 0;

  const isHangul = (ch) => {
    const code = ch?.charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
  };
  // 한글 호환 자모 (ㄱ~ㅎ 자음, ㅏ~ㅣ 모음)
  const isJamo = (ch) => {
    const code = ch?.charCodeAt(0);
    return code >= 0x3131 && code <= 0x3163;
  };
  const isJamoConsonant = (ch) => isJamo(ch) && ch.charCodeAt(0) < 0x314f;
  // 자음을 받침으로. ㄸ ㅃ ㅉ처럼 받침이 없는 자음은 된소리표 + 예사소리 받침
  const jamoCells = (ch) => (isJamoConsonant(ch) ? FINAL[ch] ?? [TENSE_MARK, ...FINAL[TENSE[ch]]] : VOWEL[ch]);

  function decompose(ch) {
    const code = ch.charCodeAt(0) - 0xac00;
    return { cho: CHO[Math.floor(code / 588)], jung: JUNG[Math.floor((code % 588) / 28)], jong: JONG[code % 28] };
  }

  // 한 음절을 점자 칸으로. next: 다음 글자(약자를 쓸 수 있는지 판단)
  function syllable({ cho, jung, jong }, next, contracted) {
    const base = TENSE[cho] ?? cho;
    const tense = TENSE[cho] ? [TENSE_MARK] : [];
    if (contracted) {
      // 것, 껏
      if (base === 'ㄱ' && jung === 'ㅓ' && jong === 'ㅅ') return [...tense, ...GEOT];
      // 모음 + 받침 약자 (억 언 …). ㅅ ㅈ ㅊ 뒤에서 '영' 약자는 '엉'으로 읽으므로, '엉'은 그 약자로 쓰고 '영'(셩 졍 쳥)은 풀어 쓴다
      const eong = EONG_AFTER.has(cho);
      const key = jung === 'ㅓ' && jong === 'ㅇ' && eong ? 'ㅕㅇ' : `${jung}${jong}`;
      if (VOWEL_FINAL[key] && !(eong && jung === 'ㅕ' && jong === 'ㅇ')) return [...tense, ...INITIAL[base], ...VOWEL_FINAL[key]];
      const split = SPLIT_FINAL[jong];
      if (split && VOWEL_FINAL[`${jung}${split[0]}`]) {
        return [...tense, ...INITIAL[base], ...VOWEL_FINAL[`${jung}${split[0]}`], ...FINAL[split[1]]];
      }
      // 'ㅏ'를 줄인 약자 (가 나 다 … 하). 나·다 등 첫소리만 쓰는 약자는 뒤에 모음으로 시작하는 글자가 오면 쓰지 않는다
      if (jung === 'ㅏ') {
        const nextStartsWithVowel = isHangul(next) && decompose(next).cho === 'ㅇ';
        if (A_SPECIAL[base]) return [...tense, ...A_SPECIAL[base], ...(FINAL[jong] ?? [])];
        // '팠'은 'ㅏ'를 줄이지 않는다 (줄이면 '폐'와 같은 칸이 됨)
        const pat = base === 'ㅍ' && jong === 'ㅆ';
        if (A_DROP.has(base) && !pat && !(nextStartsWithVowel && !jong)) return [...tense, ...INITIAL[base], ...(FINAL[jong] ?? [])];
      }
    }
    return [...tense, ...INITIAL[base], ...VOWEL[jung], ...(FINAL[jong] ?? [])];
  }

  // 앞 음절이 받침 없이 모음으로 끝나고 이 음절이 '예'이거나, 앞이 ㅑ ㅘ ㅜ ㅝ로 끝나고 이 음절이 '애'면 구분표를 넣는다
  function needsVowelSeparator(prev, current) {
    if (!prev || prev.jong || current.cho !== 'ㅇ' || current.jong) return false;
    if (current.jung === 'ㅖ') return true;
    return current.jung === 'ㅐ' && ['ㅑ', 'ㅘ', 'ㅜ', 'ㅝ'].includes(prev.jung);
  }

  // 글 → { cells: 칸 값 배열, source: 칸마다 원문 글자 위치, unknown: 바꾸지 못한 글자 }
  // grade: 2(약자 사용, 기본) 또는 1(약자 없음)
  function translate(text, { grade = 2 } = {}) {
    const contracted = grade !== 1;
    const out = [];
    const source = [];
    const unknown = [];
    const chars = [...(text ?? '')];
    const emit = (list, at) => {
      for (const value of list) {
        out.push(value);
        source.push(at);
      }
    };
    let prevSyllable = null;
    let inNumber = false;
    let inRoman = false;
    let quoteOpen = { '"': false, "'": false };
    // 바로 앞 자음 자모가 낱말에 붙어 456점으로 적혔는지 (주ㄹㄹ처럼 이어지는 자음도 붙여 적는다)
    let jamoAttached = false;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const next = chars[i + 1];
      const prev = chars[i - 1];

      // 로마자 사이의 ' 와 ’는 따옴표가 아니라 아포스트로피 (로마자를 끊지 않고, 따옴표 짝도 바꾸지 않는다)
      if ((ch === "'" || ch === '’') && /[A-Za-z]/.test(prev ?? '') && /[A-Za-z]/.test(next ?? '')) {
        emit([APOSTROPHE], i);
        continue;
      }
      if (!isJamo(ch)) jamoAttached = false;

      // 로마자가 끝나면 로마자 종료표 (제29항). 띄어 쓴 다음 낱말도 로마자면 한 덩어리로 보고 마지막에만 적는다.
      // 적지 않는 경우: 숫자가 이어질 때(제35항), 한글식 쉼표·쌍점·쌍반점·줄표가 올 때(제33항),
      // 마침표·물음표·느낌표·줄임표가 올 때(제33항 다만), 따옴표나 괄호로 묶일 때(제34항)
      if (inRoman && !/[A-Za-z]/.test(ch)) {
        const nextVisible = chars.slice(i).find((c) => !/\s/.test(c));
        const continues = /\s/.test(ch) && nextVisible && /[A-Za-z]/.test(nextVisible);
        if (!continues) {
          const skip = /[0-9]/.test(ch) || KOREAN_PUNCT_AFTER_ROMAN.has(ch) || NO_END_AFTER.has(ch) || CLOSERS.has(ch) ||
            (ch === '.' && chars[i + 1] === '.');
          if (!skip) emit([ROMAN_END], i);
          inRoman = false;
        }
      }

      if (/\s/.test(ch)) {
        if (out.length && out.at(-1) !== SPACE) emit([SPACE], i);
        inNumber = false;
        prevSyllable = null;
        continue;
      }

      if (/[0-9]/.test(ch)) {
        if (!inNumber) emit([NUMBER_SIGN], i);
        inNumber = true;
        emit([cell(DIGIT[ch])], i);
        prevSyllable = null;
        continue;
      }
      // 숫자 사이의 쉼표·마침표는 숫자 안에서 쓰는 점(쉼표 2점, 소수점 256점)
      if (inNumber && (ch === ',' || ch === '.') && /[0-9]/.test(next ?? '')) {
        emit([cell(ch === ',' ? '2' : '256')], i);
        continue;
      }

      if (/[A-Za-z]/.test(ch)) {
        if (!inRoman) emit([ROMAN_START], i);
        inRoman = true;
        inNumber = false;
        // 대문자: 한 글자면 대문자 기호표, 두 글자 이상 이어지면 그 앞에 대문자 단어표 한 번 (제28항 붙임)
        const upper = (c) => /[A-Z]/.test(c ?? '');
        if (upper(ch) && !upper(prev)) emit(upper(next) ? [CAPITAL, CAPITAL] : [CAPITAL], i);
        emit([cell(LETTER[ch.toLowerCase()])], i);
        prevSyllable = null;
        continue;
      }

      if (isJamo(ch)) {
        const attached = isJamoConsonant(ch) && (isHangul(prev) || (jamoAttached && isJamoConsonant(prev)));
        emit([attached ? JAMO_ATTACHED : ONPYO, ...jamoCells(ch)], i);
        jamoAttached = attached;
        inNumber = false;
        prevSyllable = null;
        continue;
      }

      if (isHangul(ch)) {
        const parts = decompose(ch);
        if (inNumber && (SPACE_AFTER_NUMBER.has(parts.cho) || (parts.jung === 'ㅜ' && parts.jong === 'ㄴ' && parts.cho === 'ㅇ'))) {
          emit([SPACE], i);
        }
        inNumber = false;
        // 낱말 첫머리의 약어 (그래서 등)
        const atWordStart = !prev || !isHangul(prev);
        if (contracted && atWordStart) {
          const rest = chars.slice(i).join('');
          const abbrev = WORD_ABBREV.find(([word]) => rest.startsWith(word));
          if (abbrev) {
            emit(abbrev[1], i);
            i += abbrev[0].length - 1;
            prevSyllable = null;
            continue;
          }
        }
        if (needsVowelSeparator(prevSyllable, parts)) emit([cell('36')], i);
        emit(syllable(parts, next, contracted), i);
        prevSyllable = parts;
        continue;
      }

      inNumber = false;
      prevSyllable = null;
      if (QUOTE_OPEN[ch] && QUOTE_CLOSE[ch] && (ch === '"' || ch === "'")) {
        const kind = ch;
        emit(quoteOpen[kind] ? QUOTE_CLOSE[ch] : QUOTE_OPEN[ch], i);
        quoteOpen[kind] = !quoteOpen[kind];
        continue;
      }
      if (QUOTE_OPEN[ch]) {
        emit(QUOTE_OPEN[ch], i);
        continue;
      }
      if (QUOTE_CLOSE[ch]) {
        emit(QUOTE_CLOSE[ch], i);
        continue;
      }
      if (PUNCT[ch]) {
        emit(PUNCT[ch], i);
        continue;
      }
      unknown.push(ch);
      emit([UNKNOWN], i);
    }
    if (inRoman) emit([ROMAN_END], chars.length - 1);
    while (out.at(-1) === SPACE) {
      out.pop();
      source.pop();
    }
    return { cells: out, source, unknown };
  }

  // 칸 값 → 점자 모양, 점 번호
  const toUnicode = (list) => list.map((value) => String.fromCodePoint(0x2800 + value)).join('');
  const dotNumbers = (value) =>
    value === 0 ? '빈칸' : [1, 2, 3, 4, 5, 6, 7, 8].filter((d) => value & (1 << (d - 1))).join('');

  ns.hangulBraille = { translate, toUnicode, dotNumbers, cell };
})();
