@echo off
setlocal EnableDelayedExpansion
title Desinstalar DigiDoc
echo ==========================================
echo       REMOVER O DIGIDOC DESTE PC
echo ==========================================
echo.
echo Remove SO os arquivos do programa. Seus PDFs NAO somem:
echo a pasta dos documentos fica exatamente onde esta.
echo (Da pra fazer isso tambem dentro do app: Configuracoes - Desinstalar.)
echo.

set "DEST=%USERPROFILE%\DigiDoc"
echo Pasta do programa: !DEST!
set "ESCOLHA="
set /p "ESCOLHA=Se instalou em outro lugar, digite a pasta (ou ENTER): "
if not "!ESCOLHA!"=="" set "DEST=!ESCOLHA!"
set "DEST=!DEST:"=!"
if "!DEST:~-1!"=="\" set "DEST=!DEST:~0,-1!"

if not exist "!DEST!\DigiDoc.exe" (
  echo.
  echo Nao encontrei o DigiDoc instalado em !DEST!.
  echo Se voce usa direto do pendrive, nao precisa desinstalar nada.
  echo.
  pause
  exit /b 0
)

rem seguranca: nunca remove a copia do pendrive (o instalador fica do lado dela)
for %%P in ("!DEST!\..") do set "PAI=%%~fP"
if exist "!PAI!\DigiDoc-instalar.zip" goto ehpendrive
if exist "!PAI!\INSTALAR DigiDoc no PC.bat" goto ehpendrive
set "TIPO="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "(Get-CimInstance Win32_LogicalDisk -Filter ('DeviceID=''' + $env:DEST.Substring(0,2) + '''')).DriveType"`) do set "TIPO=%%T"
if "!TIPO!"=="2" goto ehpendrive
rem na duvida nao remove: tem que ser disco do PC ou ter a marca do instalador
if not "!TIPO!"=="3" if not exist "!DEST!\digidoc-instalado.txt" (
  echo.
  echo Nao consegui confirmar que essa pasta e uma instalacao neste PC.
  echo Por seguranca nao removi nada.
  echo.
  pause
  exit /b 1
)

echo.
echo Aperte uma tecla para remover (ou feche para cancelar)...
pause >nul
rem so fecha o DigiDoc que roda DESTA pasta (o do pendrive pode continuar aberto)
powershell -NoProfile -Command "$d=$env:DEST.TrimEnd('\')+'\'; Get-Process DigiDoc -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force" >nul 2>&1
ping -n 3 127.0.0.1 >nul

cd /d "!DEST!" || exit /b 1
if exist "digidoc-arquivos.txt" (
  for /f "usebackq delims=" %%L in ("digidoc-arquivos.txt") do (
    set "L=%%L"
    if "!L:~-1!"=="\" (
      rmdir "!L:~0,-1!" >nul 2>&1
    ) else (
      if exist "%%L" del /f /q "%%L" >nul 2>&1
    )
  )
  del /f /q "digidoc-arquivos.txt" >nul 2>&1
) else (
  rem instalacao antiga (exe unico)
  if exist "DigiDoc.exe" del /f /q "DigiDoc.exe" >nul 2>&1
)
if exist "digidoc-instalado.txt" del /f /q "digidoc-instalado.txt" >nul 2>&1
if exist "naps2" rmdir /s /q "naps2" >nul 2>&1
if exist "digitalizador-config.json" del /f /q "digitalizador-config.json" >nul 2>&1

set "DESK="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESK=%%D"
if defined DESK if exist "!DESK!\DigiDoc.lnk" del /f /q "!DESK!\DigiDoc.lnk" >nul 2>&1
rem atalho do Menu Iniciar e registro em Aplicativos (criados pelo DigiDoc-Setup.exe): so se forem DESTA pasta
powershell -NoProfile -Command "$k='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DigiDoc'; $l=(Get-ItemProperty $k -ErrorAction SilentlyContinue).InstallLocation; if ($l -and ($l.TrimEnd('\') -ieq $env:DEST.TrimEnd('\'))) { Remove-Item $k -Force; $m=Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DigiDoc.lnk'; if (Test-Path $m) { Remove-Item $m -Force } }" >nul 2>&1
rem dados do app no perfil do Windows. Nunca se for a propria pasta do programa (ali podem
rem estar os PDFs, na pasta Digitalizado)
for %%A in ("!DEST!") do set "DESTF=%%~fA"
for %%A in ("%APPDATA%\DigiDoc") do set "UDF=%%~fA"
if /i not "!DESTF!"=="!UDF!" if not exist "%APPDATA%\DigiDoc\Digitalizado" if exist "%APPDATA%\DigiDoc" rmdir /s /q "%APPDATA%\DigiDoc" >nul 2>&1
rem dados locais do motor do scanner: so a subpasta dele; a de cima so sai se ficar vazia
if defined LOCALAPPDATA if exist "%LOCALAPPDATA%\DigiDoc\naps2-dados" rmdir /s /q "%LOCALAPPDATA%\DigiDoc\naps2-dados" >nul 2>&1
if defined LOCALAPPDATA rmdir "%LOCALAPPDATA%\DigiDoc" >nul 2>&1

cd /d "%TEMP%"
rmdir "!DEST!" >nul 2>&1

echo.
echo ==========================================
echo  PRONTO - Programa removido deste PC.
if exist "!DEST!" (
  echo.
  echo  O que sobrou em !DEST! sao arquivos seus
  echo  ^(por exemplo a pasta Digitalizado com os PDFs^).
)
echo ==========================================
echo.
pause
exit /b 0

:ehpendrive
echo.
echo Essa pasta fica num PENDRIVE. O desinstalador so remove do PC.
echo.
pause
exit /b 0
