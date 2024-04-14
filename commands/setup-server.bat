@echo off
rem --------------------------------------------------------------------
rem Introductions to Batch Files: https://www.trytoprogram.com/batch-file/
rem Coding Standards: https://wiki.c2.com/?BatFileCodingStandard`
rem --------------------------------------------------------------------
REM Save Active Directory from which this batch file is stored.
set "scriptdir=%~dp0"
if not "%scriptdir:~-1%"=="\" SET "scriptdir=%scriptdir%\"

REM Running this command (One step up, directory-wise), because Node.JS will tally all dependencies
REM against the active directory of where the command is currently at.
REM In this case, after "..", it's changed from "%PROJECT_DIRECTORY%/commands" to just "%PROJECT_DIRECTORY%".
cd ".."

echo "[Server Setup] Active Path: %CD%"

rem 1. Tailwind Setup
call :install_tailwind

echo Tailwind Build Completed.

rem 2. Server Setup
call "%scriptdir%/run-server.bat"

rem Nothing else to do here, thus exit.
rem --------------------------------------------------------------------
:install_tailwind
echo Setting up Tailwind CSS Build.

rem Read up on issues on why "npx" without "CALL" command would not work.
rem https://stackoverflow.com/questions/76773270/why-does-npx-end-batch-script
call npx tailwindcss -i "./tailwind/input.css" -o "./public//css/index-tailwind.css"

rem ALTERNATIVE: goto :eof
exit /b
rem --------------------------------------------------------------------