@echo off
rem  Starts the AI-agent notification watcher (hidden, detached).
rem  It pops a Windows toast whenever the agent finishes a task
rem  or needs your approval.
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-notify.ps1" -Watch
