# Kart Club 🏁

Un jeu de karting 3D en vue cockpit, directement dans le navigateur. Quatre circuits de 1,7 à 2 km, trois tours, une direction entièrement manuelle et des chutes sans filet. Univers et éléments graphiques originaux, sans assets Nintendo.

## Lancer le jeu

Prérequis : **Node.js 22 ou supérieur** (version de développement : 24.19.0).

```sh
npm ci
npm start
```

Ouvrez `http://localhost:3000` dans un navigateur récent avec WebGL 2 activé. `npm run dev` relance automatiquement le serveur lors des modifications. La variable `PORT` permet de changer le port ; le serveur écoute sur `0.0.0.0`.

Pas de compilation, de base de données ou de clé API. Three.js 0.180 est chargé depuis jsDelivr, avec un repli sur la copie locale npm si le CDN ne répond pas. Les polices Barlow Condensed et DM Sans sont incluses localement avec leurs licences OFL.

## Jouer

- **Course rapide** : vous contre trois bots. Fonctionne sans connexion au service Socket.io une fois la page chargée.
- **Créer un salon** : partagez le code de cinq caractères. Vos amis choisissent leur pseudo et utilisent « Code ami ». L’hôte lance la course. Jusqu’à huit humains ; des bots complètent la grille jusqu’à quatre pilotes.
- Un lien `https://votre-site/?room=ABCDE` préremplit le code de salon.
- Trois tours, classement en direct, chronomètre, mini-carte, écran de résultats et revanche en salon.

| Action            | Clavier               | Manette standard    |
| ----------------- | --------------------- | ------------------- |
| Accélérer         | ↑, Z ou W             | RT ou A             |
| Freiner           | ↓ ou S                | LT                  |
| Tourner           | ← / →, Q / D ou A / D | Stick gauche        |
| Déraper           | Maj + direction       | B + stick           |
| Utiliser un objet | Espace                | X                   |
| Pause             | Échap ou P            | Bouton d’interface  |
| Aide / son        | H / M                 | Boutons d’interface |

Des commandes tactiles apparaissent sur les appareils tactiles. Le son est désactivé par défaut ; activez-le avec le bouton en haut à droite ou M. La pause fige le solo. **En multijoueur, les autres pilotes continuent pendant une pause.** Une perte de focus coupe vos commandes. Une déconnexion vous remplace par un bot ; il faut rejoindre un nouveau salon pour rejouer.

La direction est **entièrement manuelle** : la position, le cap et les vitesses horizontales du kart sont indépendants du tracé. Sans direction, le kart continue tout droit, y compris dans un virage. Freinez avant les épingles, contrebraquez au besoin et chargez le drift pendant au moins 0,65 seconde. Relâcher Maj libère un mini-turbo ; après 1,8 seconde, les étincelles cyan annoncent un turbo plus long.

### Quatre circuits

| Circuit         | Longueur | Dénivelé | Environnement                                                                    |
| --------------- | -------- | -------- | -------------------------------------------------------------------------------- |
| Sunset Cliffs   | 1 759 m  | 34 m     | Corniches tropicales, falaises, palmiers et lagon animé                          |
| Neon Overdrive  | 1 679 m  | 37 m     | Métropole nocturne, asphalte humide, enseignes lumineuses et pont à deux niveaux |
| Inferno Caldera | 1 876 m  | 60 m     | Caldeira, colonnes de basalte, lave animée et braises                            |
| Aurora Summit   | 1 966 m  | 101 m    | Cols enneigés, forêt de sapins, glace, neige et aurores animées                  |

Choisissez le circuit avant une course rapide. En multijoueur, l’hôte le choisit dans le salon ; ce choix est synchronisé et verrouillé dès le départ. Les tracés utilisent des splines 3D fermées avec des lignes droites, chicanes, épingles et dévers. Le croisement de Neon Overdrive sépare physiquement les deux routes de 34 mètres.

### Chutes, checkpoints et rappel

Seules les glissières visibles bloquent le kart. Le reste des corniches est ouvert : les accotements ralentissent, puis la perte du support déclenche une vraie chute avec gravité et conservation de la vitesse horizontale. Un compte à rebours accompagne la chute.

Le rappel intervient **exactement 2,5 secondes de simulation après la perte du support**, à 30 Hz sur le serveur et 60 Hz en solo. La simulation rattrape le temps écoulé lorsque le rendu ralentit. Le prochain affichage ou paquet réseau reste soumis à sa fréquence de rafraîchissement. Le kart revient à l’arrêt au dernier passage sûr, orienté dans le sens de la piste, avec 1,2 seconde de protection contre les collisions. La touche R (Y sur manette, bouton R tactile) utilise le même délai pour se dégager.

Trente-deux portes par tour doivent être franchies dans l’ordre. Les croisements utilisent une projection en trois dimensions : passer sous un pont ne valide pas le dessus, et une chute ne fournit pas de raccourci. Les adversaires IA produisent leurs propres commandes via un contrôleur distinct ; ce contrôleur n’est jamais exécuté pour un joueur humain.

### Rendu

Le mode **Cinéma**, sélectionné par défaut sur ordinateur, active le rendu HDR, l’antialiasing MSAA 4×, un bloom extrait en demi-flottant puis flouté à résolution réduite, un étalonnage ACES avec saturation et teinte par circuit, et un vignettage léger. Les ombres PCF douces de 2 048 pixels suivent la zone du kart. L’asphalte utilise une texture procédurale de 2 048 × 2 048 pixels avec relief et filtrage anisotrope. Éclairages et matériaux émissifs, eau, lave, aurores et particules sont animés.

Les réglages **Équilibré** (par défaut sur mobile) et **Léger** sont disponibles dans l’accueil et la pause. Équilibré conserve HDR, bloom et étalonnage avec une résolution et des ombres réduites ; Léger utilise le rendu ACES direct, sans bloom ni ombres. Le choix est mémorisé. Les instances regroupent bâtiments, arbres, rochers et marquages pour limiter les appels de rendu, et les ressources du circuit précédent sont libérées lors d’un changement.

### Objets et piste

- **Boîtes mystères** : objet aléatoire, réapparition individuelle après 12 secondes.
- **Turbo** : accélération temporaire, vitesse de pointe proche de 190 km/h sur route.
- **Banane** : piège posé derrière le kart, disparu après une collision ou 28 secondes.
- **Carapace verte** : projectile en ligne droite dans le cap du kart, indépendant de la route.
- **Carapace rouge** : projectile qui vise un adversaire devant lui en coordonnées libres.
- **Bandes cyan** : accélération au sol ; **huile** : tête-à-queue ; **hors-piste** : limitation de vitesse.

## Multijoueur et architecture

```text
public/
  index.html       Accueil, salon, HUD, aide et résultats
  style.css        Interface responsive et commandes tactiles
  app.js           Entrées, cycle de jeu, UI, client Socket.io
  world.js         Circuit procédural Three.js, karts, cockpit, particules
  tracks.js        Quatre tracés 3D, surfaces, glissières et projection
  shared.js        Physique libre, checkpoints, objets, chutes et rappel
  post.js          Pipeline HDR, extraction du bloom, flou et étalonnage
  audio.js         Moteur et effets sonores Web Audio
server.js          Serveur Express + Socket.io, salons et simulation à 30 Hz
test/              Tests de simulation, réseau et navigateur
render.yaml        Blueprint Render
```

Le solo exécute la simulation dans le navigateur à pas fixe de 60 Hz, indépendamment du rendu. Le cap ne dépend que de la direction, de la vitesse et des effets de collision ; aucun point futur du circuit ne dirige le joueur ou sa caméra. En ligne, le serveur calcule la course à 30 Hz : les clients envoient leurs commandes et reçoivent l’état, le classement et les événements. Les bots utilisent les mêmes règles. Le rendu des karts et de la caméra interpole les états reçus. Les positions, objets et résultats ne sont pas acceptés depuis les clients.

Les salons sont conservés **en mémoire sur une seule instance** et disparaissent à son redémarrage. Pas de comptes ni de persistance des scores. Ne passez pas à plusieurs instances sans ajouter un stockage partagé, une stratégie de simulation par salon et un adaptateur Socket.io. Les entrées sont bornées, les pseudos limités et l’interface insère les noms comme texte.

## Déployer sur Render

1. Commitez ces fichiers et poussez-les dans votre dépôt GitHub.
2. Dans Render, créez un **Blueprint** à partir du dépôt : `render.yaml` déclare le service Node.
3. Ou créez un **Web Service** avec `npm ci --omit=dev` comme Build Command et `npm start` comme Start Command. Health check : `/health`.
4. Utilisez **une seule instance**. `PORT` est fourni automatiquement. Socket.io utilise la même origine, sans URL serveur à configurer.
5. Partagez l’URL HTTPS du service ; les codes de salon fonctionnent entre appareils.

Le plan gratuit peut mettre le service en veille et demander un temps de réveil à la première visite. Le navigateur conserve le mode solo si Socket.io n’est pas disponible. Sur un réseau local, utilisez l’adresse IP de la machine et autorisez le port choisi ; l’accès à la manette et au presse-papiers peut nécessiter HTTPS ou localhost.

## Vérifier

```sh
npm test
npm run test:browser
```

`npm test` vérifie les quatre tracés, la direction sans assistance, la glisse, les objets, les interactions de piste, le croisement à deux niveaux, les checkpoints, le délai de rappel à 30/60 Hz, quatre courses complètes et un salon Socket.io à deux clients avec choix du circuit et rappel chronométré. Le test navigateur vérifie l’accueil, l’aide, la conduite, la pause, un salon à deux pages et l’interface mobile. Il vérifie aussi le repli local de Three.js lorsque le CDN est bloqué, le rappel dans l’interface, la synchronisation du circuit et les quatre environnements avec leur post-traitement.

Le test navigateur utilise `/usr/bin/chromium` s’il est disponible. Sinon, exécutez `npx playwright install chromium`, ou définissez `CHROMIUM_PATH` vers votre exécutable. Les captures sont enregistrées dans `test-results/` (ignoré par Git).

## Limites connues

La physique reste un modèle de kart arcade avec inertie latérale et direction manuelle, sans solveur de suspensions ou de déformations de carrosserie. Les karts entrent en collision entre eux, avec les glissières et avec la surface routière ; les bâtiments, végétaux et massifs éloignés sont des décors. Le rendu est stylisé et procédural, pas un moteur AAA photoréaliste ; la fluidité dépend du GPU. Le son est synthétisé, sans fichiers audio. Le multijoueur ne comporte pas encore de reconnexion à une course en cours, de spectateurs ou de matchmaking public. Sur un appareil peu puissant, baissez la résolution de la fenêtre ; la densité de pixels est déjà plafonnée pour limiter le coût du rendu.
