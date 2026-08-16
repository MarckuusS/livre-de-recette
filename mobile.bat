@echo off
setlocal enabledelayedexpansion

rem ===========================================================================
rem Ouvre l'application web en TELEPHONE, sur cette machine.
rem
rem Construit le site, applique les migrations locales, demarre le serveur, et
rem ouvre un navigateur reglé en iPhone avec l'ecran tactile ACTIF : le glisser,
rem le balayage et les cibles au doigt se comportent comme sur un telephone,
rem pas seulement la mise en page.
rem
rem Idempotent : relancable autant de fois qu'on veut. Ctrl+C dans la fenetre du
rem serveur arrete tout.
rem ===========================================================================

cd /d "%~dp0"

rem ---- Les reglages, tous au meme endroit --------------------------------
set "PORT=8788"
set "CDP_PORT=9222"
set "CIBLE=http://localhost:%PORT%"

rem L'ETAT LOCAL VIT HORS DU PROJET, et ce n'est pas un gout de rangement.
rem Le chemin de ce depot contient une espace et un signe plus ; miniflare, qui
rem simule D1 et R2, n'arrive pas a y ouvrir ses fichiers SQLite et s'arrete sur
rem un SQLITE_CANTOPEN sans expliquer pourquoi. On l'installe donc ailleurs.
rem Pas dans %TEMP% non plus : Windows y fait le menage, et la base de
rem developpement disparaitrait sans prevenir.
set "ETAT=%LOCALAPPDATA%\Prandia\dev-state"

rem ---- 1. Node -----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto err_no_node

rem ---- 2. Dependances ----------------------------------------------------
if exist "node_modules\" goto build
echo [1/5] Installation des dependances (premiere fois, quelques minutes)...
call npm install
if errorlevel 1 goto err_install

:build
rem ---- 3. Construction du site ------------------------------------------
rem `wrangler pages dev` sert le DOSSIER CONSTRUIT, pas les sources : sans
rem cette etape, on regarderait la version precedente sans le savoir.
echo [2/5] Construction du site...
call npm --workspace web run build
if errorlevel 1 goto err_build

rem ---- 4. Migrations de la base locale ----------------------------------
rem LE MEME --persist-to QUE LE SERVEUR, sinon les migrations s'appliquent a une
rem base que personne ne lira. Le defaut s'est produit : l'ecran tombait en
rem panne en local avec une colonne manquante, alors que la production l'avait.
echo [3/5] Mise a jour de la base locale...
if not exist "%ETAT%" mkdir "%ETAT%"
call npx wrangler d1 migrations apply livre-de-recettes --local --persist-to "%ETAT%"
if errorlevel 1 goto err_migrate

rem ---- 5. Le serveur, dans sa propre fenetre -----------------------------
rem Une fenetre a lui pour que ses journaux restent lisibles et qu'un Ctrl+C
rem l'arrete sans fermer celle-ci.
echo [4/5] Demarrage du serveur sur %CIBLE% ...
start "Prandia - serveur local" cmd /k npx wrangler pages dev web/dist --port %PORT% --persist-to "%ETAT%"

rem On attend qu'il reponde VRAIMENT. Lancer le navigateur trop tot ouvre une
rem page d'erreur, et c'est a cette page-la que l'emulation s'appliquerait.
rem
rem DEUX OUTILS DE WINDOWS, APPELES PAR LEUR CHEMIN, et chacun a coute un essai.
rem
rem `curl` pour sonder, parce qu'il demarre instantanement. PowerShell le fait
rem aussi bien mais met pres d'une seconde a se lancer, et l'ecrire sur
rem plusieurs lignes avec des accents circonflexes de continuation cassait la
rem commande sans rien dire : elle echouait alors a chaque tour, et le serveur
rem etait declare mort alors qu'il repondait.
rem
rem `ping` pour attendre, parce que `timeout` tombe sur celui de Git pour
rem Windows quand ses outils Unix sont dans le PATH, et que celui de Windows
rem refuse de tourner quand l'entree standard est redirigee. `ping` ne regarde
rem ni l'un ni l'autre : deux envois font environ une seconde.
echo       (attente du serveur, jusqu'a 60 secondes)
set /a essais=0
:attendre
set /a essais+=1
if %essais% gtr 60 goto err_serveur
"%SystemRoot%\System32\curl.exe" -s -o nul --max-time 2 "%CIBLE%"
if errorlevel 1 (
  "%SystemRoot%\System32\ping.exe" -n 2 127.0.0.1 >nul
  goto attendre
)

rem ---- 6. Le navigateur --------------------------------------------------
set "NAVIGATEUR="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "NAVIGATEUR=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined NAVIGATEUR if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "NAVIGATEUR=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined NAVIGATEUR if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "NAVIGATEUR=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined NAVIGATEUR if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "NAVIGATEUR=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined NAVIGATEUR goto err_navigateur

rem UN PROFIL A PART, et deux raisons. La prise de debogage est refusee sur le
rem profil habituel, par securite : sans profil dedie, le pilotage echoue en
rem silence. Et cela evite d'ouvrir une session de test au milieu de ses
rem propres onglets.
set "PROFIL=%LOCALAPPDATA%\Prandia\mobile-profile"

echo [5/5] Ouverture du navigateur en mode telephone...
start "" "%NAVIGATEUR%" ^
  --remote-debugging-port=%CDP_PORT% ^
  --user-data-dir="%PROFIL%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --new-window ^
  --window-size=440,940 ^
  "%CIBLE%"

rem La bascule en telephone. CE SCRIPT NE REND PAS LA MAIN, et c'est voulu :
rem les reglages d'emulation sont lies a la connexion de debogage, pas au
rem navigateur. Des qu'on se deconnecte, Chromium les annule et la page
rem redevient un ordinateur. Mesure : une premiere version envoyait les
rem commandes puis rendait la main, annoncait un succes, et ne changeait rien.
rem
rem Il occupe donc cette fenetre. Ctrl+C ici revient au mode ordinateur, Ctrl+C
rem dans l'autre fenetre arrete le serveur.
echo.
echo ==========================================================================
echo  L'application tourne sur %CIBLE%
echo.
echo  La fenetre ouverte se comporte comme un iPhone : glisser, balayer, et les
echo  cibles au doigt. Le survol n'existe pas, comme sur un vrai telephone.
echo.
echo  Si l'ecran de connexion demande un compte et que tu n'en as pas encore en
echo  local, cree-le dans une autre fenetre avec :
echo     node scripts\add-user.mjs
echo ==========================================================================
echo.

node scripts\mobile-view.mjs
if errorlevel 1 goto err_emulation
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

:err_build
echo.
echo [erreur] La construction du site a echoue. Lis les messages au-dessus.
goto fail

:err_migrate
echo.
echo [erreur] Les migrations de la base locale ont echoue.
echo          Etat local : %ETAT%
echo          Si la base est abimee, supprime ce dossier et relance : il se
echo          recree vide, tu perds seulement les donnees de developpement.
goto fail

:err_serveur
echo.
echo [erreur] Le serveur n'a pas repondu apres une minute.
echo          Regarde la fenetre "Prandia - serveur local" : elle porte la raison.
echo          Cause frequente : le port %PORT% est deja pris par un autre lancement.
goto fail

:err_navigateur
echo.
echo [erreur] Ni Chrome ni Edge n'ont ete trouves.
echo          L'emulation tactile passe par le protocole DevTools, que seuls les
echo          navigateurs Chromium exposent. Firefox et Safari ne conviennent pas.
goto fail

:err_emulation
echo.
echo [erreur] Le passage en mode telephone a echoue.
echo          Le site reste ouvert et utilisable, mais avec une souris.
echo          Tu peux basculer a la main : F12 puis Ctrl+Shift+M.
goto fail

:fail
pause
endlocal
exit /b 1

:end
endlocal
