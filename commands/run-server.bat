@echo off
rem --------------------------------------------------------------------
rem Introductions to Batch Files: https://www.trytoprogram.com/batch-file/
rem Coding Standards: https://wiki.c2.com/?BatFileCodingStandard`
rem --------------------------------------------------------------------
rem Related Issue with "sets" and "ifs": https://superuser.com/questions/78496/variables-in-batch-file-not-being-set-when-inside-if
setlocal enabledelayedexpansion

if not exist "%scriptdir%" (
    set "scriptdir=%~dp0"A
    if not "!scriptdir:~-1!"=="\" (
        set "scriptdir=!scriptdir!\"
    )
    cd ".."
)
set "scriptdir=!scriptdir!..\"

rem Debug
rem echo "[Server Run] Active Path: " %scriptdir%

rem 1. Server Setup
call :start_server

rem Nothing else to do here, thus exit.
rem --------------------------------------------------------------------
:start_server
echo Starting server... (Development Mode)
REM Running this command (One step up, directory-wise), because Node.JS will tally all dependencies
REM against the active directory of where the command is currently at.
REM In this case, after "..", it's changed from "%PROJECT_DIRECTORY%/commands" to just "%PROJECT_DIRECTORY%".
node --watch "%scriptdir%/src/index.js"

echo Server Setup Complete.

exit /b
rem --------------------------------------------------------------------