# Cave à vin

Application web pour tenir l'inventaire d'une cave à vin : les bouteilles,
leurs emplacements, les photos d'étiquettes et le journal des dégustations.
Elle se partage entre plusieurs appareils.

**Vous voulez votre propre cave ?** Suivez [INSTALLATION.md](INSTALLATION.md).
Une vingtaine de minutes, une seule fois, sans rien programmer. Vous obtenez
votre site et votre base, qui n'appartiennent qu'à vous.

L'application démarre sur une cave vide. Ce qui la remplit vient de votre
saisie, d'une sauvegarde restaurée, ou de la cave partagée que vous
rejoignez.

## Ce qu'elle fait

**Depuis le téléphone, en deux gestes**
- Ajouter un vin en photographiant l'étiquette
- Signaler une bouteille bue en la photographiant, l'application cherche laquelle c'est dans la cave

**La cave**
- Recherche instantanée sur le nom, le producteur, la région, le cépage, la provenance et les notes
- Filtres d'un geste toujours visibles par couleur et par emplacement, panneau complet pour le reste
- Tri par nom, producteur, région, millésime, quantité ou note
- Chaque vin affiche sa photo d'étiquette, sa couleur, sa répartition entre les trois emplacements et ce qui reste à vérifier

**Les accords mets et vins**
- Choisir un plat parmi seize familles, obtenir les bouteilles en cave qui lui conviennent, classées
- Température de service et raison de l'accord pour chaque bouteille
- Les accords tirés de vos propres notes passent devant les suggestions génériques
- Sur la fiche d'un vin, la liste des plats qui lui vont

**Une fiche par vin**
- Stock détaillé par emplacement, avec un plus et un moins pour corriger sur place
- Ouvrir une bouteille : le stock baisse, la dégustation est datée, notée et commentée, et la fiche passe en terminé sur la dernière bouteille
- Ajouter des bouteilles, les déplacer d'un emplacement à l'autre, modifier ou supprimer la fiche
- Photo d'étiquette agrandissable, historique des dégustations du vin

**Le journal des dégustations**
- Les bouteilles bues à la maison et les vins goûtés ailleurs sur une même ligne du temps
- Recherche et filtres, ajout et modification d'une entrée

**Les statistiques**
- Bouteilles, références, vins terminés, dégustations et note moyenne
- Répartition par couleur, emplacement, région, producteur, millésime et provenance
- Dégustations par mois et par contexte
- Raccourci vers les fiches dont la quantité, l'emplacement ou la couleur reste à confirmer

**Le reste**
- Fonctionne hors ligne, lecture d'étiquette comprise, installable sur l'écran d'accueil
- Thème clair, sombre ou celui du système
- Sauvegarde complète en JSON, export des vins et des dégustations en CSV lisible par Excel
- Aucune donnée n'est envoyée en ligne : tout reste dans le navigateur

## Utiliser l'application

L'application est publiée sur GitHub Pages par le workflow
`.github/workflows/pages.yml`, à chaque poussée sur `main` :

**https://gitcad-jps.github.io/Cave-a-vin-jps/**

Sur le téléphone, ouvrir cette adresse puis « Ajouter à l'écran d'accueil »
installe l'application comme une application native, avec son icône. Une fois
les photos mises en cache, elle reste consultable sans réseau, ce qui est
utile au sous-sol.

Les données restent dans le navigateur de chaque appareil et ne suivent donc
pas de l'un à l'autre : voir « Où sont les données » plus bas.

### Activer la publication, une fois pour toutes

Créer un site GitHub Pages exige les droits d'administration du dépôt, que
GitHub ne donne jamais au jeton automatique des workflows. Cette étape ne peut
donc pas être automatisée : dans **Settings → Pages → Source**, choisir
**GitHub Actions**. Le workflow prend ensuite le relais et republie seul.

### En local

Le site est entièrement statique, sans installation ni compilation, mais il
faut le servir par un serveur web : le navigateur refuse de charger des
modules JavaScript depuis un fichier ouvert directement.

```bash
python3 -m http.server 8000
```

Puis ouvrir http://localhost:8000 dans un navigateur.

## Lire une étiquette

Les deux parcours photo proposent de lire l'étiquette pour préremplir la fiche
ou reconnaître la bouteille. La reconnaissance tourne entièrement dans le
navigateur : aucune photo ne quitte l'appareil, et aucune requête ne part vers
un site tiers.

Le moteur, Tesseract, est **embarqué** sous `assets/vendor/tesseract` plutôt
que chargé depuis un CDN. Cela coûte une dizaine de méga-octets dans le dépôt,
en échange de deux choses qui comptent ici : la lecture fonctionne **hors
ligne**, ce qui est le cas ordinaire dans une cave, et elle ne dépend d'aucun
hébergeur susceptible de bloquer ces requêtes. Le détail des fichiers et leur
provenance sont dans `assets/vendor/tesseract/PROVENANCE.md`, et
`tools/preparer_moteur.py` régénère le tout depuis npm.

Le moteur n'est pas préchargé : la plupart des consultations ne lisent aucune
étiquette. Il est chargé à la première lecture, puis gardé en cache par le
service worker, y compris pour l'usage hors ligne.

La lecture porte sur la photo telle que l'appareil l'a rendue, et non sur la
copie réduite gardée dans la cave. Elle est ramenée à 2000 px de côté, mesuré
comme le meilleur compromis sur un lot de photos prises comme on le fait
vraiment. Ce qui compte n'est pas la taille de la photo mais celle des lettres
une fois la photo réduite, et c'est pourquoi le cadrage pèse bien plus lourd
que le téléphone.

Mots correctement lus sur un lot de neuf photos, gros plans et bouteilles
entières mêlés :

| Cadrage | Résultat |
| --- | --- |
| Étiquette cadrée de près, de face et éclairée | Tout le texte, millésime, degré et volume repris tels quels |
| Étiquette de biais ou dans l'ombre | Quelques lettres fautives, le bon vin ressort quand même en tête |
| Bouteille entière prise à un mètre | Deux tiers du texte, assez pour reconnaître le vin, pas toujours pour le millésime |
| Vignette de moins de 300 px | Inexploitable |

Autrement dit : une photo prise de près avec un téléphone fonctionne, une
bouteille entière photographiée de loin bien moins, une vignette récupérée
ailleurs pas du tout. L'écran de prise de vue le rappelle avant le
déclenchement.

Quand la lecture échoue, le parcours continue sans elle : la photo est
conservée et la recherche manuelle prend le relais.
Un délai maximum garantit que la main est rendue, et un bouton permet de
renoncer sans attendre.

## Plusieurs appareils

L'application est locale d'abord : elle lit et écrit dans le navigateur,
s'affiche instantanément et fonctionne sans réseau. Quand une cave partagée
est configurée, `assets/js/nuage.js` s'y branche en plus, et les appareils qui
portent le même code voient la même cave.

Le partage passe par une base Firestore atteinte directement en HTTP, sans
aucune bibliothèque à charger. Une page statique suffit donc : pas de serveur
à tenir, pas de compte à créer, pas de connexion à demander à qui que ce soit.

L'accès repose sur un **code long et imprévisible** qui fait partie du chemin
des données. Qui ne l'a pas ne trouve rien, exactement comme un lien privé.
C'est ce qui convient à une cave de particuliers, et il faut le savoir :
quiconque obtient le code accède à la cave. Le code se crée une fois depuis
les réglages, puis se recopie sur le deuxième appareil.

Chaque vin et chaque dégustation est un document distinct. C'est ce qui permet
à deux appareils de modifier la cave en même temps sans s'écraser : seuls des
changements portant sur la même fiche entrent en conflit, et le dernier écrit
l'emporte.

Chaque fiche porte la date à laquelle un appareil l'a modifiée, et non celle de
son envoi. C'est elle qui départage deux appareils : celui qui retrouve le
réseau après deux jours ne passe pas pour le plus à jour. Elle règle aussi
l'arrivée d'un appareil supplémentaire : en se branchant, il n'envoie que les
fiches que le partage ignore ou qu'il connaît moins à jour, et reçoit le
reste. Deux appareils partis du même contenu portent les mêmes identifiants et
n'ont donc rien à s'apporter tant qu'ils n'ont rien modifié.

Firestore n'offre pas d'écoute temps réel en HTTP simple. Plutôt que de relire
la cave entière sans arrêt, l'application interroge toutes les huit secondes un
minuscule document témoin, mis à jour à chaque écriture. La cave n'est relue
que lorsqu'il change, ce qui laisse le trafic à quelques centaines d'octets
tant que personne ne touche à rien.

Les photos prises depuis l'application restent dans le navigateur qui les a
prises, et une copie réduite part avec la cave, dans une collection à part lue
à la demande. Une vingtaine de kilo-octets suffisent à reconnaître une
étiquette.

Une modification faite hors réseau est conservée et envoyée à la reprise. Les
réglages indiquent où en est la synchronisation, et distinguent : vérification
en cours, active, en attente de réseau, pas encore partagée, ou impossible sur
cette version faute de base configurée. Un bandeau le dit aussi en haut de
l'écran quand la cave ne rejoint aucun autre appareil, car saisir une soirée
de dégustations en croyant les partager coûte cher.

`assets/js/nuage-configuration.js` porte les coordonnées de la base. Tant
qu'il est vide, l'application fonctionne normalement mais pour elle seule. Les
deux valeurs y sont publiques par nature, elles voyagent dans chaque page
servie : ce n'est pas elles qui protègent la cave, c'est le code d'accès.

## Où sont les données

L'application démarre sur une cave vide, puis tout est lu et écrit
localement :

| Emplacement | Contenu |
| --- | --- |
| `localStorage` | Les fiches des vins, le journal des dégustations, les préférences |
| `IndexedDB` | Les photos prises depuis l'application |
| `data/photos/` | Des photos d'étiquettes livrées avec le dépôt, s'il y en a |

Sans code d'accès, les données vivent dans un seul navigateur et ne suivent
pas d'un appareil à l'autre. Le bouton « Sauvegarde complète » des réglages
télécharge un fichier JSON contenant les fiches et les photos ajoutées, que
« Restaurer une sauvegarde » relit sur un autre appareil. Cette sauvegarde
reste utile même avec le partage, pour garder une copie hors de
l'application.

Un cadre d'artefact interdit à la page de déclencher un téléchargement : le
lien y reste inerte, sans la moindre erreur, et l'application annoncerait une
sauvegarde qui n'a pas eu lieu. `assets/js/export.js` passe donc par la remise
de fichier de l'hébergeur quand elle existe, et par le lien ordinaire partout
ailleurs. Dans les deux cas, le message de confirmation n'apparaît qu'une fois
le fichier réellement remis, et un refus ne dit rien du tout.


## Organisation du code

```
.github/workflows/         publication automatique sur GitHub Pages
index.html                 coquille de la page et jeu d'icônes SVG
manifest.webmanifest       description de l'application installable
sw.js                      service worker : mise en cache pour l'hors ligne
assets/css/styles.css      feuille de style unique, mobile d'abord
assets/vendor/tesseract/   moteur de reconnaissance embarqué, hors ligne compris
assets/js/
  app.js                   routage par ancre, navigation, démarrage
  model.js                 normalisation, champs dérivés, filtres, statistiques
  store.js                 état, persistance, actions métier
  synchro.js               partage de la cave entre appareils, quand il existe
  accords.js               profils de cépages et appellations, accords mets et vins
  etiquette.js             lecture d'une photo d'étiquette, rapprochement avec la cave
  photos.js                photos prises dans l'application (IndexedDB)
  export.js                sauvegarde JSON, exports CSV
  formulaires.js           formulaires et boîtes de dialogue de saisie
  composants.js            fragments d'interface partagés
  dom.js                   aides pour construire le DOM
  theme.js                 thème clair, sombre ou système
  vues/                    une vue par onglet, la fiche d'un vin, les parcours photo
data/photos/               photos d'étiquettes livrées avec le dépôt
```

Le code n'utilise aucune bibliothèque ni étape de compilation : des modules
JavaScript natifs, servis tels quels. Modifier un fichier et recharger la page
suffit. Après une modification, il faut incrémenter `VERSION` dans `sw.js`
pour que les navigateurs déjà visités récupèrent la nouvelle version.
