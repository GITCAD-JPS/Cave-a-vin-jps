// Parcours photo : ajouter un vin, ou signaler une bouteille bue, en
// partant de l'appareil photo du téléphone.
//
// La photo est le point de départ. La lecture de l'étiquette n'est qu'une
// aide : elle propose des candidats et préremplit des champs, et tout reste
// modifiable. Quand la lecture échoue, le parcours continue sans elle.

import { bouton, dialogue, el, icone, message, pluriel, vider } from '../dom.js';
import { pastillesLignes, sousTitre, vignette } from '../composants.js';
import {
  extraireChamps, lectureIndisponible, lireEtiquette, nomProbable, raisonDuRepli, rapprocher,
} from '../etiquette.js';
import { analyserDictee } from '../dictee.js';
import { dialogueMiseAPlat } from '../mise-a-plat.js';
import { dialogueAjouterBouteilles, dialogueBoire, formulaireVin } from '../formulaires.js';
import { filtrerVins } from '../model.js';
import * as photos from '../photos.js';
import * as store from '../store.js';

const MODES = {
  boire: {
    titre: "J'ai bu une bouteille",
    aide: "Photographiez la bouteille, l'application cherche laquelle c'est dans votre cave.",
    action: 'Photographier la bouteille',
  },
  ajout: {
    titre: 'Ajouter un vin',
    aide: "Photographiez l'étiquette, les informations lisibles sont reprises automatiquement.",
    action: "Photographier l'étiquette",
  },
};

// L'état vit entre deux rendus : repasser par la vue ne fait pas reprendre
// la photo depuis zéro.
let etat = null;

function reinitialiser(mode) {
  etat = {
    mode, lecture: null, champs: null, etape: 'photo', abandon: false,
    refusGoogle: '',
    dictee: null,
    // Les deux faces de la bouteille. L'avant suffit, l'arrière est un plus
    // que l'on propose sans jamais l'imposer.
    avant: { cle: '', apercu: '', origine: null },
    arriere: { cle: '', apercu: '', origine: null },
  };
}

export function rendre(conteneur, { naviguer, params }) {
  const mode = MODES[params.mode] ? params.mode : 'ajout';
  if (!etat || etat.mode !== mode) reinitialiser(mode);

  vider(conteneur);
  conteneur.append(el('div', { class: 'vue-photo' }, [
    el('header', { class: 'fiche-entete' }, [
      bouton('Retour', {
        icone: 'retour',
        classe: 'bouton bouton-retour',
        onclick: () => { etat = null; naviguer('/cave'); },
      }),
      el('h1', { text: MODES[mode].titre }),
      el('p', { class: 'discret', text: MODES[mode].aide }),
    ]),
    zonePhoto(naviguer),
    zoneResultats(naviguer),
  ]));
}

// --- prise de vue -----------------------------------------------------------

const CONSEIL_CADRAGE = "Cadrez l'étiquette seule, de face et bien éclairée. "
  + 'Une bouteille entière photographiée de loin se lit mal.';

const CONSEIL_ARRIERE = 'Le nom du domaine est souvent écrit en arc de cercle devant, '
  + "ce qui se lit mal. L'arrière le répète en petites lettres droites, avec le degré "
  + 'et le volume.';

/**
 * Un bouton qui ouvre l'appareil photo ou la photothèque pour une face donnée.
 *
 * Deux entrées distinctes sont nécessaires : « capture » ouvre directement
 * l'appareil photo sur téléphone, son absence laisse choisir dans la
 * photothèque. Une seule entrée ne peut pas offrir les deux.
 */
function entreePhoto({
  id, libelle, nomIcone, classe, appareil, face, naviguer, plusieurs = false,
}) {
  const entree = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: appareil ? 'environment' : null,
    // Dans la photothèque on choisit les deux faces d'un coup. L'appareil
    // photo, lui, ne rend qu'un cliché à la fois.
    multiple: plusieurs ? '' : null,
    class: 'visuellement-cache',
    id,
  });
  entree.addEventListener('change', async () => {
    const fichiers = [...(entree.files || [])];
    entree.value = '';
    if (!fichiers.length) return;
    // La première image choisie est l'avant, la seconde l'arrière. Au-delà
    // de deux il n'y a rien à en faire : les suivantes sont ignorées, et on
    // le dit plutôt que de les perdre en silence.
    const lots = face === 'avant' && plusieurs && fichiers.length > 1
      ? [['avant', fichiers[0]], ['arriere', fichiers[1]]]
      : [[face, fichiers[0]]];
    if (fichiers.length > lots.length) {
      message(`${fichiers.length} photos choisies, les deux premières sont retenues`);
    }
    await traiterPhotos(lots, naviguer);
  });
  const declencheur = el('label', { class: `bouton ${classe} bouton-photo`, for: id });
  declencheur.append(icone(nomIcone), el('span', { text: libelle }));
  return [declencheur, entree];
}

/** L'aperçu d'une face déjà prise, avec de quoi la retirer si elle est en trop. */
function facePrise(face, libelle, naviguer) {
  const morceaux = [
    el('img', { src: etat[face].apercu, alt: libelle }),
    el('span', { class: 'discret', text: libelle }),
    bouton(etat[face].aplatie ? 'Remettre à plat' : 'Mettre à plat', {
      classe: 'bouton bouton-discret',
      onclick: () => dialogueAplatir(face, libelle, naviguer),
    }),
  ];
  if (face === 'arriere') {
    morceaux.push(el('button', {
      type: 'button', class: 'bouton-lien', text: 'Retirer',
      onclick: () => {
        etat.arriere = { cle: '', apercu: '', origine: null };
        naviguer(null);
      },
    }));
  }
  return el('div', { class: 'photo-face' }, morceaux);
}

const AIDE_SCANNER = 'Appuyez longuement dans le cadre vide ci-dessous, choisissez '
  + '« Scanner du texte », puis visez l’étiquette. L’iPhone y écrit ce qu’il lit. '
  + 'Vous pouvez aussi coller un texte copié depuis Photos, ou le taper.';

/**
 * Laisse l'iPhone lire l'étiquette à notre place.
 *
 * Le moteur embarqué bute sur un nom écrit en arc de cercle, et le service de
 * Google demande une clé, un compte et une facturation. Or le téléphone sait
 * déjà très bien lire une étiquette : depuis n'importe quel champ de texte,
 * « Scanner du texte » vise l'appareil photo et écrit ce qu'il reconnaît.
 * Rien à installer, rien à payer, et rien ne quitte l'appareil.
 */
/**
 * Montre le texte brut de la lecture.
 *
 * Sans cela, une mauvaise fiche ne dit pas où est la faute : dans ce que le
 * service a lu, ou dans ce que l'application en tire. Le texte se copie, pour
 * pouvoir être montré.
 */
const AIDE_DICTEE = 'Appuyez sur le micro du clavier, puis dites la fiche d’un trait : '
  + 'le nom, le millésime, la couleur, le degré, le nombre de bouteilles et où '
  + 'elles vont. L’ordre est libre.';

const EXEMPLE_DICTEE = 'Bolgheri Sabbiato de Sensi, région Toscane, 2021, rouge, '
  + '14 degrés 5, deux bouteilles dans l’armoire';

/** Ce que la dictée a compris, dit en clair avant de remplir quoi que ce soit. */
function resumerDictee(dit) {
  const LIBELLES = {
    nom: 'nom', producteur: 'producteur', region: 'région', cepage: 'cépage',
    couleur: 'couleur', millesime: 'millésime', degre: 'degré', volume: 'volume',
    quantite: 'bouteilles', emplacement: 'rangement', source: 'acheté chez',
    emplacementPrecis: 'emplacement', note: 'note',
  };
  const RANGEMENTS = { armoire: 'armoire', caveDroite: 'cave droite', caveGauche: 'cave gauche' };
  return Object.entries(LIBELLES)
    .filter(([cle]) => dit[cle] !== undefined && dit[cle] !== '')
    .map(([cle, libelle]) => {
      const valeur = cle === 'emplacement' ? RANGEMENTS[dit[cle]] || dit[cle]
        : cle === 'degre' ? String(dit[cle]).replace('.', ',')
          : dit[cle];
      return `${libelle} ${valeur}`;
    });
}

/**
 * Dicter la fiche plutôt que la taper.
 *
 * L'iPhone écrit déjà sous la dictée : le micro du clavier suffit, et rien
 * n'est à installer ni à autoriser. Ce qui manquait était de répartir la
 * phrase dans les champs, ce dont `analyserDictee` se charge.
 */
function dialogueDictee(naviguer) {
  dialogue('Dicter la fiche', (fermer) => {
    const zone = el('textarea', {
      rows: '5', class: 'texte-etiquette',
      placeholder: EXEMPLE_DICTEE,
      'aria-label': 'Fiche dictée',
    });
    const apercu = el('p', { class: 'discret' });
    const rafraichir = () => {
      const dit = zone.value.trim() ? analyserDictee(zone.value) : {};
      const lu = resumerDictee(dit);
      apercu.textContent = lu.length ? `Compris : ${lu.join(', ')}` : '';
    };
    zone.addEventListener('input', rafraichir);

    return [
      el('p', { class: 'discret', text: AIDE_DICTEE }),
      zone,
      apercu,
      el('div', { class: 'formulaire-actions' }, [
        bouton('Annuler', { classe: 'bouton', onclick: fermer }),
        bouton('Reprendre', {
          classe: 'bouton bouton-primaire',
          onclick: () => {
            const dit = analyserDictee(zone.value);
            if (!Object.keys(dit).length) {
              message('Rien à reprendre : le cadre est vide');
              return;
            }
            etat.dictee = dit;
            // La fiche dictée est prête à créer. Si l'étiquette n'a pas encore
            // été lue, sa lecture reste proposée à côté : dicter la complète,
            // ne la remplace pas.
            if (etat.etape !== 'lecture') etat.etape = 'resultats';
            fermer();
            naviguer(null);
          },
        }),
      ]),
    ];
  }, { largeur: '34rem' });
}

/**
 * Mettre à plat une face de la bouteille en cours d'ajout.
 *
 * On repart toujours de la photo prise, jamais d'une étiquette déjà redressée :
 * la redresser une seconde fois la déformerait.
 */
function dialogueAplatir(face, libelle, naviguer) {
  const prise = etat[face].avantAplat || { cle: etat[face].cle, origine: etat[face].origine };
  dialogueMiseAPlat({
    titre: `Mettre à plat — ${libelle.toLowerCase()}`,
    libelle,
    charger: async () => prise.origine || photos.lire(prise.cle),
    onGarder: async (blob) => {
      const cle = await photos.enregistrer(blob);
      // La photo prise reste attachée à la face : elle part avec l'étiquette à
      // plat à la lecture, où ce que l'une a rogné l'autre le porte encore, et
      // elle est gardée sur la fiche.
      etat[face] = {
        cle, origine: blob, apercu: await photos.url(cle), aplatie: true, avantAplat: prise,
      };
      // Une lecture déjà faite portait sur la photo d'avant : la refaire sur
      // l'étiquette redressée, puisque c'est elle qu'on garde.
      if (etat.lecture && !etat.lecture.saisi) {
        message('Étiquette mise à plat, relecture en cours');
        await lancerLecture(naviguer);
        return;
      }
      message('Étiquette mise à plat');
      // Sans lecture encore faite, on revient là où elle se propose.
      if (etat.etape === 'resultats' && !etat.champs) etat.etape = 'proposition';
      naviguer(null);
    },
  });
}

function dialogueTexteLu() {
  const brut = etat.lecture?.texte || '';
  dialogue('Texte lu sur l’étiquette', (fermer) => {
    const zone = el('textarea', {
      rows: '12', class: 'texte-etiquette', readonly: 'readonly',
      'aria-label': 'Texte brut de la lecture',
    }, brut);
    return [
      el('p', {
        class: 'discret',
        text: etat.lecture?.parGoogle
          ? 'Voici exactement ce que le service de Google a lu.'
          : 'Voici exactement ce que la lecture a rendu.',
      }),
      zone,
      el('div', { class: 'formulaire-actions' }, [
        bouton('Fermer', { classe: 'bouton', onclick: fermer }),
        bouton('Copier le texte', {
          classe: 'bouton bouton-primaire',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(brut);
              message('Texte copié');
            } catch {
              zone.removeAttribute('readonly');
              zone.select();
              message('Sélectionnez et copiez le texte affiché');
            }
          },
        }),
      ]),
    ];
  }, { largeur: '34rem' });
}

function dialogueTexteEtiquette(naviguer) {
  dialogue('Texte de l’étiquette', (fermer) => {
    // Le cadre s'ouvre vide, toujours : l'iPhone ne propose « Scanner du
    // texte » que là où il n'y a rien à sélectionner. Prérempli, fût-ce par
    // une lecture ratée, l'appui long n'offre plus que Couper / Copier, et
    // l'option recherchée disparaît.
    const zone = el('textarea', {
      rows: '7',
      class: 'texte-etiquette',
      placeholder: 'Nom du domaine, appellation, millésime…',
      'aria-label': 'Texte lu sur l’étiquette',
    });

    const precedent = etat.lecture?.texte?.trim() || '';
    const reprise = precedent ? bouton('Repartir de la lecture précédente', {
      classe: 'bouton bouton-discret',
      onclick: () => {
        zone.value = precedent;
        zone.focus();
      },
    }) : null;

    const valider = () => {
      const texte = zone.value.trim();
      if (!texte) {
        message('Rien à reprendre : le cadre est vide');
        return;
      }
      etat.lecture = { texte, confiance: 95, parGoogle: false, saisi: true };
      etat.champs = extraireChamps(texte);
      etat.etape = 'resultats';
      fermer();
      naviguer(null);
    };

    return [
      el('p', { class: 'discret', text: AIDE_SCANNER }),
      zone,
      ...(reprise ? [reprise] : []),
      el('div', { class: 'formulaire-actions' }, [
        bouton('Annuler', { classe: 'bouton', onclick: fermer }),
        bouton('Reprendre ce texte', { classe: 'bouton bouton-primaire', onclick: valider }),
      ]),
    ];
  }, { largeur: '34rem' });
}

/**
 * Qui a lu l'étiquette, et comment faire mieux.
 *
 * Savoir d'où vient le texte change tout le jugement qu'on porte sur lui : le
 * moteur embarqué bute sur un nom écrit en arc de cercle, l'iPhone non. Sans
 * cette ligne on croit l'application mauvaise là où c'est le lecteur.
 */
function noticeDeLecture(naviguer) {
  if (etat.etape !== 'resultats' || !etat.lecture) return null;
  if (etat.lecture.saisi) {
    return el('div', { class: 'notice-lecture' }, [
      el('p', { class: 'discret', text: 'Texte lu par votre iPhone.' }),
      bouton('Corriger le texte', {
        classe: 'bouton bouton-discret',
        onclick: () => dialogueTexteEtiquette(naviguer),
      }),
    ]);
  }
  return el('div', { class: 'notice-lecture' }, [
    etat.lecture.parGoogle
      ? el('p', { class: 'discret', text: 'Lu par le service de Google.' })
      : el('p', { class: 'discret' }, etat.refusGoogle
        ? [
          el('span', {
            text: `Google a refusé la lecture (${etat.refusGoogle}), c'est le moteur `
              + 'embarqué qui a lu, et il déchiffre mal un nom en arc de cercle. ',
          }),
          el('button', {
            type: 'button', class: 'bouton-lien', text: 'Vérifier la clé',
            onclick: () => naviguer('/reglages'),
          }),
        ]
        : [
          el('span', { text: 'Lu par le moteur embarqué, qui déchiffre mal un nom écrit en arc de cercle. ' }),
          el('button', {
            type: 'button', class: 'bouton-lien', text: 'Activer la lecture améliorée',
            onclick: () => naviguer('/reglages'),
          }),
        ]),
    el('div', { class: 'rangee-boutons' }, [
      bouton('Voir le texte lu', {
        classe: 'bouton bouton-discret',
        onclick: () => dialogueTexteLu(),
      }),
      // Une mauvaise lecture ne doit pas être une impasse : l'iPhone sait faire
      // mieux, et c'est deux gestes.
      bouton('Scanner le texte avec l’iPhone', {
        classe: 'bouton bouton-discret',
        onclick: () => dialogueTexteEtiquette(naviguer),
      }),
    ]),
  ]);
}

function zonePhoto(naviguer) {
  const bloc = el('section', { class: 'bloc bloc-photo' });

  if (!etat.avant.apercu) {
    // Deux entrées distinctes : « capture » ouvre directement l'appareil photo
    // sur téléphone, son absence laisse choisir dans la photothèque. Une seule
    // entrée ne peut pas offrir les deux.
    const source = (id, libelle, nomIcone, classe, appareil) => entreePhoto({
      id, libelle, nomIcone, classe, appareil, face: 'avant', naviguer,
      plusieurs: !appareil,
    });

    bloc.append(
      // Ce qui fait échouer la lecture d'une étiquette n'est presque jamais le
      // téléphone : c'est le cadrage. Mesuré sur un lot de photos, une
      // étiquette cadrée de près rend neuf mots sur neuf, la même étiquette sur
      // une bouteille entière prise d'un mètre en rend six.
      el('p', { class: 'discret conseil-cadrage', text: CONSEIL_CADRAGE }),
      ...source('prise-de-vue', MODES[etat.mode].action, 'appareil', 'bouton-primaire', true),
      ...source('choix-photo', 'Choisir une ou deux photos', 'image', '', false),
      bouton('Scanner le texte avec l’iPhone', {
        icone: 'image',
        classe: 'bouton bouton-photo',
        onclick: () => dialogueTexteEtiquette(naviguer),
      }),
      bouton('Dicter la fiche', {
        classe: 'bouton bouton-photo',
        onclick: () => dialogueDictee(naviguer),
      }),
      el('p', {
        class: 'discret conseil-cadrage',
        text: 'Dans la photothèque, touchez l’avant puis l’arrière : les deux seront lues ensemble.',
      }),
      el('button', {
        type: 'button', class: 'bouton-lien', text: 'Continuer sans photo',
        onclick: () => { etat.etape = 'resultats'; naviguer(null); },
      }),
      noticeDeLecture(naviguer),
    );
    return bloc;
  }

  const faces = [facePrise('avant', 'Étiquette avant', naviguer)];
  if (etat.arriere.apercu) faces.push(facePrise('arriere', 'Étiquette arrière', naviguer));

  bloc.append(
    el('div', { class: `photo-prise${faces.length > 1 ? ' photo-prise-deux' : ''}` }, [
      el('div', { class: 'photo-faces' }, faces),
      el('div', { class: 'photo-prise-actions' }, [
        // L'ordre des deux faces vient de l'ordre où on les a touchées dans la
        // photothèque, qu'on peut avoir inversé sans y penser. Les échanger
        // vaut mieux que tout reprendre.
        faces.length > 1
          ? bouton('Échanger avant et arrière', {
            onclick: () => {
              const permute = etat.avant;
              etat.avant = etat.arriere;
              etat.arriere = permute;
              naviguer(null);
            },
          })
          : null,
        bouton('Tout reprendre', {
          icone: 'appareil',
          onclick: () => { reinitialiser(etat.mode); naviguer(null); },
        }),
        // Une étiquette ne dit ni combien de bouteilles ont été achetées ni où
        // elles vont : cela se dicte, et c'est ici qu'on y pense.
        bouton(etat.dictee ? 'Reprendre la dictée' : 'Dicter la fiche', {
          onclick: () => dialogueDictee(naviguer),
        }),
      ]),
    ]),
  );

  // La lecture de l'étiquette télécharge un moteur de reconnaissance de
  // plusieurs méga-octets la première fois. On ne l'impose pas : l'utilisateur
  // décide, puis le choix est retenu.
  // Proposée aussi tant qu'aucune lecture n'a eu lieu : après une dictée, ou
  // après avoir continué sans lire, on doit pouvoir y revenir.
  const pasEncoreLue = etat.etape === 'resultats' && !etat.lecture && Boolean(etat.avant.cle);
  if (pasEncoreLue) {
    bloc.append(bouton(etat.arriere.cle ? 'Lire les deux étiquettes' : "Lire l'étiquette", {
      icone: 'appareil',
      classe: 'bouton',
      onclick: () => lancerLecture(naviguer),
    }));
  }
  if (etat.etape === 'proposition') {
    bloc.append(
      bouton(etat.arriere.cle ? 'Lire les deux étiquettes' : "Lire l'étiquette", {
        icone: 'appareil',
        classe: 'bouton bouton-primaire bouton-large',
        onclick: () => lancerLecture(naviguer),
      }),
      el('p', {
        class: 'discret',
        text: 'La reconnaissance se fait dans le téléphone, rien n’est envoyé en ligne. '
          + 'Le moteur pèse une dizaine de méga-octets : il est chargé à la première '
          + 'lecture, puis gardé en cache, y compris hors ligne.',
      }),
      el('button', {
        type: 'button', class: 'bouton-lien', text: 'Continuer sans lire',
        onclick: () => { etat.etape = 'resultats'; naviguer(null); },
      }),
    );
  }

  // Savoir qui a lu change tout le jugement qu'on porte sur le résultat : le
  // moteur embarqué bute sur un nom écrit en arc de cercle, le service de
  // Google le redresse. Sans cette ligne, on croit l'application mauvaise là
  // où c'est seulement la clé qui manque.
  bloc.append(noticeDeLecture(naviguer));

  // Le nom du domaine est souvent écrit en arc de cercle sur la face avant, ce
  // que le moteur lit très mal. La contre-étiquette répète les mêmes mots en
  // petit et bien droit, avec le degré et le volume en prime. L'offre reste
  // donc accessible même après une lecture : dès qu'une première étiquette a
  // été lue, l'application enchaîne toute seule et ne laisserait plus le temps
  // de la proposer.
  if (!etat.arriere.cle && etat.etape !== 'lecture') {
    const relire = etat.etape === 'resultats' && !etat.abandon;
    bloc.append(
      ...entreePhoto({
        id: 'prise-arriere',
        libelle: relire ? "Ajouter l'étiquette arrière et relire" : "Ajouter l'étiquette arrière",
        nomIcone: 'appareil',
        classe: '',
        appareil: true,
        face: 'arriere',
        naviguer,
      }),
      el('p', { class: 'discret conseil-cadrage', text: CONSEIL_ARRIERE }),
    );
  }

  if (etat.etape === 'lecture') {
    const demarre = (etat.progres || 0) > 0;
    bloc.append(el('div', { class: 'progression' }, [
      el('p', {
        class: 'discret',
        text: demarre ? "Lecture de l'étiquette…" : 'Préparation du moteur de lecture…',
      }),
      el('div', { class: `progression-piste${demarre ? '' : ' indeterminee'}` }, [
        el('div', {
          class: 'progression-valeur',
          style: `width:${Math.round((etat.progres || 0) * 100)}%`,
        }),
      ]),
      // Attendre sans pouvoir renoncer est insupportable : on garde la main.
      el('button', {
        type: 'button', class: 'bouton-lien', text: 'Passer et choisir à la main',
        onclick: () => { etat.abandon = true; etat.etape = 'resultats'; naviguer(null); },
      }),
    ]));
  }
  return bloc;
}

/** Range une face dans l'état. Rend vrai si la photo a bien été gardée. */
async function rangerPhoto(face, fichier) {
  try {
    // La photo gardée dans la cave est réduite : c'est ce qu'il faut pour la
    // consulter, c'est trop peu pour lire une étiquette. On retient donc le
    // fichier tel que l'appareil l'a rendu, le temps de ce parcours.
    const cle = await photos.enregistrer(fichier);
    etat[face] = { cle, origine: fichier, apercu: await photos.url(cle) };
    return true;
  } catch (erreur) {
    console.error(erreur);
    const raison = erreur?.name === 'NotReadableError' ? 'fichier illisible'
      : erreur?.message || 'raison inconnue';
    message(`Photo non enregistrée : ${raison}`, 'erreur');
    return false;
  }
}

/**
 * Range une ou deux faces, puis enchaîne une seule fois.
 *
 * Deux photos choisies ensemble ne doivent déclencher qu'une lecture, et une
 * seule navigation : les traiter l'une après l'autre en relançant tout à
 * chaque fois lirait l'avant seul avant même que l'arrière soit rangé.
 */
async function traiterPhotos(lots, naviguer) {
  let rangee = false;
  for (const [face, fichier] of lots) {
    if (await rangerPhoto(face, fichier)) rangee = true;
  }
  if (!rangee) return;

  if (photos.enMemoire()) {
    message('Photos gardées le temps de la session : ce navigateur refuse le stockage durable');
  }
  // Inutile de reproposer une lecture dont on sait qu'elle ne marche pas ici.
  // Sauf avec une clé Google : sa lecture ne dépend pas du moteur embarqué
  // qui a fait défaut.
  if (lectureIndisponible() && !store.preferences().cleVision) {
    etat.etape = 'resultats';
    naviguer(null);
    return;
  }
  if (store.preferences().lectureAuto) {
    await lancerLecture(naviguer);
    return;
  }
  etat.etape = 'proposition';
  naviguer(null);
}

async function lancerLecture(naviguer) {
  // La lecture appartient au parcours qui l'a demandée. Celui-ci peut être
  // quitté (Retour), recommencé (Tout reprendre) ou laissé de côté (Passer)
  // pendant qu'elle tourne : elle ne touche alors plus à rien. Le jeton écarte
  // aussi une lecture ancienne que l'on aurait relancée entre-temps.
  const moi = etat;
  const jeton = (moi.jetonLecture || 0) + 1;
  moi.jetonLecture = jeton;
  moi.abandon = false;
  moi.etape = 'lecture';
  moi.progres = 0;
  naviguer(null);
  const encoreAttendue = () => etat === moi && moi.jetonLecture === jeton && !moi.abandon;

  // La photo d'origine porte bien plus de détail que la copie gardée en cave,
  // et c'est ce détail qui fait la différence sur une étiquette. Le repli sur
  // la copie ne sert pas aujourd'hui : il évite qu'une lecture devienne
  // muette si ce parcours venait à changer.
  const blobs = [];
  for (const face of ['avant', 'arriere']) {
    if (!moi[face].cle && !moi[face].origine) continue;
    const blob = moi[face].origine
      || await photos.lire(moi[face].cle).catch(() => null);
    if (blob) blobs.push(blob);
    // Une face redressée part avec la photo dont elle vient : si la mise à
    // plat a rogné un mot, l'autre image le porte encore.
    const avant = moi[face].avantAplat;
    if (!avant) continue;
    const brut = avant.origine || await photos.lire(avant.cle).catch(() => null);
    if (brut) blobs.push(brut);
  }
  const cleVision = store.preferences().cleVision || '';
  const lecture = blobs.length
    ? await lireEtiquette(blobs, {
      cleVision,
      onProgres: (p) => {
        if (!encoreAttendue()) return;
        moi.progres = p;
        const barre = document.querySelector('.progression-valeur');
        if (barre) barre.style.width = `${Math.round(p * 100)}%`;
      },
    })
    : null;

  // L'utilisateur a pu renoncer pendant que le moteur cherchait ses morceaux.
  if (!encoreAttendue()) return;

  if (lecture) {
    // Un repli silencieux laisserait croire que la lecture améliorée
    // fonctionne alors qu'elle est refusée. On le dit, une fois.
    if (cleVision && !lecture.parGoogle) {
      const raison = raisonDuRepli();
      // Retenue, pas seulement annoncée : un message qui passe laisse croire
      // à une lecture améliorée qui n'a pas eu lieu.
      moi.refusGoogle = raison || 'raison inconnue';
      message(`Lecture améliorée indisponible${raison ? ` : ${raison}` : ''}`, 'erreur');
    } else if (!store.preferences().lectureAuto) {
      // Le moteur a répondu : les prochaines photos seront lues sans demander.
      store.enregistrerPreferences({ lectureAuto: true });
      message('Étiquette lue. Les prochaines photos le seront automatiquement.');
    }
  } else {
    // Ne pas réessayer automatiquement ce qui vient d'échouer.
    if (store.preferences().lectureAuto) store.enregistrerPreferences({ lectureAuto: false });
    message("La lecture d'étiquette n'est pas disponible ici, choisissez à la main", 'erreur');
  }

  moi.lecture = lecture;
  moi.champs = lecture ? extraireChamps(lecture.texte) : null;
  moi.etape = 'resultats';
  naviguer(null);
}

// --- résultats --------------------------------------------------------------

function zoneResultats(naviguer) {
  if (etat.etape !== 'resultats') return null;
  return etat.mode === 'boire' ? resultatsBoire(naviguer) : resultatsAjout(naviguer);
}

function candidats(seulementEnCave) {
  if (!etat.lecture?.texte) return [];
  const source = seulementEnCave
    ? store.vins().filter((v) => v.statut === 'en-cave' && v.quantite > 0)
    : store.vins();
  return rapprocher(etat.lecture.texte, source, { millesime: etat.champs?.millesime });
}

function resultatsBoire(naviguer) {
  const trouves = candidats(true);
  const bloc = el('section', { class: 'bloc' });

  bloc.append(el('div', { class: 'bloc-entete' }, [
    el('h2', { text: trouves.length ? 'Est-ce ce vin ?' : 'Choisissez la bouteille' }),
  ]));

  if (trouves.length) {
    bloc.append(el('div', { class: 'liste-candidats' }, trouves.map((c) => carteCandidat(c, {
      libelleAction: 'Bouteille bue',
      onChoisir: (vin) => ouvrirBoire(vin, naviguer),
    }))));
    bloc.append(el('p', { class: 'discret', text: 'Aucun ne correspond ? Cherchez ci-dessous.' }));
  } else if (etat.lecture) {
    bloc.append(el('p', {
      class: 'discret',
      text: "L'étiquette n'a pas permis de reconnaître un vin de la cave. Cherchez-le à la main.",
    }));
  }

  bloc.append(rechercheManuelle('en-cave', (vin) => ouvrirBoire(vin, naviguer)));
  return bloc;
}

function ouvrirBoire(vin, naviguer) {
  dialogueBoire(vin, {
    photoLocale: etat.avant.cle,
    onFait: () => { etat = null; naviguer('/degustations'); },
  });
}

function resultatsAjout(naviguer) {
  const trouves = candidats(false);
  const fragments = [];

  if (trouves.length) {
    fragments.push(el('section', { class: 'bloc' }, [
      el('div', { class: 'bloc-entete' }, [el('h2', { text: 'Ce vin est peut-être déjà en cave' })]),
      el('p', {
        class: 'discret',
        text: 'Ajoutez une bouteille à une fiche existante plutôt que de créer un doublon.',
      }),
      el('div', { class: 'liste-candidats' }, trouves.map((c) => carteCandidat(c, {
        libelleAction: 'Ajouter une bouteille',
        onChoisir: (vin) => dialogueAjouterBouteilles(vin, {
          onFait: () => { etat = null; naviguer(`/vin/${vin.id}`); },
        }),
      }))),
    ]));
  }

  fragments.push(blocNouvelleFiche(naviguer));
  return el('div', {}, fragments);
}

function blocNouvelleFiche(naviguer) {
  const champs = etat.champs || {};
  // Ce qui a été dicté l'a été exprès, et passe donc devant ce qui a été
  // deviné sur l'étiquette.
  const dit = etat.dictee || {};
  const brouillon = {
    photoLocale: etat.avant.cle,
    photoArriere: etat.arriere.cle,
    // Les photos telles que prises, quand l'étiquette a été mise à plat.
    photoOriginale: etat.avant.avantAplat?.cle || '',
    photoArriereOriginale: etat.arriere.avantAplat?.cle || '',
    millesime: dit.millesime ?? champs.millesime ?? null,
    degre: dit.degre ?? champs.degre ?? null,
    volume: dit.volume || champs.volume || '75 cl',
    region: dit.region || champs.region || '',
    cepage: dit.cepage || champs.cepage || '',
    nom: dit.nom || nomProbable(champs.lignes || [], { saufAppellation: champs.region || '' }),
  };
  for (const cle of ['producteur', 'couleur', 'note', 'source', 'emplacementPrecis']) {
    if (dit[cle]) brouillon[cle] = dit[cle];
  }
  if (dit.quantite !== undefined) brouillon.quantite = dit.quantite;
  // Dire « deux bouteilles dans l'armoire » range les deux, sans quoi le
  // compte serait juste et la cave vide.
  if (dit.emplacement) brouillon.emplacements = { [dit.emplacement]: dit.quantite ?? 1 };

  // Ce qui a été dit et ce qui a été lu restent distincts : l'un est sûr,
  // l'autre est à vérifier.
  const dicte = resumerDictee(dit);
  const lu = [];
  if (!dit.millesime && champs.millesime) lu.push(`millésime ${champs.millesime}`);
  if (!dit.degre && champs.degre) lu.push(`${String(champs.degre).replace('.', ',')} %`);
  if (!dit.volume && champs.volume) lu.push(champs.volume);
  if (!dit.region && champs.region) lu.push(champs.region);
  if (!dit.cepage && champs.cepage) lu.push(champs.cepage);
  const resume = [
    dicte.length ? `Dicté : ${dicte.join(', ')}` : '',
    lu.length ? `Lu sur l'étiquette : ${lu.join(', ')}` : '',
  ].filter(Boolean);

  return el('section', { class: 'bloc' }, [
    el('div', { class: 'bloc-entete' }, [el('h2', { text: 'Nouvelle fiche' })]),
    resume.length
      ? el('p', { class: 'discret', text: `${resume.join('. ')}.` })
      : el('p', {
        class: 'discret',
        text: etat.lecture
          ? "Rien de sûr n'a pu être lu sur l'étiquette, les champs sont à remplir."
          : 'Les champs sont à remplir à la main, ou à dicter.',
      }),
    bouton('Créer la fiche', {
      icone: 'plus',
      classe: 'bouton bouton-primaire',
      onclick: () => ouvrirCreation(brouillon, champs.lignes || [], naviguer),
    }),
  ]);
}

function ouvrirCreation(brouillon, lignes, naviguer) {
  dialogue('Nouvelle fiche', (fermer) => {
    const formulaire = formulaireVin(null, {
      brouillon,
      onEnregistre: (vin) => {
        fermer();
        if (vin) { etat = null; naviguer(`/vin/${vin.id}`); }
      },
    });
    if (lignes.length) formulaire.prepend(pastillesLignes(lignes, formulaire));
    return formulaire;
  }, { largeur: '44rem' });
}

/**
 * Lignes lues sur l'étiquette, cliquables : elles remplissent le dernier champ
 * texte touché, le nom par défaut. Plus rapide que de tout retaper.
 */
// --- éléments partagés ------------------------------------------------------

function carteCandidat({ vin, score }, { libelleAction, onChoisir }) {
  return el('article', { class: 'candidat' }, [
    vignette(vin, { taille: 'petite' }),
    el('div', { class: 'candidat-texte' }, [
      el('h3', { text: vin.nom }),
      el('p', { class: 'carte-soustitre', text: sousTitre(vin) || '—' }),
      el('div', { class: 'carte-meta' }, [
        el('span', { class: 'etiquette', text: `ressemblance ${Math.round(score * 100)} %` }),
        vin.statut === 'en-cave'
          ? el('span', { class: 'discret', text: pluriel(vin.quantite, 'bouteille', 'bouteilles') })
          : el('span', { class: 'etiquette etiquette-termine', text: 'Terminé' }),
      ]),
    ]),
    bouton(libelleAction, { classe: 'bouton bouton-primaire', onclick: () => onChoisir(vin) }),
  ]);
}

/** Recherche de repli, quand l'étiquette ne donne rien d'exploitable. */
function rechercheManuelle(statut, onChoisir) {
  const bloc = el('div', { class: 'recherche-repli' });
  const entree = el('input', {
    type: 'search',
    class: 'recherche',
    placeholder: 'Chercher dans la cave…',
    'aria-label': 'Chercher la bouteille dans la cave',
  });
  const liste = el('div', { class: 'liste-candidats' });

  const rafraichir = () => {
    const recherche = entree.value.trim();
    vider(liste);
    if (recherche.length < 2) return;
    const resultats = filtrerVins(store.vins(), { recherche, statut }).slice(0, 8);
    if (!resultats.length) {
      liste.append(el('p', { class: 'discret', text: 'Aucun vin ne correspond.' }));
      return;
    }
    for (const vin of resultats) {
      liste.append(carteCandidat({ vin, score: 1 }, {
        libelleAction: 'Choisir',
        onChoisir,
      }));
    }
  };

  let minuteur = null;
  entree.addEventListener('input', () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(rafraichir, 160);
  });

  bloc.append(entree, liste);
  return bloc;
}
