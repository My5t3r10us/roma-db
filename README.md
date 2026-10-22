# Roma DB

Application desktop Windows d’administration visuelle PostgreSQL : TinyJS 0.50.1, React, TypeScript, Tailwind CSS et un compagnon Node.js / pg.

## Démarrer

```powershell
npm install
npm run dev
```

La fenêtre TinyJS s’ouvre ; Vite fournit le frontend sur `127.0.0.1:5186` pendant le développement. En production, aucun serveur HTTP ne tourne.

Sur l’écran d’accueil, ajoutez une connexion ou utilisez « Utiliser la base locale devdb » après provisionnement :

```powershell
devdb create --pg
devdb env --write
```

Les profils contiennent l’hôte, le port, le compte et une base de maintenance accessible. Pour une connexion distante, SSL vérifie le certificat et l’hôte par défaut. Les certificats PEM peuvent être renseignés dans les options avancées. Le mode explicite « SSL requis · certificat non vérifié » chiffre la connexion et accepte notamment les certificats auto-signés, sans vérifier l’identité du serveur ; il ne revient jamais automatiquement à une connexion non chiffrée. Pour conserver la vérification d’un certificat auto-signé, fournissez son autorité de certification et le nom DNS correspondant au certificat. Les mots de passe et les clés privées résident dans le gestionnaire de secrets TinyJS (Credential Manager sous Windows), jamais dans le JSON des profils. Laisser les secrets vides conserve leurs valeurs.

## Utilisation

Quatre écrans, accessibles depuis la barre latérale (`Alt 1` à `Alt 4`). La base de travail se choisit en haut à gauche.

- **Accès** : une grille ressources × rôles. Chaque case montre le niveau effectif (Lecture, Écriture, Complet, Propriétaire, Super). Plein : droit direct ; pointillé : hérité d’un groupe ou de PUBLIC (survol = origine détaillée). Le périmètre passe de Bases à Schémas puis à Tables & objets ; cliquer sur une base ou un schéma y descend. Cliquer sur une case ouvre l’éditeur : niveau en un clic ou privilège par privilège. Cliquer sur l’en-tête d’un rôle applique un niveau à toutes les lignes affichées. Le bouton ⓘ d’une ligne répond à « qui a accès ? », politiques RLS comprises. Un avertissement signale les rôles privés de USAGE sur le schéma, avec un correctif en un clic.
- **Rôles** : liste des comptes et groupes ; la fiche montre les groupes hérités, les membres, l’accès aux bases et aux schémas, et les attributs. Appartenances appliquées immédiatement, avec « Annuler » dans la notification. Création d’un compte avec ses groupes en une étape, SQL affiché avant exécution.
- **Schémas** : arborescence schémas → tables, vues, séquences, fonctions. Le concepteur de table édite colonnes (nom, type, obligatoire, défaut, auto-incrément, clé primaire, description), contraintes (clé étrangère, unicité, vérification) et index ; création, renommage et suppression de tables. Vues et fonctions sont affichées en lecture seule.
- **Droits par défaut** : règles pour les objets créés à l’avenir, écrites en phrases (« quand X crée des tables dans Y, Z reçoit SELECT »).

**Export d’audit** : le bouton « Exporter l’audit (HTML) » de la barre du haut (ou `Ctrl K` → « Exporter l’audit ») écrit un fichier HTML autonome, en lecture seule : tous les rôles (attributs, appartenances), les droits sur chaque base, schéma, table, vue, séquence et fonction (matrices de droits effectifs, droits directs ou hérités, PUBLIC compris), les colonnes, contraintes, index et politiques RLS, les droits par défaut et une liste de points d’attention. Aucun mot de passe ni hash n’est lu. Disponible dans l’application de bureau uniquement.

Rien n’est exécuté pendant l’édition des droits ou de la structure : une barre en bas de l’écran compte les modifications en attente (par connexion et par base). « Vérifier et appliquer » (`Ctrl Entrée`) montre le SQL exact, puis exécute la structure et les permissions chacune dans une transaction. Les droits sont relus avant exécution : un conflit annule le lot. Les instructions DDL passent par le protocole étendu (une instruction par appel) ; types et identifiants sont validés côté backend. `Ctrl K` ouvre la palette (rôles, tables, bases, actions).

PostgreSQL 14–18 est ciblé. Les options de membership INHERIT/SET par appartenance nécessitent PostgreSQL 16 ; MAINTAIN nécessite PostgreSQL 17. Les permissions de colonnes et l’édition des données ne sont pas couvertes ; la modification des vues et fonctions non plus. Les accès au niveau colonne peuvent autoriser certaines opérations même quand aucun droit de table n’est affiché. Les tunnels SSH sont externes.

La connexion au serveur partagé `127.0.0.1:5432` et ses alias est protégée : création et suppression de bases exclusivement via `devdb`. Les bases système et rôles réservés sont protégés. Les autres actions restent soumises aux droits du compte connecté. La première version n’est pas signée ; Windows peut demander une validation de lancement selon ses politiques.

## Vérifier

```powershell
npm test
devdb create --pg --test
devdb env --test --write .env.test
npm run test:integration
npm run build
```

Après un build TinyJS (ou `npm run dev`), `npm run test:native` vérifie le coffre-fort et le transport dans une fenêtre de test isolée. Après `npm run package`, `npm run test:portable` compile le même test dans un exécutable et le lance avec Node absent du PATH. Les secrets et fixtures de test sont retirés après succès.

Les intégrations refusent une base dont le nom ne finit pas par `_test`. Elles créent des rôles temporaires préfixés `roma_test_` et des objets uniquement dans leur schéma de test ; elles retirent ces fixtures sans supprimer de base. Les tests exigent un compte capable de créer des rôles.

## Paquet Windows portable

```powershell
npm run package
```

Distribuez le dossier `dist` entier. Lancez `dist/roma-db.exe`. Le paquet contient `launcher.exe`, `companion/node.exe` et le worker PostgreSQL ; il ne dépend pas d’une installation Node.js sur la machine cible. Windows 10/11 et WebView2 sont nécessaires. La taille dépasse celle d’une application TinyJS seule car le runtime Node est inclus. Le frontend compilé est chargé depuis des fichiers locaux.

## Aperçu web

Le frontend ouvert dans un navigateur présente une démonstration explicitement signalée. Les données de cet aperçu sont fictives et vivent en mémoire : on peut tout essayer (droits, rôles, tables), rien n’atteint un serveur et tout est réinitialisé au rechargement. Pour les connexions réelles, utilisez la fenêtre TinyJS.

`npm run dev` lance le serveur Vite de l’aperçu puis la fenêtre native. Après une modification du compagnon ou du backend, relancez `npm run dev` pour recompiler ces couches.

## Structure

`src/` : interface React — `workspace.tsx` (état global, modifications en attente), `permissions.ts` (niveaux et origines des droits), `structure.ts` (brouillons de tables → opérations DDL), `pages/` (Accès, Rôles, Schémas, Droits par défaut), `demo.ts` (aperçu web en mémoire). `backend/main.ts` : API TinyJS et coffre-fort, transport JSON stdin/stdout. `backend/worker.ts` : compagnon Node. `backend/postgres.ts` : catalogues, matrice d’accès et opérations PostgreSQL. `backend/ddl.ts` : génération et validation du DDL. `shared/types.ts` : contrats API.

Les noms SQL sont échappés, les données paramétrées ou encodées en littéraux SQL sûrs. Les signatures de fonctions viennent des catalogues après résolution de l’OID. L’API n’expose pas de requête SQL libre ; seules les expressions DEFAULT et CHECK sont du SQL saisi, exécutées une instruction à la fois. Les logs ne contiennent pas les mots de passe.
