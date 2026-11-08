@echo off
chcp 65001 >nul
rem 온글 연결 프로그램 제거 (Windows)
cd /d "%~dp0"
node install.mjs --uninstall
echo.
pause
