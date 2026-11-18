@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Creation des raccourcis "Analyse Actions"...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $dir = (Get-Location).Path; foreach ($p in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $l = $ws.CreateShortcut((Join-Path $p 'Analyse Actions.lnk')); $l.TargetPath = (Join-Path $dir 'lancer.bat'); $l.WorkingDirectory = $dir; $l.IconLocation = (Join-Path $dir 'static\icon.ico') + ',0'; $l.WindowStyle = 7; $l.Description = 'Analyse Actions (mise a jour automatique au lancement)'; $l.Save(); Write-Host ('  OK : ' + $l.FullName) }"
echo.
echo Les raccourcis sont sur le Bureau et dans le menu Demarrer (tape "Analyse" dans la recherche).
echo Pour l'epingler : clic droit sur le raccourci, puis "Epingler a l'ecran de demarrage" ou "a la barre des taches".
pause
