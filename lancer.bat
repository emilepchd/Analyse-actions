@echo off
chcp 65001 >nul
title Analyse Actions
cd /d "%~dp0"
rem Mise a jour automatique depuis GitHub (ce fichier peut lui-meme etre mis a jour pendant qu'il tourne)
where git >nul 2>&1
if not errorlevel 1 if exist ".git" (
  echo Recherche de mises a jour...
  git pull --ff-only -q >nul 2>&1
  if errorlevel 1 ( echo Mise a jour impossible pour l'instant, lancement de la version actuelle. ) else ( echo Application a jour. )
)
rem ==== NE RIEN MODIFIER AU-DESSUS DE CETTE LIGNE : Windows reprend la lecture du fichier a cet endroit apres la mise a jour ====

rem L'environnement Python est installe hors du dossier (evite la synchronisation OneDrive)
set "VENV=%LOCALAPPDATA%\AnalyseActions\venv"

rem 2. Python
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY ( where python >nul 2>&1 && set "PY=python" )
if not defined PY (
  echo.
  echo Python n'est pas installe. Installe-le depuis https://www.python.org/downloads/
  echo en cochant la case "Add python.exe to PATH", puis relance ce fichier.
  pause
  exit /b 1
)

set "FIRST="
if not exist "%VENV%\Scripts\python.exe" (
  echo Premiere installation : creation de l'environnement Python...
  %PY% -m venv "%VENV%" || ( echo Echec de creation de l'environnement & pause & exit /b 1 )
  set "FIRST=1"
)

rem 3. Dependances : mises a jour une fois par jour, ou quand la liste change
set "TODAY=%DATE%"
set "LAST="
if exist "%VENV%\last_update.txt" set /p LAST=<"%VENV%\last_update.txt"
fc /b requirements.txt "%VENV%\req.txt" >nul 2>&1 || set "LAST="
if not "%LAST%"=="%TODAY%" (
  echo Mise a jour des dependances...
  "%VENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q --upgrade -r requirements.txt
  if errorlevel 1 (
    if defined FIRST ( echo Echec de l'installation des dependances. Verifie ta connexion internet. & pause & exit /b 1 )
    echo Dependances non mises a jour, hors ligne ? Lancement quand meme.
  ) else (
    (echo %TODAY%)>"%VENV%\last_update.txt"
    copy /y requirements.txt "%VENV%\req.txt" >nul
  )
)

rem 4. Lancement (si l'application est deja ouverte, le navigateur s'ouvre simplement dessus)
"%VENV%\Scripts\python.exe" server.py
if errorlevel 1 pause
