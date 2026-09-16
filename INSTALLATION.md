# Installer votre propre cave

Cette application tient l'inventaire d'une cave à vin : les bouteilles, leurs
emplacements, les dégustations, les accords mets et vins, et la lecture des
étiquettes par photo. Elle se partage entre plusieurs appareils.

Vous allez en installer une copie qui n'appartient qu'à vous : votre site,
votre base de données, vos données. Personne d'autre n'y a accès, et elle ne
dépend de personne.

Comptez une vingtaine de minutes, une seule fois. Il n'y a rien à programmer.

## Ce dont vous avez besoin

- un compte GitHub, gratuit
- un compte Google, gratuit

## 1. Copier l'application

1. Ouvrez le dépôt de l'application sur GitHub
2. En haut à droite, cliquez sur **Fork**, puis **Create fork**

Vous avez maintenant votre propre copie.

Supprimez ensuite le dossier `data/photos` : ce sont les étiquettes de la cave
d'origine, elles ne vous serviront pas. Dans votre copie, ouvrez le dossier
`data`, puis `photos`, et utilisez le menu `...` pour le supprimer.

## 2. Publier votre site

Dans votre copie, onglet **Settings** → menu de gauche, section **Code and
automation** → **Pages**.

Sous **Build and deployment**, dans la liste **Source**, choisissez **GitHub
Actions**.

Votre site sera publié à l'adresse `https://VOTRE-NOM.github.io/NOM-DU-DEPOT/`.
Il n'est pas encore relié à une base, c'est l'étape suivante.

## 3. Créer la base de données

1. Allez sur **console.firebase.google.com** et connectez-vous
2. **Créer un projet**, nommez-le comme vous voulez, décochez Google Analytics
3. Menu de gauche, **Créer** → **Firestore Database** → **Créer une base de
   données**
4. Laissez l'ID sur `(default)`, choisissez un emplacement proche de chez vous,
   puis **Mode production**

L'emplacement ne pourra plus être modifié ensuite, et l'ID doit rester
`(default)` : l'application cherche la base par défaut.

## 4. Ouvrir l'accès à vos caves

Onglet **Règles**, effacez tout, collez ceci, puis **Publier** :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /caves/{code}/{collection}/{piece=**} {
      allow read, write: if code.size() >= 20;
    }
  }
}
```

Ces règles n'ouvrent que les caves dont le code fait au moins vingt
caractères. Sans le code, on ne trouve rien.

## 5. Relier l'application à la base

Roue dentée en haut à gauche → **Paramètres du projet** → section **Vos
applications** → icône `</>` → donnez un nom → **Enregistrer l'application**.

Un bloc de code apparaît. Relevez-y deux lignes :

- `apiKey: "…"`
- `projectId: "…"`

Retournez dans votre copie du dépôt sur GitHub, ouvrez le fichier
`assets/js/nuage-configuration.js`, cliquez sur le crayon pour le modifier, et
reportez ces deux valeurs :

```js
export const CONFIGURATION = {
  projet: 'votre-projectId',
  cle: 'votre-apiKey',
  racine: 'https://firestore.googleapis.com/v1',
};
```

Puis **Commit changes**. Votre site se republie tout seul en une minute.

**Vérifiez bien d'avoir remplacé les deux valeurs.** Le dépôt d'origine est
livré avec celles de son auteur. Si vous y lisez encore `cave-a-vin-5a2b6`,
c'est qu'elles n'ont pas été remplacées : votre cave irait alors se ranger
dans la base de quelqu'un d'autre, sans que rien ne vous le signale, puisque
les codes d'accès restent séparés.

Ces deux valeurs sont publiques par nature : elles voyagent dans chaque page
servie, et ce n'est pas elles qui protègent votre cave. La protection tient au
code d'accès de l'étape suivante.

## 6. Créer votre cave

Ouvrez votre site, onglet **Réglages**, section **Cave partagée**, bouton
**Créer une cave partagée**.

Si votre appareil contient déjà des fiches, l'application vous demande ce
qu'elles deviennent : les publier dans la cave que vous créez, ou partir d'une
cave vide. Publier est ce qu'on veut en reliant un deuxième appareil.

Un code apparaît. **Notez-le**, c'est la seule chose qui ouvre votre cave.

Sur chaque autre appareil, ouvrez la même adresse, collez ce code, et cliquez
**Rejoindre**. Une bouteille ouverte sur l'un disparaît de l'autre en quelques
secondes.

Qui obtient ce code accède à votre cave. Ne le publiez nulle part.

## Ce qu'il reste à savoir

Ajoutez la page à l'écran d'accueil de votre téléphone, elle s'ouvrira comme
une application et fonctionnera sans réseau.

La lecture d'étiquette par photo se fait entièrement dans votre téléphone,
aucune image n'est envoyée en ligne. Le moteur pèse une dizaine de
méga-octets, chargé à la première lecture puis gardé en mémoire.

Prenez de temps en temps une **Sauvegarde complète** depuis les réglages.
C'est un fichier autonome, photos comprises, qui ne dépend d'aucun service.

Les offres gratuites de GitHub et de Google suffisent très largement à une
cave de particulier. Vous ne devriez jamais avoir à payer quoi que ce soit.
