#!/bin/sh
# 온글 연결 프로그램 설치 (macOS, Linux). 제거: sh install.sh --uninstall
# 통합 zip에는 Node.js와 Codex CLI가 들어 있습니다. 연결 프로그램만 받았다면 Node.js 20 이상과 OpenAI Codex CLI가 필요합니다. 안내: docs/CHATGPT-LOGIN.md
cd "$(dirname "$0")" || exit 1
# 통합 zip이면 함께 담긴 Node.js를 쓴다 (macOS는 인터넷에서 받은 파일 표시를 먼저 지운다)
if [ -f runtime/node/node ]; then
  [ "$(uname)" = Darwin ] && xattr -dr com.apple.quarantine runtime 2>/dev/null
  chmod +x runtime/node/node runtime/codex/bin/* 2>/dev/null
  exec runtime/node/node install.mjs "$@"
fi
node=$(command -v node)
for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
  [ -n "$node" ] && break
  [ -x "$candidate" ] && node=$candidate
done
if [ -z "$node" ]; then
  echo "Node.js를 찾지 못했습니다. https://nodejs.org 에서 Node.js 20 이상(LTS)을 설치한 뒤 다시 실행하세요."
  exit 1
fi
exec "$node" install.mjs "$@"
