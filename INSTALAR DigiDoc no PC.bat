@echo off
setlocal
title Instalar DigiDoc no PC
cd /d "%~dp0"

echo ==========================================
echo         INSTALAR DIGIDOC NESTE PC
echo ==========================================
echo.

set "ZIP=%~dp0DigiDoc-instalar.zip"
if not exist "%ZIP%" (
  echo [ERRO] Nao achei o DigiDoc-instalar.zip nesta pasta.
  echo Rode este instalador de dentro do pendrive.
  echo.
  pause
  exit /b 1
)

set "DEST=%USERPROFILE%\DigiDoc"
echo Onde instalar o DigiDoc?
echo   Padrao: %DEST%
echo.
set "ESCOLHA="
set /p "ESCOLHA=Aperte ENTER para usar o padrao, ou digite outra pasta: "
if not "%ESCOLHA%"=="" set "DEST=%ESCOLHA%"
set "DEST=%DEST:"=%"
if "%DEST:~-1%"=="\" set "DEST=%DEST:~0,-1%"
rem sempre instala numa pasta propria chamada DigiDoc (nunca mistura com seus arquivos)
for %%I in ("%DEST%") do set "ULTIMA=%%~nxI"
if /i not "%ULTIMA%"=="DigiDoc" set "DEST=%DEST%\DigiDoc"

rem so mexe no DigiDoc que roda DESTA pasta (o do pendrive pode continuar aberto)
powershell -NoProfile -Command "$d=$env:DEST.TrimEnd('\')+'\'; if (@(Get-Process DigiDoc -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) }).Count) { exit 1 }"
if errorlevel 1 (
  echo.
  echo O DigiDoc instalado nesta pasta esta aberto. Salve o que estiver fazendo e feche ele.
  echo Depois aperte uma tecla para continuar...
  pause >nul
  powershell -NoProfile -Command "$d=$env:DEST.TrimEnd('\')+'\'; Get-Process DigiDoc -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force"
  ping -n 3 127.0.0.1 >nul
)

echo.
echo Instalando em: %DEST%
if not exist "%DEST%" mkdir "%DEST%"
echo Copiando do pendrive... pode levar alguns minutos, nao feche esta janela.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:ZIP); try { $n=0; $t=$z.Entries.Count; foreach($e in $z.Entries){ $n++; $alvo=[IO.Path]::Combine($env:DEST, $e.FullName.Replace('/','\')); if([string]::IsNullOrEmpty($e.Name)){ [void][IO.Directory]::CreateDirectory($alvo); continue }; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($alvo)); [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $alvo, $true); if(($n %% 40) -eq 0){ Write-Host ('   {0} de {1} arquivos' -f $n,$t) } } } finally { $z.Dispose() }"
if errorlevel 1 (
  echo.
  echo [ERRO] Nao consegui copiar o programa. Veja se o pendrive continua conectado.
  echo.
  pause
  exit /b 1
)
if not exist "%DEST%\DigiDoc.exe" (
  echo.
  echo [ERRO] A copia terminou mas o DigiDoc.exe nao apareceu em %DEST%.
  echo.
  pause
  exit /b 1
)
rem marca de instalacao: o "Desinstalar" de dentro do app so remove pastas que tem esta marca
> "%DEST%\digidoc-instalado.txt" echo Instalado pelo INSTALAR DigiDoc no PC.bat - nao apague (o desinstalador do app usa este arquivo).

echo Criando atalho na area de trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\DigiDoc.lnk'); $s.TargetPath=$env:DEST+'\DigiDoc.exe'; $s.WorkingDirectory=$env:DEST; $s.IconLocation=$env:DEST+'\DigiDoc.exe,0'; $s.Description='DigiDoc'; $s.Save()" >nul 2>&1

echo.
echo ==========================================
echo  PRONTO! DigiDoc instalado em:
echo    %DEST%
echo  Atalho criado na area de trabalho (DigiDoc).
echo.
echo  Instalado no PC ele abre bem mais rapido do que pelo pendrive.
echo.
echo  Para escolher onde SALVAR os documentos:
echo    DigiDoc - Configuracoes - Onde salvar.
echo  Para remover no fim do dia:
echo    DigiDoc - Configuracoes - Desinstalar.
echo ==========================================
echo.
pause
