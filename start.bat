@echo off
echo Starting CyberWall...

:: Load ANTHROPIC_API_KEY from User environment variables
for /f "tokens=*" %%a in ('powershell -Command "[System.Environment]::GetEnvironmentVariable(\"ANTHROPIC_API_KEY\", \"User\")"') do (
    set ANTHROPIC_API_KEY=%%a
)

:: Load SUPABASE_SERVICE_KEY from User environment variables
for /f "tokens=*" %%a in ('powershell -Command "[System.Environment]::GetEnvironmentVariable(\"SUPABASE_SERVICE_KEY\", \"User\")"') do (
    set SUPABASE_SERVICE_KEY=%%a
)

if "%ANTHROPIC_API_KEY%"=="" (
    echo ERROR: ANTHROPIC_API_KEY is not set. AI assistant will not work.
    echo Please set it in System Environment Variables.
    pause
    exit /b 1
)

:: Kill any existing process on port 3001
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Start the server in background with the API key
start "" /B node "%~dp0server.js"

:: Wait for server to start
timeout /t 2 /nobreak >nul

:: Open cyberwall in browser
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "http://localhost:3001"

echo CyberWall is running! AI assistant is active.
