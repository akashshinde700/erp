@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ForgeERP - Tally Voucher Importer

REM ============================================================================
REM  ForgeERP -> TallyPrime manual voucher importer (the human-approved write
REM  path). This script CREATES/ALTERS vouchers in the currently open Tally
REM  company. It is deliberately manual: you review the XML file, you run it.
REM
REM  Requirements: TallyPrime open, acting as Server or Both on port 9000
REM  (Gateway of Tally -> F1 Help -> Settings -> Connectivity ->
REM   Client/Server configuration -> "TallyPrime acts as": Both).
REM
REM  Re-running the same file is SAFE: every voucher carries REMOTEID, so
REM  Tally updates instead of duplicating.
REM ============================================================================

set "TALLY=http://127.0.0.1:9000"
set "CONFIG=%~dp0Tally-Import.config.txt"
if exist "%CONFIG%" (
  for /f "usebackq eol=# tokens=1,2 delims==" %%A in ("%CONFIG%") do (
    if /i "%%A"=="TALLY_URL" set "TALLY=%%B"
  )
)

set "XML=%~1"
if "%XML%"=="" (
  REM No file dropped on the script: pick the newest *_tally.xml in Downloads.
  set "PICKED="
  for /f "delims=" %%F in ('dir /b /o-d "%USERPROFILE%\Downloads\*_tally.xml" 2^>nul') do (
    if not defined PICKED set "PICKED=%USERPROFILE%\Downloads\%%F"
  )
  if not defined PICKED (
    echo [X] No file given and no *_tally.xml found in your Downloads folder.
    echo     Export a voucher from ForgeERP first, or drag-drop an XML file
    echo     onto this script.
    goto :fail
  )
  set "XML=!PICKED!"
)

if not exist "%XML%" (
  echo [X] File not found: %XML%
  goto :fail
)

echo ForgeERP -> Tally importer
echo   File : %XML%
echo   Tally: %TALLY%
echo.

set "RESP=%TEMP%\forge_tally_response.xml"

REM Primary: curl (ships with Windows 10 1803+)
where curl >nul 2>nul
if %errorlevel%==0 (
  curl -s -m 30 -X POST -H "Content-Type: application/xml" --data-binary "@%XML%" "%TALLY%" -o "%RESP%"
) else (
  REM Fallback: one-line PowerShell
  powershell -NoProfile -Command "[IO.File]::ReadAllBytes('%XML%') | %%{ $b=$_; (New-Object Net.WebClient).UploadData('%TALLY%','POST',$b) | Set-Content -Path '%RESP%' -Encoding UTF8 }"
)

if not exist "%RESP%" (
  echo [X] No response from Tally at %TALLY%.
  echo     Check: is TallyPrime open? Is "TallyPrime acts as" set to Both/Server
  echo     on port 9000? You can override the URL in Tally-Import.config.txt:
  echo       TALLY_URL=http://127.0.0.1:9000
  goto :fail
)

REM ---- Parse the CREATED / ALTERED / ERRORS / EXCEPTIONS counters ----
set "CREATED=-1" & set "ALTERED=-1" & set "ERRORS=-1" & set "EXCEPTIONS=-1"
for /f "tokens=2 delims=<>" %%A in ('findstr /c:"<CREATED>" "%RESP%"') do set "CREATED=%%A"
for /f "tokens=2 delims=<>" %%A in ('findstr /c:"<ALTERED>" "%RESP%"') do set "ALTERED=%%A"
for /f "tokens=2 delims=<>" %%A in ('findstr /c:"<ERRORS>" "%RESP%"') do set "ERRORS=%%A"
for /f "tokens=2 delims=<>" %%A in ('findstr /c:"<EXCEPTIONS>" "%RESP%"') do set "EXCEPTIONS=%%A"

if "%ERRORS%"=="-1" if "%CREATED%"=="-1" (
  echo [X] Tally answered, but not with an import result. Full response:
  echo.
  type "%RESP%"
  echo.
  echo Common causes:
  echo   - "Could not set SVCURRENTCOMPANY" : open the right company in Tally,
  echo     or set the Tally company name in ForgeERP (Tally Export screen).
  echo   - Tally is in a restricted/licence-limited mode.
  goto :fail
)

if not "%ERRORS%"=="0" goto :lineerrors
if not "%EXCEPTIONS%"=="0" goto :lineerrors

echo [OK] Import result: CREATED=%CREATED%  ALTERED=%ALTERED%  ERRORS=0
echo.
echo Check: Gateway of Tally -> Day Book -> press F2 and set the date range
echo to cover the voucher dates. Re-importing the same file only updates
echo (REMOTEID) - it never duplicates.
goto :done

:lineerrors
echo [X] Import had problems: ERRORS=%ERRORS%  EXCEPTIONS=%EXCEPTIONS%
echo.
echo ---- LINEERROR details ----
findstr /i /c:"<LINEERROR>" "%RESP%"
echo.
echo Cheat-sheet for the usual causes:
echo   "Ledger not found"            -> import the ForgeERP masters XML first
echo                                  (Tally Export screen -> Download masters)
echo   "Stock item not found"        -> create the item in Tally or import masters
echo   "Could not set SVCURRENTCOMPANY" -> open the right company in Tally
echo   "Voucher date is missing/earlier" -> Tally is in a restricted period; open
echo                                  the period or change the voucher date
goto :fail

:fail
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
