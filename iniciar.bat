@echo off
title Digitalizador
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando as dependencias pela primeira vez, aguarde...
  call npm install
)
npx electron .
