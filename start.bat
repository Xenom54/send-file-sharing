@echo off
title Send Server
cd /d "%~dp0"
set PORT=3000
node server.js
pause
