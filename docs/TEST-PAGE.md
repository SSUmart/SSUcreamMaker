# 테스트 페이지 구동 가이드

확장 프로그램을 시험하는 가상 쇼핑몰 상품 페이지(`eval/shop/`)를 다른 PC에서 띄우는 방법입니다. 페이지 구성과 평가 방법은 [eval/README.md](../eval/README.md#쇼핑몰형-테스트-페이지-shop)를 참고하세요.

## 준비

- Node.js 20 이상 ([nodejs.org](https://nodejs.org/)에서 LTS 설치)
- 저장소 받기

```bash
git clone https://github.com/SSUmart/SSUcreamMaker.git
cd SSUcreamMaker/eval
```

페이지만 띄울 때는 `npm install`이 필요 없습니다.

## 실행

```bash
npm run shop
```

브라우저에서 `http://127.0.0.1:8080/shop/`을 엽니다. 끌 때는 터미널에서 `Ctrl+C`를 누릅니다.

### 포트 바꾸기

8080 포트를 이미 쓰고 있으면 다른 포트로 띄웁니다.

| 환경 | 명령 |
|---|---|
| macOS, Linux | `PORT=9000 npm run shop` |
| Windows PowerShell | `$env:PORT=9000; npm run shop` |
| Windows 명령 프롬프트 | `set PORT=9000 && npm run shop` |

### 다른 PC에서 접속하기

서버는 기본적으로 실행한 PC에서만 열립니다. 예를 들어 Mac에서 띄우고 같은 와이파이의 Windows PC에서 NVDA로 시험하려면 `HOST=0.0.0.0`을 붙여 실행합니다. (Windows에서는 위 표처럼 `$env:HOST="0.0.0.0"`)

```bash
HOST=0.0.0.0 npm run shop
```

다른 PC에서는 `http://<서버 PC의 IP 주소>:8080/shop/`으로 엽니다. IP 주소는 macOS `시스템 설정 → 네트워크`, Windows `ipconfig`로 확인합니다.

- 같은 네트워크의 누구나 접속할 수 있으니 시험이 끝나면 서버를 끕니다.
- 학교·회사 네트워크나 방화벽이 막으면 접속되지 않습니다. 이때는 시험할 PC에서 직접 실행하세요.

## 확장과 함께 시험하기

1. 시험할 PC의 Chrome, Edge, Whale에서 확장을 설치합니다. ([README 설치](../README.md#설치))
2. 확장 설정에서 AI를 켜고 API 키를 넣습니다.
3. 테스트 페이지를 열고 상세정보까지 스크롤한 뒤 `Alt+Shift+D`를 누릅니다.
4. 스크린리더로 "상세 이미지 내용, AI 추출" 제목과 그 아래 소제목(h3)을 읽어 봅니다.

사용자 테스트 과제 예시:

- 이 상품의 할인가는 얼마인가요?
- 식기세척기에 넣어도 되나요?
- 교환·반품은 며칠 안에 신청해야 하나요?

확장을 켜기 전에는 답할 수 없고(상세 이미지에만 적혀 있음), 켠 뒤에는 답할 수 있어야 합니다.

## 상세 이미지를 고친 경우

`eval/shop/detail/detail.html`의 글자를 고쳤다면 이미지를 다시 만듭니다. 이때만 Playwright가 필요합니다.

```bash
npm install
npx playwright install chromium
npm run shop:build
```

다시 만든 뒤 `eval/cases.json`의 `shop-tumbler` 정답도 함께 고치고, 저장소 루트에서 `npm test`로 정답 문구가 원본과 맞는지 확인합니다. 글꼴은 PC마다 달라서(macOS는 Apple SD Gothic Neo, 그 밖에는 Noto Sans KR) 결과 이미지 크기가 바뀔 수 있습니다. 바뀌면 `eval/shop/index.html`의 상세 이미지 `height`를 맞춰 주세요.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `EADDRINUSE` 오류 | 8080 포트를 다른 프로그램이 쓰는 중. 포트를 바꿔 실행 |
| 페이지가 안 열림 | 터미널에 `평가용 쇼핑몰: http://...`이 나왔는지, 주소의 포트가 맞는지 |
| 다른 PC에서 안 열림 | `HOST=0.0.0.0`으로 실행했는지, 두 PC가 같은 네트워크인지, 방화벽 |
| 확장이 "이미지를 찾지 못했습니다" | 상세정보 탭이 열려 있는지, 끝까지 스크롤해 상세 이미지가 다 보였는지 |
| HTML 파일을 더블클릭해 열면 확장이 동작하지 않음 | `file://` 주소에서는 확장이 이미지를 가져오지 못할 수 있음. `npm run shop`으로 띄운 주소를 사용 |
