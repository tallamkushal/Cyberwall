@echo off
echo Reverting AI onboarding to original...
copy /Y "%~dp0onboarding.html.backup" "%~dp0onboarding.html"
copy /Y "%~dp0server.js.backup" "%~dp0server.js"
echo Done! Onboarding reverted to original.
pause
