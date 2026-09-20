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
function entreePhoto({ id, libelle, nomIcone, classe, appareil, face, naviguer }) {
  const entree = el('input', {
    type: 'file',
    accept: 'image/*',
    capture: appareil ? 'environment' : null,
    class: 'visuellement-cache',
    id,
  });
  entree.addEventListener('change', async () => {
    const fichier = entree.files?.[0];
    entree.value = '';
    if (fichier) await traiterPhoto(fichier, naviguer, face);
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

function zonePhoto(naviguer) {
  const bloc = el('section', { class: 'bloc bloc-photo' });

  if (!etat.avant.apercu) {
    // Deux entrées distinctes : « capture » ouvre directement l'appareil photo
    // sur téléphone, son absence laisse choisir dans la photothèque. Une seule
    // entrée ne peut pas offrir les deux.
    const source = (id, libelle, nomIcone, classe, appareil) => entreePhoto({
      id, libelle, nomIcone, classe, appareil, face: 'avant', naviguer,
    });

    bloc.append(
      // Ce qui fait échouer la lecture d'une étiquette n'est presque jamais le
      // téléphone : c'est le cadrage. Mesuré sur un lot de photos, une
      // étiquette cadrée de près rend neuf mots sur neuf, la même étiquette sur
      // une bouteille entière prise d'un mètre en rend six.
      el('p', { class: 'discret conseil-cadrage', text: CONSEIL_CADRAGE }),
      ...source('prise-de-vue', MODES[etat.mode].action, 'appareil', 'bouton-primaire', true),
      ...source('choix-photo', 'Choisir une photo existante', 'image', '', false),
      el('button', {
        type: 'button', class: 'bouton-lien', text: 'Continuer sans photo',
        onclick: () => { etat.etape = 'resultats'; naviguer(null); },
      }),
    );
    return bloc;
  }

  const faces = [facePrise('avant', 'Étiquette avant', naviguer)];
  if (etat.arriere.apercu) faces.push(facePrise('arriere', 'Étiquette arrière', naviguer));

  bloc.append(
    el('div', { class: `photo-prise${faces.length > 1 ? ' photo-prise-deux' : ''}` }, [
      el('div', { class: 'photo-faces' }, faces),
      el('div', { class: 'photo-prise-actions' }, [
        bouton('Tout reprendre', {
          icone: 'appareil',
          onclick: () => { reinitialiser(etat.mode); naviguer(null); },
        }),
      ]),
    ]),
  );

  // La lecture de l'étiquette télécharge un moteur de reconnaissance de
  // plusieurs méga-octets la première fois. On ne l'impose pas : l'utilisateur
  // décide, puis le choix est retenu.
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

async function traiterPhoto(fichier, naviguer, face = 'avant') {
  try {
    // La photo gardée dans la cave est réduite : c'est ce qu'il faut pour la
    // consulter, c'est trop peu pour lire une étiquette. On retient donc le
    // fichier tel que l'appareil l'a rendu, le temps de ce parcours.
    const cle = await photos.enregistrer(fichier);
    etat[face] = { cle, origine: fichier, apercu: await photos.url(cle) };
  } catch (erreur) {
    console.error(erreur);
    const raison = erreur?.name === 'NotReadableError' ? 'fichier illisible'
      : erreur?.message || 'raison inconnue';
    message(`Photo non enregistrée : ${raison}`, 'erreur');
    return;
  }
  if (photos.enMemoire()) {
    message('Photos gardées le temps de la session : ce navigateur refuse le stockage durable');
  }
  // Inutile de reproposer une lecture dont on sait qu'elle ne marche pas ici.
  if (lectureIndisponible()) {
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
  etat.etape = 'lecture';
  etat.progres = 0;
  naviguer(null);

  // La photo d'origine porte bien plus de détail que la copie gardée en cave,
  // et c'est ce détail qui fait la différence sur une étiquette. Le repli sur
  // la copie ne sert pas aujourd'hui : il évite qu'une lecture devienne
  // muette si ce parcours venait à changer.
  const blobs = [];
  for (const face of ['avant', 'arriere']) {
    if (!etat[face].cle && !etat[face].origine) continue;
    const blob = etat[face].origine
      || await photos.lire(etat[face].cle).catch(() => null);
    if (blob) blobs.push(blob);
  }
  const cleVision = store.preferences().cleVision || '';
  const lecture = blobs.length
    ? await lireEtiquette(blobs, {
      cleVision,
      onProgres: (p) => {
        etat.progres = p;
        const barre = document.querySelector('.progression-valeur');
        if (barre) barre.style.width = `${Math.round(p * 100)}%`;
      },
    })
    : null;

  // L'utilisateur a pu renoncer pendant que le moteur cherchait ses morceaux.
  if (etat.abandon) return;

  if (lecture) {
    // Un repli silencieux laisserait croire que la lecture améliorée
    // fonctionne alors qu'elle est refusée. On le dit, une fois.
    if (cleVision && !lecture.parGoogle) {
      const raison = raisonDuRepli();
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

  etat.lecture = lecture;
  etat.champs = lecture ? extraireChamps(lecture.texte) : null;
  etat.etape = 'resultats';
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
  const brouillon = {
    photoLocale: etat.avant.cle,
    photoArriere: etat.arriere.cle,
    millesime: champs.millesime ?? null,
    degre: champs.degre ?? null,
    volume: champs.volume || '75 cl',
    nom: nomProbable(champs.lignes || []),
  };

  const resume = [];
  if (champs.millesime) resume.push(`millésime ${champs.millesime}`);
  if (champs.degre) resume.push(`${String(champs.degre).replace('.', ',')} %`);
  if (champs.volume) resume.push(champs.volume);

  return el('section', { class: 'bloc' }, [
    el('div', { class: 'bloc-entete' }, [el('h2', { text: 'Nouvelle fiche' })]),
    resume.length
      ? el('p', { class: 'discret', text: `Lu sur l'étiquette : ${resume.join(', ')}` })
      : el('p', {
        class: 'discret',
        text: etat.lecture
          ? "Rien de sûr n'a pu être lu sur l'étiquette, les champs sont à remplir."
          : 'Les champs sont à remplir à la main.',
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
