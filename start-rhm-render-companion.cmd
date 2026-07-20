@echo off
cd /d "%~dp0"
title RHM Render Companion
echo Starting the RHM Studios 1080p video renderer...
echo Keep this window open while a video is rendering.
echo.
set NODE_USE_SYSTEM_CA=1
npm.cmd run render:worker
echo.
echo The render companion stopped. Press any key to close this window.
pause >nul
