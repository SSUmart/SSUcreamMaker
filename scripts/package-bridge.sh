#!/usr/bin/env bash
# 온글 연결 프로그램(ChatGPT 로그인용)을 배포용 zip으로 묶는다. 확장 zip과 따로 받는다.
#   scripts/package-bridge.sh v26.3.0-beta.1   → dist/ongeul-bridge-v26.3.0-beta.1.zip
#   scripts/package-bridge.sh                  → dist/ongeul-bridge-<커밋>.zip
# zip 안의 ongeul-bridge 폴더를 풀어 install-windows.cmd(Windows) 또는 sh install.sh(macOS·Linux)로 설치한다.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-}"
name="ongeul-bridge-${tag:-$(git -C "$root" rev-parse --short HEAD)}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/ongeul-bridge"
# 테스트 코드와 숨김 파일은 넣지 않는다. 실행 권한(install.sh 등)은 zip에 그대로 남는다
rsync -a --exclude 'test/' --exclude '.*' "$root/bridge/" "$work/ongeul-bridge/"
cat > "$work/ongeul-bridge/README.txt" <<'TXT'
온글 연결 프로그램 (ChatGPT 계정으로 온글 AI 쓰기)

미리 설치할 것
  1. Node.js 20 이상 (https://nodejs.org 의 LTS)
  2. OpenAI Codex CLI: 터미널(명령 프롬프트)에서  npm install -g @openai/codex

설치
  Windows: install-windows.cmd 를 두 번 눌러 실행
  macOS·Linux: 터미널에서 이 폴더로 이동한 뒤  sh install.sh

설치 뒤
  브라우저를 완전히 껐다 켜고, 온글 설정에서 "ChatGPT 계정으로 연결"을 켠 뒤
  "ChatGPT 로그인" 또는 "기기 코드로 로그인"을 누릅니다.

제거
  Windows: uninstall-windows.cmd,  macOS·Linux: sh uninstall.sh
  (ChatGPT 로그인 정보도 함께 지웁니다)

자세한 안내: https://github.com/SSUmart/SSUcreamMaker/blob/main/docs/CHATGPT-LOGIN.md
TXT

mkdir -p "$root/dist"
zip_path="$root/dist/$name.zip"
rm -f "$zip_path"
(cd "$work" && zip -qr -X "$zip_path" ongeul-bridge)
echo "$zip_path"
