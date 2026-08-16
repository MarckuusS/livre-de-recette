@echo off
setlocal enabledelayedexpansion

rem ===========================================================================
rem Console d'administration des comptes.
rem
rem Elle tourne SUR CETTE MACHINE et n'est jamais deployee. Elle emprunte
rem l'authentification que wrangler detient deja : le site en ligne ne gagne
rem aucune route privilegiee, et il n'existe aucun compte administrateur a
rem proteger. Voir l'en-tete de scripts\admin\serveur.mjs.
rem
rem Ctrl+C dans cette fenetre arrete la console.
rem ===========================================================================

cd /d "%~dp0"

set "PORT=8790"
set "CIBLE=http://127.0.0.1:%PORT%"

rem ---- 1. Node -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto err_no_node

rem ---- 2. Dependances ----------------------------------------------------
rem Seul wrangler est necessaire, mais il vit dans node_modules comme le reste.
if exist "node_modules\" goto authentification
echo [1/4] Installation des dependances (premiere fois, quelques minutes)...
call npm install
if errorlevel 1 goto err_install

:authentification
rem ---- 3. L'authentification Cloudflare ----------------------------------
rem
rem ON LA VERIFIE AVANT D'OUVRIR LA CONSOLE. Sans elle, l'ecran s'ouvre, se
rem remplit d'une erreur brute de wrangler, et rien ne dit qu'il suffisait de
rem se connecter. Le message ci-dessous le dit.
echo [2/4] Verification de l'acces Cloudflare...
call npx wrangler whoami >nul 2>nul
if errorlevel 1 goto err_auth

rem ---- 4. Le port, libere avant tout -------------------------------------
rem Meme raison que dans mobile.bat : une console d'un lancement precedent
rem repondrait a la place de la nouvelle, et afficherait l'etat d'il y a une
rem heure sans que rien ne le signale.
set "LIBERE="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:":%PORT% "') do (
  echo       Une console tenait deja le port %PORT% ^(PID %%p^) : arret.
  taskkill /PID %%p /T /F >nul 2>nul
  set "LIBERE=1"
)
if defined LIBERE "%SystemRoot%\System32\ping.exe" -n 3 127.0.0.1 >nul

rem ---- 5. Le navigateur, puis le serveur ---------------------------------
echo [3/4] Ouverture du navigateur...
start "" "%CIBLE%"

echo [4/4] Demarrage de la console sur %CIBLE% ...
echo.
echo ==========================================================================
echo  La console s'ouvre sur la BASE DE DEVELOPPEMENT.
echo.
echo  Bascule sur « Production » en haut a droite pour agir sur les vrais
echo  comptes. Le bandeau rouge est la pour qu'on ne s'y trompe pas.
echo.
echo  Ctrl+C ici arrete la console.
echo ==========================================================================
echo.

node scripts\admin\serveur.mjs
if errorlevel 1 goto err_serveur
goto end

rem ---- Erreurs, toujours expliquees --------------------------------------
:err_no_node
echo.
echo [erreur] Node introuvable. Installe Node 22 ou plus depuis https://nodejs.org/
goto fail

:err_install
echo.
echo [erreur] L'installation des dependances a echoue.
echo          Verifie ta connexion internet.
goto fail

:err_auth
echo.
echo [erreur] Wrangler n'est pas authentifie sur Cloudflare.
echo          Cette console n'a pas de secret a elle : elle emprunte le tien.
echo          Connecte-toi puis relance :
echo             npx wrangler login
goto fail

:err_serveur
echo.
echo [erreur] La console s'est arretee. Lis les messages au-dessus.
goto fail

:fail
pause
endlocal
exit /b 1

:end
endlocal
