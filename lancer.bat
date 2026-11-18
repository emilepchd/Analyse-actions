@echo off
chcp 65001 >nul
title Analyse Actions
cd /d "%~dp0"

rem Lenvironnement Python est installe hors du dossier (evite la synchronisation OneDrive)
set "VENV=%LOCALAPPDATA%\AnalyseActions\venv"

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY (
  echo.
  echo Python nest pas installe. Installe-le depuis https://www.python.org/downloads/
  echo en cochant la case "Add python.exe to PATH", puis relance ce fichier.
  pause
  exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
  echo Premiere installation : creation de lenvironnement Python...
  %PY% -m venv "%VENV%" || ( echo Echec de creation de lenvironnement & pause & exit /b 1 )
)

echo Verification des dependances...
"%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q --upgrade -r requirements.txt
if errorlevel 1 ( echo Echec de linstallation des dependances. Verifie ta connexion internet. & pause & exit /b 1 )

"%VENV%\Scripts\python.exe" server.py
pause
