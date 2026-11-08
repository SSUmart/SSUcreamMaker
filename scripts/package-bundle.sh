#!/usr/bin/env bash
# 운영체제별 통합 zip: 온글 확장 + 연결 프로그램 + Node.js + OpenAI Codex CLI (ChatGPT 계정으로 쓸 때 이 파일 하나만 받으면 됨)
#   scripts/package-bundle.sh v26.3.0-beta.2 windows-x64   → dist/ongeul-v26.3.0-beta.2-windows-x64.zip
#   대상: windows-x64, macos-arm64(애플 실리콘 Mac. 인텔 Mac은 지원하지 않음)
# 확장 zip(scripts/package-extension.sh)을 먼저 만든 뒤 실행한다. 버전은 bridge/runtime.json.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-}"
target="${2:?대상(windows-x64, macos-arm64)을 주세요}"
label="${tag:-$(git -C "$root" rev-parse --short HEAD)}"
ext_zip="$root/dist/ongeul-$label.zip"
[ -f "$ext_zip" ] || { echo "확장 zip이 없습니다: $ext_zip (scripts/package-extension.sh 먼저)" >&2; exit 1; }

node_version="$(node -p "require('$root/bridge/runtime.json').node")"
codex_version="$(node -p "require('$root/bridge/runtime.json').codex")"
case "$target" in
  windows-x64) node_dist="win-x64"; node_archive="node-v$node_version-win-x64.zip"; codex_pkg="win32-x64"; triple="x86_64-pc-windows-msvc" ;;
  macos-arm64) node_dist="darwin-arm64"; node_archive="node-v$node_version-darwin-arm64.tar.gz"; codex_pkg="darwin-arm64"; triple="aarch64-apple-darwin" ;;
  *) echo "모르는 대상: $target" >&2; exit 1 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
top="$work/ongeul"
mkdir -p "$top/extension" "$top/bridge/runtime/node" "$top/bridge/runtime/codex"

# 1) 확장 (버전이 들어간 배포용 그대로)
unzip -q "$ext_zip" -d "$top/extension"

# 2) 연결 프로그램 (테스트·숨김 파일 제외)
rsync -a --exclude 'test/' --exclude '.*' "$root/bridge/" "$top/bridge/"

# 3) Node.js: 공식 배포본을 받아 SHA-256을 확인하고 실행 파일만 담는다
base="https://nodejs.org/dist/v$node_version"
curl -fsSL "$base/$node_archive" -o "$work/$node_archive"
curl -fsSL "$base/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
(cd "$work" && grep " $node_archive\$" SHASUMS256.txt | sha256 -c - >/dev/null) || { echo "Node.js 파일 확인 실패" >&2; exit 1; }
mkdir "$work/node-x"
if [[ "$node_archive" == *.zip ]]; then
  unzip -q "$work/$node_archive" -d "$work/node-x"
  cp "$work/node-x/node-v$node_version-$node_dist/node.exe" "$top/bridge/runtime/node/"
else
  tar -xzf "$work/$node_archive" -C "$work/node-x"
  cp "$work/node-x/node-v$node_version-$node_dist/bin/node" "$top/bridge/runtime/node/"
fi
cp "$work/node-x/node-v$node_version-$node_dist/LICENSE" "$top/bridge/runtime/node/LICENSE"

# 4) Codex CLI: npm 공식 패키지(무결성은 npm이 확인)에서 이 운영체제용 실행 파일 폴더만 담는다
(cd "$work" && npm pack "@openai/codex@$codex_version-$codex_pkg" --silent >/dev/null && mkdir codex-x && tar -xzf openai-codex-*.tgz -C codex-x)
cp -R "$work/codex-x/package/vendor/$triple/." "$top/bridge/runtime/codex/"
cp "$work/codex-x/package/package.json" "$top/bridge/runtime/codex/npm-package.json"

# 5) 맨 위 설치 파일과 안내
if [[ "$target" == windows-* ]]; then
  printf '@echo off\r\nrem 온글 설치 (ChatGPT 계정 연결 포함). 두 번 눌러 실행\r\ncall "%%~dp0bridge\\install-windows.cmd" %%*\r\n' > "$top/install-windows.cmd"
  printf '@echo off\r\nrem 온글 연결 프로그램 제거\r\ncall "%%~dp0bridge\\uninstall-windows.cmd" %%*\r\n' > "$top/uninstall-windows.cmd"
  run_line="install-windows.cmd 를 두 번 눌러 실행합니다."
  remove_line="uninstall-windows.cmd"
else
  printf '#!/bin/sh\n# 온글 설치 (ChatGPT 계정 연결 포함). Finder에서 두 번 누르거나 터미널에서 sh install.sh\nsh "$(dirname "$0")/bridge/install.sh" "$@"\n' > "$top/install.sh"
  printf '#!/bin/sh\nsh "$(dirname "$0")/install.sh"\necho\necho "이 창은 닫아도 됩니다."\n' > "$top/install-macos.command"
  printf '#!/bin/sh\nsh "$(dirname "$0")/bridge/install.sh" --uninstall\n' > "$top/uninstall.sh"
  chmod +x "$top/install.sh" "$top/install-macos.command" "$top/uninstall.sh" "$top/bridge/runtime/node/node" "$top/bridge/runtime/codex/bin/"*
  run_line="터미널에서 이 폴더로 이동해  sh install.sh  를 실행합니다. (Finder에서 install-macos.command를 열어도 됩니다. 막히면 Control 키를 누른 채 클릭해 '열기')"
  remove_line="sh uninstall.sh"
fi
cat > "$top/README.txt" <<TXT
온글 $label ($target)  -  ChatGPT 계정 연결 포함

1. 이 폴더를 지우지 않을 곳(예: 문서 폴더)에 둡니다. extension 폴더를 브라우저가 계속 씁니다.
2. 설치: $run_line
   연결 프로그램, Node.js $node_version, OpenAI Codex CLI $codex_version 을 이 컴퓨터 사용자 폴더에 설치하고 브라우저에 등록합니다.
   관리자 권한은 필요 없습니다. 끝나면 extension 폴더 경로를 클립보드에 복사해 둡니다.
3. 브라우저를 완전히 껐다 켭니다.
4. chrome://extensions 에서 개발자 모드를 켜고 "압축해제된 확장 프로그램을 로드합니다"로 이 폴더의 extension 폴더를 고릅니다.
   (폴더 고르는 창의 주소 칸에 붙여넣기 하면 됩니다.) 이미 설치돼 있으면 새로고침만 누릅니다.
5. 온글 설정에서 AI 기능 켜기와 "ChatGPT 계정으로 연결"을 켜고 "ChatGPT 로그인 (브라우저)"를 누릅니다.

API 키로만 쓸 때는 설치(2)를 하지 않고 4부터 하면 됩니다.
제거: $remove_line  (ChatGPT 로그인 정보도 지웁니다)
자세한 안내: https://github.com/SSUmart/SSUcreamMaker/blob/main/docs/CHATGPT-LOGIN.md
TXT
cp "$root/bridge/runtime.json" "$top/bridge/runtime/versions.json"

mkdir -p "$root/dist"
zip_path="$root/dist/ongeul-$label-$target.zip"
rm -f "$zip_path"
(cd "$work" && zip -qr -X -y "$zip_path" ongeul)
echo "$zip_path ($(du -h "$zip_path" | cut -f1))"
