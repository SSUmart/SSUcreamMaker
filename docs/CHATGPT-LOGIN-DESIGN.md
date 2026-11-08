# ChatGPT 로그인으로 AI 쓰기 설계 (검토용)

> 상태: **구현함** (확장 `lib/chatgpt.js`, 연결 프로그램 `bridge/`, 사용 안내 [CHATGPT-LOGIN.md](CHATGPT-LOGIN.md)). 아래는 설계 당시 내용이며, 구현에서 정한 것은 맨 아래 "구현에서 정한 것"에 적었습니다.

## 1. 목표

지금 온글의 AI 기능은 API 키가 있어야 합니다(Gemini, NVIDIA NIM). 키를 발급받고 설정에 붙여 넣는 과정은 스크린리더 사용자에게 어렵고, 유료 API는 사용량만큼 요금이 나옵니다.

**API 키 대신, 이미 가진 ChatGPT 계정으로 로그인해서 AI 기능을 쓸 수 있게 합니다.** API 연동은 그대로 두고 공급자 하나를 더하는 방식입니다.

## 2. 결론 요약

- 크롬 확장 프로그램만으로는 안전하게 할 수 없습니다. PC에 **작은 연결 프로그램**을 설치하고, 그 프로그램이 OpenAI의 공식 **Codex CLI**로 로그인과 AI 호출을 대신합니다.
- 확장과 연결 프로그램은 크롬의 **Native Messaging**으로 이어집니다(크롬이 공식으로 제공하는 확장 ↔ PC 프로그램 통로).
- 같은 팀의 AML 프로젝트(AI 매뉴얼 실험실)가 이미 같은 방식(Codex CLI 동봉, `codex login` → `codex exec`)으로 동작하므로, 로그인 처리 코드(`ui/login.js`)를 참고할 수 있습니다.
- `codex exec`는 한 번 부를 때 몇 초에서 십여 초가 걸려, **가끔 쓰는 기능(요약·질문·상세 이미지 읽기·항목 설명)**에 씁니다. 자주 부르는 **자동 보완은 API 공급자를 그대로 권장**합니다(9장).

## 3. 검토한 방법

| 방법 | 내용 | 판단 |
|---|---|---|
| **A. 연결 프로그램 + Codex CLI** | PC에 연결 프로그램과 Codex CLI를 설치. 온글이 Native Messaging으로 요청하면 연결 프로그램이 `codex login`·`codex exec`를 실행 | **채택.** OpenAI 공식 CLI와 공식 로그인 화면을 그대로 씀. 인증 정보는 Codex가 관리하고 온글은 보지 않음 |
| B. 확장이 직접 OpenAI 로그인 | Codex의 로그인 방식(OAuth)을 확장이 흉내 내고 ChatGPT 내부 API를 직접 호출 | 제외. 다른 앱용으로 등록된 로그인을 빌려 쓰는 것이라 공식으로 허용된 사용이 아니고, 언제든 막힐 수 있으며 계정에 문제가 생길 수 있음 |
| C. 서버 한 곳에서 대신 호출 | SSU-DEV에 한 계정으로 로그인해 두고 온글이 서버로 요청 | 제외. 한 사람의 ChatGPT 계정을 여럿이 나눠 쓰는 셈이고, 다른 사용자가 보는 페이지 내용이 그 계정으로 전송됨 |

## 4. 구조

```
온글 (크롬 확장, 서비스 워커)
  │  chrome.runtime.connectNative('me.jaymong.ongeul')
  │  JSON 메시지 (요청 ↔ 진행 ↔ 결과)
  ▼
연결 프로그램 (ongeul-bridge, Node 단일 파일)      ← 크롬이 필요할 때 실행·종료
  │  codex login / login status / logout
  │  codex exec  (질문은 stdin, 이미지는 임시 파일, 답은 -o 파일)
  ▼
Codex CLI (OpenAI 공식)                              ← ChatGPT 계정으로 로그인
  │  인증 파일: 온글 전용 폴더 (CODEX_HOME)
  ▼
OpenAI (사용자 본인의 ChatGPT 계정 사용량)
```

- **온글 전용 Codex 폴더:** 연결 프로그램은 `CODEX_HOME`을 온글 전용 폴더(예: Windows `%LOCALAPPDATA%\Ongeul\codex`, macOS `~/Library/Application Support/Ongeul/codex`)로 정해 실행합니다. 사용자가 원래 쓰던 Codex 설정·기록과 섞이지 않습니다.
- **연결 허용:** 크롬은 연결 프로그램 등록 파일의 `allowed_origins`에 적힌 확장만 연결을 허락합니다. 압축 해제로 설치하는 지금은 확장 ID가 설치 폴더마다 달라지므로, `manifest.json`에 **`key`를 넣어 확장 ID를 고정**해야 합니다(배포 zip도 같은 ID).
- **권한:** `manifest.json`에 `nativeMessaging` 권한 추가. 연결 프로그램이 없으면 이 공급자만 "설치되지 않음"으로 안내하고 나머지 기능은 그대로 동작합니다.

## 5. 메시지 규약 (온글 ↔ 연결 프로그램)

Native Messaging은 길이(4바이트) + JSON 한 덩어리씩 주고받습니다. 연결 프로그램 → 크롬은 **메시지 하나에 1MB까지**이므로 답은 텍스트만 보냅니다. 크롬 → 연결 프로그램은 64MB까지라 이미지를 base64로 보내도 됩니다.

| 요청 (`type`) | 내용 | 응답 |
|---|---|---|
| `hello` | 버전 확인 | `{ bridge, codex, ok }` (Codex가 없으면 `codex: null`) |
| `status` | 로그인 상태 | `{ loggedIn }` (`codex login status` 종료 코드로만 판단, 인증 파일은 읽지 않음) |
| `login` | `{ method: 'browser' \| 'device' }` | 진행 중 `{ url }` 또는 `{ url, code }`, 끝나면 `{ loggedIn: true }` 또는 `{ error }` |
| `logout` | 로그아웃 | `{ loggedIn: false }` |
| `models` | 로그인한 계정에서 쓸 수 있는 모델 목록 (7장) | `{ models: [{ slug, name, image }] }` |
| `generate` | `{ id, prompt, images: [{ mimeType, data }], schema?, model? }` | 진행 `{ id, progress }`, 끝 `{ id, text }` 또는 `{ id, error }` |
| `cancel` | `{ id }` | 실행 중인 `codex exec`를 끝냄 |

`generate`는 연결 프로그램이 이렇게 실행합니다.

```
codex exec --ephemeral --skip-git-repo-check --ignore-user-config --ignore-rules
           --sandbox read-only -C <빈 임시 폴더>
           [-i <임시 이미지 파일>...] [--output-schema <임시 스키마 파일>] [-m <모델>]
           -o <임시 답 파일>  -          ← 질문은 stdin
```

- `--ephemeral`: 대화 기록을 남기지 않음. `--sandbox read-only`와 빈 임시 폴더: 모델이 PC 파일을 쓰거나 다른 폴더를 볼 수 없게 함. `--ignore-user-config`·`--ignore-rules`: 사용자의 Codex 설정·규칙이 결과를 바꾸지 않게 함
- 웹 검색·셸 실행 같은 도구 기능은 `--disable`로 끔(시험판에서 끌 기능 목록을 정함). 온글이 필요한 것은 "글과 그림을 받아 답하기"뿐
- 실행이 끝나면 임시 폴더(이미지·답 파일 포함)를 지움
- 동시에 하나씩만 실행하고, 기다리는 요청은 줄을 세움(사용량 보호). 제한 시간(예: 120초)이 지나면 프로세스 트리를 끝냄

## 6. 설정 화면: 연결 방식 고르기

온글 설정의 AI 칸 맨 위에 **연결 방식**을 먼저 고르게 합니다. 지금의 공급자 라디오 버튼(Gemini, NVIDIA NIM)은 "API 키" 아래로 들어갑니다.

```
AI 연결 방식 (라디오 버튼 묶음)
  ( ) API 키로 연결          → 공급자: Gemini / NVIDIA NIM, API 키, 모델   (지금과 같음)
  ( ) ChatGPT 계정으로 로그인 → 연결 프로그램 상태, 로그인·로그아웃, 모델
```

- 고른 방식만 아래 칸이 보이고, 다른 방식의 설정(API 키 등)은 지우지 않고 남겨 둡니다. 다시 바꾸면 그대로 씁니다.
- "ChatGPT 계정으로 로그인"을 골랐는데 연결 프로그램이 없으면 "연결 프로그램이 설치되어 있지 않습니다"와 설치 안내 링크를 보여 주고, AI 기능은 API 방식으로 돌아가지 않고 같은 안내를 읽습니다(몰래 다른 방식으로 바꾸지 않음).
- 설정 저장 모양: `settings.connection = 'api' | 'chatgpt'`, `settings.chatgpt = { model }`. 기존 `settings.provider`(gemini·nim)는 API 방식 안에서 그대로 씁니다. 저장된 설정에 `connection`이 없으면 `'api'`로 보아 지금 사용자는 바뀌는 것이 없습니다.
- 자동 보완을 API로 따로 돌리는 선택(9장)은 "ChatGPT 계정으로 로그인" 칸 안에 "자동 보완은 API 키로 하기" 체크 상자로 둡니다.

## 7. 모델 선택 (구독에 따라)

ChatGPT 요금제(무료·Plus·Pro·Business 등)에 따라 쓸 수 있는 모델이 다르므로, 목록을 온글에 고정하지 않고 **로그인한 계정 기준으로 Codex에서 받아 옵니다.**

- 연결 프로그램에 `models` 요청을 더하고, `codex debug models`(모델 목록 JSON)를 실행해 돌려줍니다. 이 Mac(Codex 0.166)에서 확인한 항목: `slug`(모델 이름), `display_name`, `visibility`(`list`면 사용자에게 보여 주는 모델, `hide`면 내부용), `input_modalities`(`image`가 있으면 이미지 입력 가능), `priority`(목록 순서)
- 온글은 `visibility`가 `list`이고 **`input_modalities`에 `image`가 있는 모델만** 보여 줍니다(상세 이미지 읽기에 필요). 맨 앞의 "자동 (계정 기본 모델)"을 기본으로 두어, 고르지 않으면 `-m` 없이 실행해 Codex가 계정에 맞는 기본 모델을 쓰게 합니다.
- 목록은 로그인할 때와 설정 화면을 열 때 새로 받고, 받은 시각과 함께 저장합니다. 고른 모델이 나중에 목록에서 빠지면(요금제 변경 등) "고른 모델을 지금 계정에서 쓸 수 없습니다. 자동으로 바꿨습니다"라고 읽고 자동으로 돌립니다. 실행이 사용량 한도·권한 오류로 실패해도 같은 안내를 합니다.
- **확인 필요:** `codex debug models`는 디버그용 명령이라 출력 모양이 버전마다 바뀔 수 있고, 요금제별로 목록이 실제로 걸러지는지는 아직 확인하지 않았습니다(이 Mac의 계정 하나로만 봄). 시험판에서 요금제가 다른 계정 둘 이상으로 확인하고, 걸러지지 않으면 공식 앱 서버(`codex app-server`)의 모델 목록 요청을 쓰거나 실행 실패를 보고 목록에서 빼는 방식으로 바꿉니다. Codex 버전을 고정(10장)하는 이유이기도 합니다.

## 8. 로그인 화면 (스크린리더 사용자 기준)

"ChatGPT 계정으로 로그인"을 고르면 아래 순서로 로그인합니다.

1. "ChatGPT 로그인" 버튼 → 연결 프로그램이 `codex login` 실행 → 온글이 받은 OpenAI 로그인 주소를 **새 탭으로 열고** "로그인 창을 열었습니다. 로그인을 마치면 이 탭으로 돌아오세요"라고 읽음
2. 브라우저 로그인이 어렵거나 다른 기기로 하고 싶으면 **"기기 코드로 로그인"** → 온글이 코드(예: `ABCD-12345`)를 한 글자씩 읽고 점자로도 보여 주며, 입력할 주소를 알려 줌
3. 로그인이 끝나면 "ChatGPT에 로그인했습니다"를 읽고 상태 표시를 바꿈. 15분 안에 끝나지 않으면 취소하고 다시 시도하도록 안내
4. "로그아웃"은 `codex logout` 뒤 인증 파일이 남았는지 확인(AML과 같음)

- OpenAI 로그인 화면 자체의 접근성은 온글이 바꿀 수 없습니다. 실제 스크린리더로 로그인을 끝까지 할 수 있는지 시험판에서 확인합니다.

## 9. 기능별 사용 범위

| 기능 | 부르는 빈도 | ChatGPT 로그인 |
|---|---|---|
| 페이지 요약 | 사용자가 요청할 때 | 사용 |
| 페이지 질문·답 | 사용자가 요청할 때 | 사용 (이전 대화는 질문 글에 함께 넣음, `--ephemeral`이라 Codex에는 남지 않음) |
| 상세 이미지 읽기 | 사용자가 요청할 때, 이미지 여러 장 | 사용 (`-i`로 여러 장 첨부. 장 수 한도는 시험판에서 확인) |
| 현재 항목 AI 설명 | 사용자가 요청할 때 | 사용 |
| 자동 보완 (이름 없는 항목) | 페이지를 열 때 여러 개, 이동할 때마다 | **API 공급자 권장.** ChatGPT만 쓰면 한 개에 수 초씩 걸려 "분석 중"이 길어짐. 설정에서 "자동 보완은 API, 나머지는 ChatGPT"처럼 나눠 고를 수 있게 함 |

- 공급자 코드(`extension/lib/providers.js`)에 지금 공급자와 같은 모양(글 생성, 이미지 포함 생성)의 `chatgpt` 공급자를 더하므로, 기능 쪽 코드는 거의 바뀌지 않습니다.
- 답 형식이 정해진 기능(자동 보완 이름, 상세 이미지 결과 등)은 `--output-schema`로 형식을 고정할 수 있습니다.

## 10. 설치와 배포

| 항목 | Windows | macOS |
|---|---|---|
| 연결 프로그램 | `%LOCALAPPDATA%\Ongeul\bridge\` | `~/Library/Application Support/Ongeul/bridge/` |
| 크롬 등록 | 레지스트리 `HKCU\Software\Google\Chrome\NativeMessagingHosts\me.jaymong.ongeul` → 등록 파일 경로 | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/me.jaymong.ongeul.json` |
| 실행 파일 | Node 실행 파일 동봉 또는 단일 실행 파일로 묶음 | 같음 |
| Codex CLI | AML처럼 동봉(버전 고정) | 동봉 또는 Homebrew |

- 설치 스크립트 하나(`install-bridge.ps1` / `install-bridge.command`)로 위 작업을 모두 하고, 끝나면 소리로 결과를 알림. 관리자 권한이 필요 없게 사용자 폴더와 `HKCU`만 씀
- 제거 스크립트도 함께 제공(등록 파일·레지스트리·온글 전용 Codex 폴더 삭제)
- 릴리즈 zip에 연결 프로그램 설치 묶음을 따로 붙임(`ongeul-bridge-windows.zip`, `ongeul-bridge-macos.zip`). Codex를 동봉하면 용량이 크므로(AML의 Windows 동봉본 `runtime/codex`가 약 377MB) 확장 zip과 나눔
- 동봉한 Codex CLI 버전을 기록하고, 업데이트는 릴리즈와 함께 함. Codex의 라이선스(Apache-2.0)와 재배포 조건은 시험판 단계에서 확인

### Codex CLI는 꼭 필요한가

- **ChatGPT 로그인 방식에는 필요합니다.** ChatGPT 구독으로 AI를 부르는 공식 통로가 Codex(CLI·앱·앱 서버)뿐이기 때문입니다. Codex 없이 확장이 직접 로그인하는 방법(3장 B)은 공식으로 허용된 사용이 아니라서 제외했습니다.
- **API 방식에는 필요 없습니다.** API 키만 쓰는 사용자는 지금처럼 확장 zip 하나만 설치하면 되고, 연결 프로그램과 Codex를 설치하지 않아도 됩니다.
- 넣는 방법은 둘 중 하나를 고릅니다(12장).
  - **동봉 (권장):** 연결 프로그램 설치 묶음에 버전을 고정한 Codex를 넣음. 설치가 한 번에 끝나고, `codex debug models`처럼 버전마다 바뀔 수 있는 부분을 시험한 버전으로 묶어 둘 수 있음. 대신 묶음이 큼
  - **따로 설치:** 사용자가 Codex를 직접 설치(npm·Homebrew 등)하면 연결 프로그램이 찾아 씀. 묶음은 작지만 설치 단계가 늘고 버전이 사용자마다 달라짐

### 확장 프로그램 배포에 생기는 변화

| 항목 | 바뀌는 점 | 영향 |
|---|---|---|
| 확장 zip | `manifest.json`에 `nativeMessaging` 권한과 `key`(확장 ID 고정)를 더함. 크기는 거의 그대로 | 설치 방법은 지금과 같음(압축 풀기 → 압축해제된 확장 프로그램 로드) |
| 확장 ID 고정 | `key`를 넣으면 ID가 설치 폴더와 상관없이 하나로 정해짐(연결 프로그램이 이 ID만 허락) | **이미 설치한 사용자는 ID가 바뀌어 새 확장으로 인식됩니다. 저장된 설정(API 키 등)이 비므로 한 번 다시 넣어야 합니다.** `key`를 넣는 릴리즈의 노트에 꼭 적음. 한 번 넣은 뒤로는 바뀌지 않음 |
| 권한 안내 | `nativeMessaging`이 더해지면 크롬이 "협력하는 네이티브 애플리케이션과 통신" 권한을 표시함 | 연결 프로그램이 없으면 아무 일도 하지 않음 |
| 릴리즈 | Actions가 `ongeul-v<버전>.zip`에 더해 연결 프로그램 묶음(Windows·macOS)을 만듦. 묶음은 연결 프로그램이 바뀔 때만 새로 내도 됨 | `release.yml`, `scripts/` 수정 필요. 확장과 연결 프로그램의 메시지 규약 버전(`hello`)을 맞춰, 맞지 않으면 "연결 프로그램을 업데이트하세요"라고 안내 |
| 웹스토어 | 지금은 쓰지 않음 | 나중에 올려도 `nativeMessaging`은 허용됨. 연결 프로그램은 스토어 밖에서 따로 설치 |

## 11. 진행 단계

1. **시험판 (이 Mac):** 연결 프로그램 최소판 + `hello`·`status`·`login`·`generate` + 페이지 요약 하나. 확인할 것: 응답 시간(요약·이미지 1장·이미지 4장), 사용량 한도, 끌 도구 기능 목록, 기기 코드 로그인 흐름
2. **기능 연결:** `chatgpt` 공급자, 설정 화면(연결 방식 고르기·로그인·로그아웃·상태·모델 목록), 요약·질문·상세 이미지·항목 설명. 자동 보완 분리 설정
3. **설치 묶음:** Windows·macOS 설치·제거 스크립트, 확장 ID 고정(`key`), 릴리즈 zip
4. **사용자 확인:** 스크린리더로 설치 → 로그인 → 요약까지 끝까지 해 보기(NVDA·센스리더·VoiceOver)

## 12. 정해야 할 것 (팀 검토)

- [ ] 연결 프로그램 설치를 사용자에게 요구해도 되는가 (지금은 확장 zip 하나만 설치)
- [ ] 시험 대상 계정의 요금제 (무료 계정의 Codex 사용 가능 여부와 한도 확인 필요)
- [ ] Codex CLI를 동봉할지(권장), 사용자가 따로 설치하게 할지 (10장)
- [ ] 요금제별 모델 목록이 실제로 걸러지는지 확인할 계정 (요금제가 다른 계정 둘 이상, 7장)
- [ ] 확장 ID 고정(`key`)을 언제 넣을지 (넣으면 기존 설치와 ID가 달라져 설정을 다시 해야 할 수 있음)
- [ ] 자동 보완을 ChatGPT로도 쓸 수 있게 할지, API 전용으로 둘지

## 13. 보안·개인정보

- 온글은 ChatGPT 비밀번호나 인증 토큰을 보지 않습니다. 로그인은 OpenAI 화면에서 하고, 인증 파일은 Codex가 온글 전용 폴더에 관리합니다.
- 연결 프로그램은 온글 확장(고정 ID)에서 온 요청만 받고, 네트워크로 열린 포트가 없습니다(크롬이 표준 입출력으로만 연결).
- 요약·질문·이미지 읽기를 하면 그 페이지 내용과 이미지가 사용자의 ChatGPT 계정으로 OpenAI에 전송됩니다. 지금 API 공급자와 같은 성격이며, 설정 화면과 사용 가이드에 이 점을 알립니다.
- `--ephemeral`로 Codex에 대화 기록을 남기지 않고, 임시 파일은 실행 직후 지웁니다.

## 14. 구현에서 정한 것

- **Codex CLI는 동봉하지 않음:** 묶음이 수백 MB가 되어, 사용자가 `npm install -g @openai/codex`로 설치하고 연결 프로그램 설치가 그 위치를 찾아 기록한다(`config.json`). 연결 프로그램은 Node.js로 돌아가므로 Node.js 20 이상도 필요하다.
- **설치:** `bridge/install.mjs` 하나가 Windows·macOS·Linux를 모두 처리하고, `install-windows.cmd` / `install.sh`가 Node를 찾아 이를 실행한다. 릴리즈에 `ongeul-bridge-<태그>.zip`으로 붙는다(`scripts/package-bridge.sh`).
- **확장 ID 고정:** `manifest.json`에 `key`를 넣어 ID가 `oaiehepelkgdbabadijehnmgogahkpab`로 정해졌다. 이 버전으로 처음 바꿀 때 설정을 한 번 다시 넣어야 한다.
- **로그인 창:** `codex login`이 기본 브라우저를 직접 연다. 온글은 같은 주소를 링크로도 보여 주고, 기기 코드는 한 글자씩 읽어 준다.
- **모델 목록:** `codex debug models`에서 `visibility: list`이고 그림을 받는 모델만 보여 준다. 로그인 전과 후의 목록이 달라서(이 Mac에서 확인) 계정에 따라 목록이 바뀌는 것은 맞다. 요금제별로 실제로 어떻게 달라지는지는 아직 요금제가 다른 계정으로 확인하지 않았다.
- **끄는 Codex 기능:** 명령 실행, 앱·플러그인, 브라우저·컴퓨터 사용, 그림 만들기, 하위 에이전트, 훅 등을 `--disable`로 끄고 웹 검색은 `web_search="disabled"`. 없는 기능 이름을 끄라고 하면 Codex가 실패하므로 `codex features list`에 있는 것만 끈다.
- **연결 방식은 토글 하나 (팀 결정):** 6장의 라디오 버튼과 "자동 보완은 API 키로 하기"는 쓰지 않는다. "ChatGPT 계정으로 연결" 토글을 켜면 자동 분석까지 모든 기능이 ChatGPT로만, 끄면 API 키로만 동작하고 둘을 섞지 않는다. 켜면 API 키 칸은 숨긴다.
- **줄 세우기:** 크롬은 연결마다 연결 프로그램을 새로 띄우므로 줄은 확장(서비스 워커)이 세운다. 사용자 요청과 자동 분석은 줄을 따로 써서 자동 분석이 요약·질문을 오래 붙잡지 않게 했다.
- **로그인 확인:** 로그인하지 않은 채 `codex exec`를 부르면 Codex가 십수 초 다시 시도하다 실패해서, 답을 만들기 전에 `codex login status`(0.1초 안팎)로 먼저 확인한다.
- **응답 시간:** 이 Mac에서 그림 한 장 짧은 설명이 약 4초(`codex exec` 한 번).
- **시험:** `bridge/test`(가짜 Codex로 연결 프로그램 전체 흐름, 설치·제거), `extension/test/providers.test.js`(ChatGPT 공급자·설정), `eval/e2e-chatgpt.mjs`(실제 Chromium + 연결 프로그램 + 가짜 Codex로 설정 화면 로그인부터 요약까지).
