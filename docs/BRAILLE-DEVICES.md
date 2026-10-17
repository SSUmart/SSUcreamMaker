# 점자 디스플레이 연결 설계

온글은 실제 점자 디스플레이 대신 **가상 점자 디스플레이**로 점자 출력을 구현하고 확인합니다. 이 문서는 실제 기기를 연결한다면 **기기 종류에 따라 어느 부분을 어떻게 설계해야 하는지** 정리한 기록입니다. 발표와 후속 개발의 근거 자료로 씁니다.

조사일: 2026-10-15. 출처는 맨 아래에 있습니다. 기기별 세부 사항(보고서 형식, 명령 코드)은 실제 기기와 제조사 문서로 다시 확인해야 합니다.

## 1. 스크린리더와 점자 디스플레이의 역할 나눔

| 단계 | 하는 쪽 | 내용 |
|---|---|---|
| 화면 읽기 | 스크린리더 | 페이지에서 읽을 글을 만든다 ("장바구니 담기, 버튼") |
| **점자 변환** | **스크린리더** | 글을 점자 규칙(한국 점자 1종·2종)에 따라 점자 칸으로 바꾼다 |
| 칸 데이터 만들기 | 스크린리더 | 칸 하나를 1바이트로 만든다. 1~8번 점이 각 비트(1번 점 = 1, 2번 점 = 2, 3번 점 = 4 … 8번 점 = 128) |
| 줄 나누기 | 스크린리더 | 기기 칸 수(20, 32, 40, 80칸 등)에 맞게 잘라 보내고, 앞뒤 줄 넘기기를 처리한다 |
| 전송 | 스크린리더 → 기기 | USB 또는 블루투스로 칸 데이터를 보낸다 |
| 핀 올리기 | 점자 디스플레이 | 받은 칸 데이터대로 핀을 올린다. **글자를 점자로 바꾸는 일은 하지 않는다** |
| 입력 | 기기 → 스크린리더 | 커서 이동 버튼(그 칸 위치로 이동), 줄 넘기기 버튼, 점자 키보드 입력을 보낸다 |

점자 변환은 스크린리더가 하고, 기기는 받은 점 배열을 그대로 표시합니다. 그래서 온글은 기기 종류와 관계없이 **점자 변환과 칸 데이터 만들기까지 공통으로** 하고, **전송 계층만 기기 종류별로 바꾸면** 됩니다.

```
읽을 글 → 한국 점자 변환 → 칸 데이터(바이트 배열) → [전송 계층] → 기기
                                                  │
                                    ┌─────────────┼──────────────┬───────────────┐
                                    ▼             ▼              ▼               ▼
                              가상 디스플레이   HID 표준 기기    BLE + 제조사 SDK   제조사 시리얼 방식
                              (온글 현재)      (WebHID)       (Web Bluetooth)   (Web Serial)
```

## 2. 기기 종류별 전송 계층 설계

### 2-1. 가상 점자 디스플레이 (온글 구현)

- 전송 계층이 칸 데이터를 화면 속 가상 기기에 넘기고, 가상 기기는 칸마다 점 8개를 그린다
- 커서 이동 버튼과 줄 넘기기 버튼을 흉내 내어 입력 방향(기기 → 스크린리더)도 확인한다
- 관리자 도구(점자 전달 테스트)에서 원문, 점자, 칸 데이터, 전송 결과, 왕복 확인을 보여 준다
- 실제 기기와 같은 인터페이스(칸 데이터 쓰기, 입력 이벤트 받기)로 만들어, 다른 전송 계층으로 바꿀 때 나머지를 고치지 않게 한다
- 구현: `extension/content/reader/braille.js`의 `virtualTransport`. 모양은 `{ name, cells, connected, write(bytes) → { ok, ms }, onInput(handler) }`이고, 기기 버튼은 `{ type: 'routing', cell }`, `{ type: 'pan', direction }` 신호로 들어온다. 실제 기기 전송 계층(WebHID 등)도 이 모양으로 만들어 `transport`만 바꾸면 된다

### 2-2. USB·블루투스 HID 점자 표준 기기

- **표준**: USB-IF의 점자 디스플레이 HID 표준(HUTRR78). 사용 페이지(usage page) `0x41`로 점자 디스플레이를 알아본다. 최근 기기 다수가 지원하고, Windows 11 내레이터, iOS, Android는 별도 드라이버 없이 연결한다
- **크롬 확장에서**: WebHID (`navigator.hid`, 확장은 Chrome 117 이상)
  - 기기 고르기(`requestDevice`)는 **사용자가 버튼을 누른 순간에, 확장 페이지(설정 화면, 팝업)에서만** 할 수 있다. 서비스 워커에서는 안 된다. 필터는 `usagePage: 0x41`
  - 한 번 허락받은 뒤에는 서비스 워커에서 `getDevices()`로 다시 연결할 수 있다. 연결을 열어 두면 서비스 워커가 유지된다
  - 기기의 보고서 설명(report descriptor)에서 출력 보고서의 "점자 칸" 배열 길이(칸 수)를 읽고, `sendReport`로 칸 데이터를 보낸다
  - 입력 보고서로 커서 이동 버튼과 점 키 입력을 받는다
- **주의**
  - 키보드·마우스로 표시된 HID 묶음은 WebHID가 막는다. 점자 키보드 입력이 키보드로 표시된 기기는 입력 일부를 못 받을 수 있다
  - 기기마다 표준과 조금 다르게 동작한다. 예: "지금 쓸 수 있는 칸 수"를 입력으로 보내는 기기(BRLTTY의 Activator 수정 사례)

### 2-3. 블루투스 저전력(BLE) + 제조사 SDK 기기 (예: 닷패드)

- **예**: 닷(Dot)의 닷패드. 점자 한 줄(20칸)과 그림을 표시하는 촉각 그래픽 영역이 있고, 블루투스 LE 5.0으로 통신
- **크롬 확장에서**: Web Bluetooth와 제조사 SDK. 연결 방식과 데이터 형식은 SDK에 따름. 웹용 SDK 문서는 공개 자료에서 찾지 못했으므로 제조사 개발자 포털에 문의
- **주의**
  - 닷 공식 FAQ: VoiceOver가 닷패드에 연결되어 있으면 SDK로 쓸 수 없다. 운영체제 스크린리더 연결을 먼저 끊어야 한다
  - 촉각 그래픽 영역에 그림·차트를 표시할 수 있어, 온글의 AI 그림 설명과 함께 쓸 수 있다

### 2-4. 제조사 고유 시리얼 방식 기기

- **예**: 오래된 기기, 또는 USB 모드를 시리얼로 바꾼 기기 (일부 기기는 메뉴에서 HID와 시리얼을 바꿀 수 있음)
- **크롬 확장에서**: Web Serial. 제조사마다 연결 인사(handshake), 칸 쓰기 명령, 입력 형식이 다르므로 기기별로 구현해야 한다
- **참고 구현**: 공개 스크린리더 BRLTTY와 NVDA의 기기별 드라이버 소스
- 국내 기기(한소네, 브레일엣지 등)는 연결 방식(HID 지원 여부, 시리얼 모드)을 제조사 설명서로 확인해야 한다

## 3. 기기 종류와 관계없이 지켜야 할 것

- **한 기기는 한 프로그램만 쓸 수 있다**: 운영체제 스크린리더(NVDA, 센스리더, VoiceOver)가 기기를 잡고 있으면 온글이 쓸 수 없다
- **"전달 성공"의 범위**: 프로그램이 확인할 수 있는 것은 "기기가 데이터를 오류 없이 받았다"까지다. 핀이 실제로 올라왔는지는 사람이 만져 확인하거나, 기기 버튼을 눌러 신호가 돌아오는지(왕복 확인)로 확인한다
- **칸 수가 기기마다 다르다**: 보고서 설명이나 기기 정보에서 칸 수를 읽어 줄 나누기에 쓴다
- **한국 점자 규칙**: 약자를 쓰는 2종이 일반적이고, 약자 없는 1종도 선택할 수 있어야 한다. 2006년 문장 부호 개정이 있다

## 4. 발표용 요약

| 기기 종류 | 크롬 확장 연결 기술 | 바꿀 부분 | 난이도 |
|---|---|---|---|
| 가상 디스플레이 (현재) | 없음 (화면에 그림) | - | 구현함 |
| HID 표준 기기 | WebHID | 전송 계층: 기기 고르기, 칸 수 읽기, 보고서 보내기·받기 | 중간 (표준이라 기기 공통) |
| BLE + 제조사 SDK (닷패드) | Web Bluetooth | 전송 계층: SDK 연결 | 중간 (SDK 문서 필요) |
| 제조사 시리얼 방식 | Web Serial | 전송 계층: 기기별 통신 규칙 | 높음 (기기마다 구현) |

## 출처

- [Chrome 확장에서 WebHID 사용](https://developer.chrome.com/docs/extensions/how-to/web-platform/webhid?hl=ko)
- [HID braille display support, Nordic DevZone](https://devzone.nordicsemi.com/f/nordic-q-a/26530/hid-braille-display-support-ios11)
- [Android BrailleDisplayController](https://developer.android.com/reference/kotlin/android/accessibilityservice/BrailleDisplayController)
- [HID braille ESP32 (HUTRR78 참고)](https://github.com/brailletouch/HID-braille-ESP32)
- [NVDA HID 점자 드라이버 변경](https://app.semanticdiff.com/gh/nvaccess/nvda/commit/00cd67b737bc5b23a6f5e31cf28110b64ebf2fee)
- [BRLTTY Activator 기기 지원 변경](https://third-party-mirror.googlesource.com/brltty/+/refs/heads/master%5E%21/)
- [USB-IF 점자 디스플레이 표준 소개 (next.ink)](https://next.ink/brief-article/usb-if-un-standard-pour-les-ecrans-en-braille/)
- [Windows 11 내레이터 점자 지원 (ElevenForum)](https://www.elevenforum.com/t/install-or-uninstall-braille-support-for-narrator-in-windows-11.39378/latest)
- [liblouis 한국 점자 표 ko-g1](https://nest-open-source.googlesource.com/manifest_repos/liblouis-github/+/refs/heads/main/tables/ko-g1.ctb), [ko-g2](https://nest-open-source.googlesource.com/manifest_repos/liblouis-github/+/refs/heads/main/tables/ko-g2.ctb), [ko.cti](https://nest-open-source.googlesource.com/manifest_repos/liblouis-github/+/refs/heads/main/tables/ko.cti), [ko-2006.cti](https://third-party-mirror.googlesource.com/liblouis_for_aas/+/refs/heads/master/liblouis/tables/ko-2006.cti)
- [Dot 개발자 FAQ](https://developer.dotincorp.com/faq), [Dot 개발자 포털](https://dev-developer.dotincorp.com/), [Developing for Dot Pad](https://blog.dotincorp.com/developing-for-dot-pad), [Dot Pad 제품](https://www.dotincorp.com/en/product/pad), [DotPad320 JAWS 설명서](https://www.dotincorp.com/guide/resources/JAWSManual/Using_the_DotPad320_with_JAWS.docx)
- [HIMS Braille Edge 리뷰 (NFB)](https://nfb.org/node/1773)
- [APH Monarch 터미널 모드](https://www.aph.org/blog/terminal-mode-goes-live-with-jaws-on-monarch/)
