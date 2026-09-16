// Réglages : apparence, sauvegardes et remise à zéro.

import { bouton, confirmer, el, message, selection, vider } from '../dom.js';
import { section } from '../composants.js';
import * as exporter from '../export.js';
import * as store from '../store.js';
import { appliquerTheme } from '../theme.js';

const THEMES = [
  { valeur: 'auto', libelle: 'Suivre le système' },
  { valeur: 'clair', libelle: 'Clair' },
  { valeur: 'sombre', libelle: 'Sombre' },
];

export function rendre(conteneur, { naviguer }) {
  const prefs = store.preferences();
  const etat = store.donnees();
  vider(conteneur);

  const entreeImport = el('input', {
    type: 'file', accept: 'application/json,.json', class: 'visuellement-cache',
    id: 'import-sauvegarde',
  });
  entreeImport.addEventListener('change', async () => {
    const fichier = entreeImport.files?.[0];
    entreeImport.value = '';
    if (!fichier) return;
    const accord = await confirmer(
      'Restaurer une sauvegarde',
      'Le contenu actuel de la cave sera remplacé par celui du fichier.',
      { libelleAction: 'Restaurer', danger: true },
    );
    if (!accord) return;
    try {
      const paquet = await exporter.lireFichierJson(fichier);
      const bilan = await store.importerJson(paquet);
      message(`Sauvegarde restaurée : ${bilan.vins} vins, ${bilan.degustations} dégustations`);
      naviguer('/cave');
    } catch (erreur) {
      console.error(erreur);
      message(erreur.message || 'Restauration impossible', 'erreur');
    }
  });

  const declencheurImport = el('label', { class: 'bouton', for: 'import-sauvegarde', tabindex: '0' },
    [el('span', { text: 'Restaurer une sauvegarde' })]);
  declencheurImport.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') entreeImport.click();
  });

  const racine = el('div', { class: 'vue-reglages' }, [
    el('header', { class: 'entete-vue' }, [el('h1', { text: 'Réglages' })]),

    section('Apparence', el('div', { class: 'grille-deux' }, [
      el('label', { class: 'champ' }, [
        el('span', { class: 'champ-etiquette', text: 'Thème' }),
        selection(THEMES, prefs.theme, {
          onchange: (e) => {
            store.enregistrerPreferences({ theme: e.target.value });
            appliquerTheme(e.target.value);
          },
        }),
      ]),
    ])),

    section('Cave partagée', [etatSynchronisation(), reglageDuCode()]),

    section('Sauvegarde', [
      el('p', {
        class: 'discret',
        text: store.partageBranche()
          ? 'La cave est partagée entre les appareils qui y ont accès. Une sauvegarde '
            + 'reste utile pour garder une copie hors de l’application.'
          : 'La cave est enregistrée dans ce navigateur. Exportez une sauvegarde avant '
            + 'de changer d’appareil ou de vider les données du navigateur.',
      }),
      el('div', { class: 'rangee-boutons' }, [
        bouton('Sauvegarde complète (JSON)', {
          classe: 'bouton bouton-primaire',
          onclick: () => remettre(exporter.sauvegardeComplete, 'Sauvegarde enregistrée'),
        }),
        declencheurImport,
        entreeImport,
      ]),
      el('div', { class: 'rangee-boutons' }, [
        bouton('Exporter les vins (CSV)', {
          onclick: () => remettre(exporter.exportVinsCsv, 'Liste des vins enregistrée'),
        }),
        bouton('Exporter les dégustations (CSV)', {
          onclick: () => remettre(exporter.exportDegustationsCsv, 'Journal enregistré'),
        }),
      ]),
      el('p', { class: 'discret', text: etat.majLe ? `Dernière modification : ${dateLisible(etat.majLe)}` : '' }),
    ]),

    section('Repartir de zéro', [
      el('p', {
        class: 'discret',
        text: 'Efface tous les vins, toutes les dégustations et les photos prises '
          + 'depuis l’application. Si la cave est partagée, elle se vide aussi '
          + 'chez les autres appareils.',
      }),
      el('div', { class: 'rangee-boutons' }, [
        bouton('Vider la cave', {
          classe: 'bouton bouton-danger-discret',
          onclick: async () => {
            const accord = await confirmer(
              'Vider la cave',
              'Tout le contenu sera effacé, sans possibilité de revenir en '
                + 'arrière. Exportez une sauvegarde d’abord si vous hésitez.',
              { libelleAction: 'Tout effacer', danger: true },
            );
            if (!accord) return;
            try {
              await store.vider();
              message('Cave vidée');
              naviguer('/cave');
            } catch (erreur) {
              console.error(erreur);
              message('Effacement impossible', 'erreur');
            }
          },
        }),
      ]),
    ]),

    section('À propos', el('dl', { class: 'definitions' }, [
      el('dt', { text: 'Vins en fiche' }),
      el('dd', { text: String(store.vins().length) }),
      el('dt', { text: 'Dégustations' }),
      el('dd', { text: String(store.degustations().length) }),
      el('dt', { text: 'Stockage' }),
      el('dd', {
        text: store.partageBranche()
          ? 'Ce navigateur, et une base en ligne où se retrouvent les appareils '
            + 'qui portent le même code'
          : 'Ce navigateur seulement, aucune donnée envoyée en ligne',
      }),
    ])),
  ]);

  conteneur.append(racine);
  suivreSynchro(racine, naviguer);
}

/**
 * Redessine la page quand la synchronisation change d'état.
 *
 * Le partage se branche une seconde après l'affichage. Sans cela, quelqu'un
 * qui ouvre les réglages au démarrage lirait « Cet appareil seulement » alors
 * que la cave vient justement de se connecter : c'est l'écran qu'on consulte
 * pour comprendre, il ne peut pas être celui qui trompe.
 */
function suivreSynchro(racine, naviguer) {
  let dernier = store.etatSynchro();
  const desabonner = store.abonner(() => {
    if (!racine.isConnected) { desabonner(); return; }
    if (store.etatSynchro() === dernier) return;
    dernier = store.etatSynchro();
    desabonner();
    naviguer(null);
  });
}

/**
 * Remet un fichier et ne dit « c'est fait » que si ça l'est.
 *
 * Selon l'endroit où tourne l'application, l'enregistrement passe par le
 * navigateur ou par l'hébergeur, qui demande alors confirmation. Un refus se
 * passe de commentaire, la personne vient de le formuler.
 */
async function remettre(action, reussite) {
  try {
    if (await action() === 'enregistre') message(reussite);
  } catch (erreur) {
    console.error(erreur);
    message(`Enregistrement impossible : ${erreur.message}`, 'erreur');
  }
}

const AUTORISATIONS = {
  granted: 'accordée',
  prompt: 'jamais demandée',
  denied: 'refusée',
  unavailable: 'indisponible',
};

const ETATS_SYNCHRO = {
  recherche: {
    titre: 'Vérification…',
    texte: 'L’application regarde si un espace partagé est disponible ici. '
      + 'Cela prend quelques secondes au démarrage.',
  },
  connecte: {
    titre: 'Active',
    texte: 'La cave est partagée entre tous les appareils qui portent ce code, '
      + 'quels qu’ils soient et à qui qu’ils appartiennent. Une bouteille '
      + 'ouverte sur l’un apparaît sur les autres en quelques secondes.',
  },
  attente: {
    titre: 'En attente',
    texte: 'Le partage ne répond pas pour le moment. Vos modifications sont '
      + 'conservées ici et seront envoyées dès que possible.',
  },
  sansCode: {
    titre: 'Pas encore partagée',
    texte: 'Cette cave vit dans ce seul navigateur. Créez une cave partagée '
      + 'ci-dessous, ou saisissez le code de celle qui existe déjà.',
  },
  local: {
    titre: 'Cet appareil seulement',
    texte: 'Cette version de l’application ne partage rien : la cave vit dans '
      + 'ce navigateur. Passez par une sauvegarde pour la transporter.',
  },
};

function etatSynchronisation() {
  const etat = store.etatSynchro();
  const { titre, texte } = ETATS_SYNCHRO[etat] || ETATS_SYNCHRO.local;
  return el('div', { class: 'synchro' }, [
    el('span', { class: `pastille-synchro ${etat}`, text: titre }),
    el('p', { class: 'discret', text: texte }),
    diagnostic(),
  ]);
}

/**
 * Création ou saisie du code d'accès à la cave partagée.
 *
 * Le code est la clé : il fait partie du chemin des données, et deux appareils
 * qui le portent voient la même cave. Il s'affiche en clair une fois posé, car
 * il faut pouvoir le recopier sur le deuxième téléphone.
 */
function reglageDuCode() {
  if (!store.partageConfigure()) {
    return el('p', {
      class: 'discret',
      text: 'Cette version de l’application n’est reliée à aucune cave '
        + 'partagée. Elle fonctionne normalement, mais pour elle seule.',
    });
  }

  const actuel = store.codePartage();
  if (actuel) return codeEnPlace(actuel);

  const saisie = el('input', {
    type: 'text', class: 'code-partage', placeholder: 'Code reçu',
    autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    'aria-label': 'Code de la cave à rejoindre',
  });

  // Créer un partage publie la cave de cet appareil, ce qu'on veut en reliant
  // un deuxième téléphone. Sur un appareil déjà garni, le bouton seul ne le
  // disait pas, et on pouvait croire repartir de rien tout en emportant tout.
  const garnie = store.vins().length + store.degustations().length;

  return el('div', { class: 'partage-code' }, [
    garnie
      ? el('div', {}, [
        el('p', {
          class: 'discret',
          text: `Cet appareil contient ${garnie} fiche${garnie > 1 ? 's' : ''}. `
            + 'Choisissez ce que devient la cave partagée que vous créez.',
        }),
        el('div', { class: 'rangee-boutons' }, [
          bouton('Y publier cette cave', {
            classe: 'bouton bouton-primaire',
            onclick: () => store.definirCodePartage(store.inventerCode()),
          }),
          bouton('Créer une cave vide', {
            onclick: async () => {
              const accord = await confirmer(
                'Créer une cave vide',
                `Les ${garnie} fiches de cet appareil ne seront pas reprises. `
                  + 'Si elles ne sont que là, exportez une sauvegarde d’abord.',
                { libelleAction: 'Créer une cave vide' },
              );
              if (accord) store.demarrerCaveVide(store.inventerCode());
            },
          }),
        ]),
      ])
      : el('div', { class: 'rangee-boutons' }, [
        bouton('Créer une cave partagée', {
          classe: 'bouton bouton-primaire',
          onclick: () => store.definirCodePartage(store.inventerCode()),
        }),
      ]),
    el('p', {
      class: 'discret',
      text: 'Ou rejoignez celle qui existe déjà, avec le code affiché sur '
        + 'l’autre téléphone.',
    }),
    saisie,
    el('div', { class: 'rangee-boutons' }, [
      bouton('Rejoindre', {
        onclick: () => {
          const valeur = saisie.value.trim();
          if (!valeur) {
            message('Saisissez le code de la cave', 'erreur');
            return;
          }
          store.definirCodePartage(valeur);
        },
      }),
    ]),
  ]);
}

function codeEnPlace(actuel) {
  const champ = el('input', {
    type: 'text', class: 'code-partage', value: actuel, readonly: true,
    'aria-label': 'Code de la cave partagée',
  });
  champ.addEventListener('focus', () => champ.select());

  return el('div', { class: 'partage-code' }, [
    el('p', {
      class: 'discret',
      text: 'Recopiez ce code sur l’autre téléphone pour qu’il rejoigne cette '
        + 'cave. Ne le communiquez à personne d’autre : il donne accès à la '
        + 'cave entière.',
    }),
    champ,
    el('div', { class: 'rangee-boutons' }, [
      bouton('Copier le code', {
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(actuel);
            message('Code copié');
          } catch {
            champ.focus();
            message('Sélectionnez et copiez le code affiché');
          }
        },
      }),
      bouton('Quitter cette cave partagée', {
        classe: 'bouton bouton-danger-discret',
        onclick: async () => {
          const accord = await confirmer(
            'Quitter la cave partagée',
            'Cet appareil ne recevra plus les modifications des autres. La '
              + 'cave reste ici, et le partage continue sans lui.',
            { libelleAction: 'Quitter', danger: true },
          );
          if (accord) store.definirCodePartage('');
        },
      }),
    ]),
  ]);
}

/**
 * Ce que l'application voit de son hébergeur, en quatre lignes.
 *
 * Quand la synchronisation ne s'établit pas sur un appareil et pas sur un
 * autre, la cause est invisible depuis l'écran : version restée en cache,
 * pont absent, autorisation jamais demandée. Ces lignes se photographient et
 * disent laquelle, au lieu de laisser essayer au hasard.
 */
function diagnostic() {
  const valeurs = {};
  const ligne = (libelle, cle) => {
    valeurs[cle] = el('dd', { text: '…' });
    return [el('dt', { text: libelle }), valeurs[cle]];
  };

  const bloc = el('details', { class: 'diagnostic' }, [
    el('summary', { text: 'Détails techniques' }),
    el('dl', { class: 'definitions' }, [
      ...ligne('Version de l’application', 'version'),
      ...ligne('Pont de la plateforme', 'pont'),
      ...ligne('Autorisation des données', 'autorisation'),
      ...ligne('Espace partagé', 'espace'),
    ]),
  ]);

  const use = globalThis.claude?.use;
  valeurs.version.textContent = store.VERSION_APP;
  valeurs.pont.textContent = typeof use === 'function' ? 'présent' : 'absent';
  valeurs.espace.textContent = store.partageBranche() ? 'ouvert' : 'fermé';

  if (typeof use !== 'function') {
    valeurs.autorisation.textContent = 'sans objet';
    return bloc;
  }
  Promise.resolve(use('permissions'))
    .then((permissions) => permissions?.state('db'))
    .then((etat) => { valeurs.autorisation.textContent = AUTORISATIONS[etat] || 'inconnue'; })
    .catch(() => { valeurs.autorisation.textContent = 'illisible'; });
  return bloc;
}

function dateLisible(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('fr-CH', { dateStyle: 'long', timeStyle: 'short' });
}
