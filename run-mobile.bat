@echo off
title PW Exam Shield - Mobile CBT Suite
cd /d "%~dp0"
echo ========================================================================
echo   PW Exam Shield - Native Mobile CBT Test Series
echo   FLAG_SECURE Anti-Screenshot Protected Mobile Application
echo ========================================================================
echo.
echo Starting Mobile Server...
start "" "http://localhost:3001"
node server.js
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Mobile server exited with error code %ERRORLEVEL%
  pause
)
