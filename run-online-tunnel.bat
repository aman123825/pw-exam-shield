@echo off
title PW Exam Shield - Global Online Tunnel (Multi-City Access)
cls
echo ========================================================================
echo   PW Exam Shield - Global Online Tunnel (Multi-City Student Access)
echo ========================================================================
echo.
echo 1. Starting Local CBT Streaming Server on Port 3001...
start "PW CBT Server" /min node server.js
timeout /t 2 >nul

echo.
echo 2. Establishing Cloudflare Secure Global HTTPS Tunnel...
echo ------------------------------------------------------------------------
echo An Internet HTTPS link (e.g. https://xxxx.trycloudflare.com) will appear below.
echo.
echo Students in ANY city (Delhi, Mumbai, Kota, Patna, etc.) on Jio, Airtel,
echo 4G/5G or Wi-Fi can connect directly to your laptop using this link!
echo ========================================================================
echo.
cloudflared.exe tunnel --url http://localhost:3001
pause
