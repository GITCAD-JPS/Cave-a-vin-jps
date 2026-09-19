// Formulaires et boîtes de dialogue de saisie.

import { bouton, champ, dialogue, el, icone, message, selection, vider } from './dom.js';
import {
  COULEURS, EMPLACEMENTS, VOLUMES, aujourdhui, dateTriable, entier, nombreOuNull,
} from './model.js';
import * as photos from './photos.js';
import * as store from './store.js';

const CONTEXTES = ['À la maison', 'Repas de famille', 'Entre amis', 'Restaurant',
  'Vacances', 'Apéritif', 'Occasion spéciale'];

const optionsCouleur = COULEURS.map((c) => ({ valeur: c.cle, libelle: c.libelle }));

function texteSaisi(formulaire, nom) {
  return String(formulaire.elements[nom]?.value ?? '').trim();
}

/** Convertit la valeur d'un champ date en « JJ.MM.AAAA ». */
function dateFrancaise(valeurIso) {
  if (!valeurIso) return '';
  const [annee, mois, jour] = valeurIso.split('-');
  return jour ? `${jour}.${mois}.${annee}` : valeurIso;
}

/** L'inverse : prépare une date du classeur pour un champ de type date. */
function dateIso(texte) {
  const triable = dateTriable(texte);
  return triable && !triable.includes('-00') ? triable : '';
}

// --- sélecteur de note ------------------------------------------------------

/** Cinq étoiles cliquables, avec demi-notes au second clic. */
function selecteurNote(valeurInitiale) {
  let valeur = valeurInitiale ?? null;
  const conteneur = el('div', { class: 'note-saisie', role: 'group', 'aria-label': 'Note sur 5' });
  const champCache = el('input', { type: 'hidden', name: 'notation', value: valeur ?? '' });
  const etoiles = [];

  const rafraichir = () => {
    champCache.value = valeur ?? '';
    etoiles.forEach((etoile, index) => {
      const remplissage = Math.min(1, Math.max(0, (valeur ?? 0) - index));
      etoile.style.setProperty('--remplissage', `${Math.round(remplissage * 100)}%`);
      etoile.setAttribute('aria-pressed', String((valeur ?? 0) >= index + 1));
    });
    effacer.hidden = valeur === null;
  };

  for (let i = 1; i <= 5; i += 1) {
    const etoile = el('button', {
      type: 'button',
      class: 'etoile-bouton',
      'aria-label': `${i} sur 5`,
      onclick: () => {
        // Un clic sur l'étoile déjà atteinte bascule sur la demi-note.
        valeur = valeur === i ? i - 0.5 : i;
        rafraichir();
      },
    });
    etoile.append(icone('etoile', 'etoile'));
    etoiles.push(etoile);
    conteneur.append(etoile);
  }
  const effacer = el('button', {
    type: 'button', class: 'bouton-lien', text: 'Effacer',
    onclick: () => { valeur = null; rafraichir(); },
  });
  conteneur.append(effacer, champCache);
  rafraichir();
  return conteneur;
}

// --- sélecteur de photo -----------------------------------------------------

/**
 * Choix d'une photo d'étiquette. Renvoie un objet exposant l'état courant :
 * clé IndexedDB pour une photo prise ici, chemin statique pour une photo
 * issue du classeur.
 */
function selecteurPhoto(fiche, { champ = 'photoLocale', champStatique = 'photo' } = {}) {
  const etat = { photoLocale: fiche[champ] || '', photo: champStatique ? fiche[champStatique] || '' : '' };
  const apercu = el('div', { class: 'photo-apercu' });
  const idEntree = `photo-entree-${champ}-${Math.random().toString(36).slice(2, 8)}`;
  // Sans « capture », le téléphone propose l'appareil photo et la photothèque.
  const entree = el('input', {
    type: 'file', accept: 'image/*', class: 'visuellement-cache', id: idEntree,
  });

  const rafraichir = async () => {
    vider(apercu);
    const source = etat.photoLocale ? await photos.url(etat.photoLocale) : etat.photo;
    if (source) {
      apercu.append(el('img', { src: source, alt: "Aperçu de l'étiquette" }));
      apercu.append(bouton('Retirer', {
        classe: 'bouton bouton-discret',
        onclick: () => { etat.photoLocale = ''; etat.photo = ''; rafraichir(); },
      }));
    } else {
      apercu.append(el('p', { class: 'discret', text: 'Aucune photo' }));
    }
  };

  entree.addEventListener('change', async () => {
    const fichier = entree.files?.[0];
    if (!fichier) return;
    try {
      const cle = await photos.enregistrer(fichier);
      etat.photoLocale = cle;
      etat.photo = '';
      await rafraichir();
    } catch (erreur) {
      console.error(erreur);
      message("La photo n'a pas pu être enregistrée", 'erreur');
    } finally {
      entree.value = '';
    }
  });

  const declencheur = el('label', {
    class: 'bouton', for: idEntree, tabindex: '0',
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entree.click(); },
  });
  declencheur.append(icone('appareil'), el('span', { text: 'Photographier ou choisir' }));

  rafraichir();
  return {
    etat,
    noeud: el('div', { class: 'photo-choix' }, [apercu, declencheur, entree]),
  };
}

// --- formulaire d'un vin ----------------------------------------------------

export function formulaireVin(vinExistant, { onEnregistre, brouillon } = {}) {
  const vin = vinExistant || {
    nom: '', producteur: '', region: '', cepage: '', couleur: 'rouge', millesime: null,
    volume: '75 cl', degre: null, quantite: 1, provenance: 'Achat', source: '',
    dateReception: aujourdhui(), emplacements: {}, emplacementPrecis: '', note: '',
    notation: null, photo: '', photoLocale: '', photoArriere: '', statut: 'en-cave',
    // Le parcours photo fournit déjà la photo et ce qui a pu être lu dessus.
    ...brouillon,
  };
  const OPTIONS_STATUT = [
    { valeur: 'en-cave', libelle: 'En cave' },
    { valeur: 'termine', libelle: 'Terminé' },
  ];
  const creation = !vinExistant;
  const photo = selecteurPhoto(vin);
  // La contre-étiquette porte le degré, le volume et la description. Elle est
  // facultative, et n'a pas d'équivalent dans le classeur d'origine.
  const arriere = selecteurPhoto(vin, { champ: 'photoArriere', champStatique: '' });

  const champsEmplacement = EMPLACEMENTS.map(({ cle, libelle }) => {
    const entree = el('input', {
      type: 'number', name: `emplacement-${cle}`, min: '0', step: '1', inputmode: 'numeric',
      value: String(vin.emplacements?.[cle] ?? 0),
    });
    return { cle, libelle, entree };
  });
  const champQuantite = el('input', {
    type: 'number', name: 'quantite', min: '0', step: '1', inputmode: 'numeric',
    value: String(vin.quantite ?? 0),
  });
  const sommeEmplacements = () => champsEmplacement
    .reduce((total, c) => total + entier(c.entree.value, 0), 0);

  // Tant que le total suit la somme des emplacements, il continue de la
  // suivre. Dès que l'utilisateur le saisit lui-même, on ne le touche plus.
  // Sur une nouvelle fiche, tout est encore à zéro : le total suit d'emblée.
  let totalSynchronise = creation || entier(vin.quantite, 0) === sommeEmplacements();
  champQuantite.addEventListener('input', () => {
    totalSynchronise = entier(champQuantite.value, 0) === sommeEmplacements();
  });
  for (const { entree } of champsEmplacement) {
    entree.addEventListener('input', () => {
      if (totalSynchronise) champQuantite.value = String(sommeEmplacements());
    });
  }

  const formulaire = el('form', { class: 'formulaire', novalidate: true }, [
    champ('Nom du vin *', el('input', {
      type: 'text', name: 'nom', required: true, value: vin.nom, autocomplete: 'off',
    })),
    el('div', { class: 'grille-deux' }, [
      champ('Producteur', el('input', {
        type: 'text', name: 'producteur', value: vin.producteur, list: 'liste-producteurs',
      })),
      champ('Région / Appellation', el('input', {
        type: 'text', name: 'region', value: vin.region, list: 'liste-regions',
      })),
    ]),
    el('div', { class: 'grille-deux' }, [
      champ('Cépage', el('input', {
        type: 'text', name: 'cepage', value: vin.cepage, list: 'liste-cepages',
      })),
      champ('Couleur', selection(optionsCouleur, vin.couleur, { name: 'couleur' })),
    ]),
    el('div', { class: 'grille-trois' }, [
      champ('Millésime', el('input', {
        type: 'number', name: 'millesime', min: '1900', max: '2100', step: '1',
        inputmode: 'numeric', value: vin.millesime ?? '',
      })),
      champ('Volume', el('input', {
        type: 'text', name: 'volume', value: vin.volume, list: 'liste-volumes',
      })),
      champ('Degré (%)', el('input', {
        type: 'number', name: 'degre', min: '0', max: '25', step: '0.1',
        inputmode: 'decimal', value: vin.degre ?? '',
      })),
    ]),
    el('fieldset', { class: 'groupe' }, [
      el('legend', { text: 'Emplacements' }),
      el('div', { class: 'grille-trois' },
        champsEmplacement.map((c) => champ(c.libelle, c.entree))),
      el('div', { class: 'grille-trois' }, [
        champ('Quantité totale', champQuantite, 'Se met à jour avec les emplacements'),
        champ('Statut', selection(OPTIONS_STATUT, vin.statut, { name: 'statut' })),
        champ('Emplacement précis', el('input', {
          type: 'text', name: 'emplacementPrecis', value: vin.emplacementPrecis,
          placeholder: 'Ex. 2ème rangée haute',
        })),
      ]),
    ]),
    el('div', { class: 'grille-trois' }, [
      champ('Provenance', el('input', {
        type: 'text', name: 'provenance', value: vin.provenance, list: 'liste-provenances',
      })),
      champ('Offert par / Acheté chez', el('input', {
        type: 'text', name: 'source', value: vin.source, list: 'liste-sources',
      })),
      champ('Date de réception', el('input', {
        type: 'text', name: 'dateReception', value: vin.dateReception,
        placeholder: 'JJ.MM.AAAA ou Mai 2026',
      })),
    ]),
    champ('Note personnelle', el('textarea', { name: 'note', rows: '3' }, vin.note)),
    champ('Note sur 5', selecteurNote(vin.notation)),
    champ("Photo de l'étiquette", photo.noeud),
    champ("Photo de l'étiquette arrière", arriere.noeud),
    el('div', { class: 'formulaire-actions' }, [
      bouton('Annuler', { classe: 'bouton', onclick: () => onEnregistre(null) }),
      el('button', {
        type: 'submit', class: 'bouton bouton-primaire',
        text: creation ? 'Ajouter à la cave' : 'Enregistrer',
      }),
    ]),
  ]);

  formulaire.addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const nom = texteSaisi(formulaire, 'nom');
    if (!nom) {
      message('Le nom du vin est obligatoire', 'erreur');
      formulaire.elements.nom.focus();
      return;
    }
    const emplacements = {};
    for (const { cle, entree } of champsEmplacement) emplacements[cle] = entier(entree.value, 0);
    const quantite = entier(champQuantite.value, 0);

    const champs = {
      nom,
      producteur: texteSaisi(formulaire, 'producteur'),
      region: texteSaisi(formulaire, 'region'),
      cepage: texteSaisi(formulaire, 'cepage'),
      couleur: texteSaisi(formulaire, 'couleur'),
      millesime: nombreOuNull(texteSaisi(formulaire, 'millesime')),
      volume: texteSaisi(formulaire, 'volume') || '75 cl',
      degre: nombreOuNull(texteSaisi(formulaire, 'degre')),
      quantite,
      provenance: texteSaisi(formulaire, 'provenance'),
      source: texteSaisi(formulaire, 'source'),
      dateReception: texteSaisi(formulaire, 'dateReception'),
      emplacements,
      emplacementPrecis: texteSaisi(formulaire, 'emplacementPrecis'),
      note: texteSaisi(formulaire, 'note'),
      notation: nombreOuNull(texteSaisi(formulaire, 'notation')),
      photo: photo.etat.photo,
      photoLocale: photo.etat.photoLocale,
      photoArriere: arriere.etat.photoLocale,
      statut: texteSaisi(formulaire, 'statut') === 'termine' ? 'termine' : 'en-cave',
    };
    const enregistre = creation ? store.ajouterVin(champs) : store.modifierVin(vin.id, champs);
    message(creation ? `${nom} ajouté à la cave` : 'Fiche mise à jour');
    onEnregistre(enregistre);
  });

  return formulaire;
}

// --- ouvrir une bouteille ---------------------------------------------------

export function dialogueBoire(vin, { onFait, photoLocale = '' } = {}) {
  const disponibles = EMPLACEMENTS.filter((e) => (vin.emplacements[e.cle] || 0) > 0);
  const options = disponibles.map((e) => ({
    valeur: e.cle,
    libelle: `${e.libelle} (${vin.emplacements[e.cle]})`,
  }));
  if (!options.length) options.push({ valeur: '', libelle: 'Emplacement non renseigné' });

  return dialogue(`Ouvrir une bouteille — ${vin.nom}`, (fermer) => {
    const formulaire = el('form', { class: 'formulaire' }, [
      el('div', { class: 'grille-deux' }, [
        champ('Prise dans', selection(options, options[0].valeur, { name: 'emplacement' })),
        champ('Date', el('input', {
          type: 'date', name: 'date', value: new Date().toISOString().slice(0, 10),
        })),
      ]),
      el('div', { class: 'grille-deux' }, [
        champ('Contexte', el('input', {
          type: 'text', name: 'contexte', value: 'À la maison', list: 'liste-contextes',
        })),
        champ('Lieu', el('input', { type: 'text', name: 'lieu', placeholder: 'Facultatif' })),
      ]),
      champ('Note sur 5', selecteurNote(vin.notation)),
      champ('Commentaire de dégustation', el('textarea', {
        name: 'commentaire', rows: '3', placeholder: 'Accords, impressions, personnes présentes…',
      })),
      el('div', { class: 'formulaire-actions' }, [
        bouton('Annuler', { classe: 'bouton', onclick: fermer }),
        el('button', { type: 'submit', class: 'bouton bouton-primaire', text: 'Bouteille ouverte' }),
      ]),
    ]);

    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      store.boireBouteille(vin.id, {
        emplacement: texteSaisi(formulaire, 'emplacement'),
        date: dateFrancaise(texteSaisi(formulaire, 'date')) || aujourdhui(),
        contexte: texteSaisi(formulaire, 'contexte'),
        lieu: texteSaisi(formulaire, 'lieu'),
        notation: nombreOuNull(texteSaisi(formulaire, 'notation')),
        commentaire: texteSaisi(formulaire, 'commentaire'),
        // Photo prise au moment de boire, si le parcours photo en a une.
        photoLocale,
      });
      const restantes = store.trouverVin(vin.id)?.quantite ?? 0;
      message(restantes > 0
        ? `Bouteille ouverte — il en reste ${restantes}`
        : `${vin.nom} : dernière bouteille, la fiche passe en terminé`);
      fermer();
      onFait?.();
    });
    return formulaire;
  }, { largeur: '34rem' });
}

// --- ajouter des bouteilles -------------------------------------------------

export function dialogueAjouterBouteilles(vin, { onFait } = {}) {
  return dialogue(`Ajouter des bouteilles — ${vin.nom}`, (fermer) => {
    const formulaire = el('form', { class: 'formulaire' }, [
      el('div', { class: 'grille-deux' }, [
        champ('Nombre', el('input', {
          type: 'number', name: 'nombre', min: '1', step: '1', value: '1', inputmode: 'numeric',
        })),
        champ('Emplacement', selection(
          EMPLACEMENTS.map((e) => ({ valeur: e.cle, libelle: e.libelle })),
          EMPLACEMENTS[0].cle,
          { name: 'emplacement' },
        )),
      ]),
      el('div', { class: 'formulaire-actions' }, [
        bouton('Annuler', { classe: 'bouton', onclick: fermer }),
        el('button', { type: 'submit', class: 'bouton bouton-primaire', text: 'Ajouter' }),
      ]),
    ]);
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      const nombre = entier(texteSaisi(formulaire, 'nombre'), 1);
      store.ajouterBouteilles(vin.id, texteSaisi(formulaire, 'emplacement'), nombre);
      message(`${nombre} bouteille${nombre > 1 ? 's' : ''} ajoutée${nombre > 1 ? 's' : ''}`);
      fermer();
      onFait?.();
    });
    return formulaire;
  }, { largeur: '28rem' });
}

// --- déplacer des bouteilles ------------------------------------------------

export function dialogueDeplacer(vin, { onFait } = {}) {
  const options = EMPLACEMENTS.map((e) => ({
    valeur: e.cle,
    libelle: `${e.libelle} (${vin.emplacements[e.cle] || 0})`,
  }));
  const depart = EMPLACEMENTS.find((e) => (vin.emplacements[e.cle] || 0) > 0)?.cle
    || EMPLACEMENTS[0].cle;
  const arrivee = EMPLACEMENTS.find((e) => e.cle !== depart).cle;

  return dialogue(`Déplacer des bouteilles — ${vin.nom}`, (fermer) => {
    const formulaire = el('form', { class: 'formulaire' }, [
      el('div', { class: 'grille-trois' }, [
        champ('Depuis', selection(options, depart, { name: 'depuis' })),
        champ('Vers', selection(options, arrivee, { name: 'vers' })),
        champ('Nombre', el('input', {
          type: 'number', name: 'nombre', min: '1', step: '1', value: '1', inputmode: 'numeric',
        })),
      ]),
      el('div', { class: 'formulaire-actions' }, [
        bouton('Annuler', { classe: 'bouton', onclick: fermer }),
        el('button', { type: 'submit', class: 'bouton bouton-primaire', text: 'Déplacer' }),
      ]),
    ]);
    formulaire.addEventListener('submit', (evenement) => {
      evenement.preventDefault();
      const depuis = texteSaisi(formulaire, 'depuis');
      const vers = texteSaisi(formulaire, 'vers');
      if (depuis === vers) {
        message('Choisissez deux emplacements différents', 'erreur');
        return;
      }
      store.deplacerBouteilles(vin.id, depuis, vers, entier(texteSaisi(formulaire, 'nombre'), 1));
      message('Bouteilles déplacées');
      fermer();
      onFait?.();
    });
    return formulaire;
  }, { largeur: '32rem' });
}

// --- dégustation hors cave --------------------------------------------------

export function formulaireDegustation(existante, { onEnregistre } = {}) {
  const degustation = existante || {
    nom: '', producteur: '', region: '', cepage: '', couleur: 'rouge', millesime: null,
    contexte: 'Vacances', lieu: '', date: aujourdhui(), notation: null, commentaire: '',
    photo: '', photoLocale: '', vinId: '',
  };
  const creation = !existante;
  const photo = selecteurPhoto(degustation);

  const formulaire = el('form', { class: 'formulaire', novalidate: true }, [
    champ('Nom du vin *', el('input', {
      type: 'text', name: 'nom', required: true, value: degustation.nom,
    })),
    el('div', { class: 'grille-deux' }, [
      champ('Producteur', el('input', {
        type: 'text', name: 'producteur', value: degustation.producteur, list: 'liste-producteurs',
      })),
      champ('Région / Appellation', el('input', {
        type: 'text', name: 'region', value: degustation.region, list: 'liste-regions',
      })),
    ]),
    el('div', { class: 'grille-trois' }, [
      champ('Cépage', el('input', {
        type: 'text', name: 'cepage', value: degustation.cepage, list: 'liste-cepages',
      })),
      champ('Couleur', selection(optionsCouleur, degustation.couleur, { name: 'couleur' })),
      champ('Millésime', el('input', {
        type: 'number', name: 'millesime', min: '1900', max: '2100', step: '1',
        inputmode: 'numeric', value: degustation.millesime ?? '',
      })),
    ]),
    el('div', { class: 'grille-trois' }, [
      champ('Date', el('input', {
        type: 'date', name: 'date', value: dateIso(degustation.date),
      }), degustation.date && !dateIso(degustation.date) ? `Saisie d'origine : ${degustation.date}` : ''),
      champ('Contexte', el('input', {
        type: 'text', name: 'contexte', value: degustation.contexte, list: 'liste-contextes',
      })),
      champ('Lieu', el('input', { type: 'text', name: 'lieu', value: degustation.lieu })),
    ]),
    champ('Note sur 5', selecteurNote(degustation.notation)),
    champ('Commentaire', el('textarea', { name: 'commentaire', rows: '3' }, degustation.commentaire)),
    champ("Photo de l'étiquette", photo.noeud),
    el('div', { class: 'formulaire-actions' }, [
      bouton('Annuler', { classe: 'bouton', onclick: () => onEnregistre(null) }),
      el('button', {
        type: 'submit', class: 'bouton bouton-primaire',
        text: creation ? 'Ajouter au journal' : 'Enregistrer',
      }),
    ]),
  ]);

  formulaire.addEventListener('submit', (evenement) => {
    evenement.preventDefault();
    const nom = texteSaisi(formulaire, 'nom');
    if (!nom) {
      message('Le nom du vin est obligatoire', 'erreur');
      formulaire.elements.nom.focus();
      return;
    }
    const dateSaisie = texteSaisi(formulaire, 'date');
    const champs = {
      nom,
      producteur: texteSaisi(formulaire, 'producteur'),
      region: texteSaisi(formulaire, 'region'),
      cepage: texteSaisi(formulaire, 'cepage'),
      couleur: texteSaisi(formulaire, 'couleur'),
      millesime: nombreOuNull(texteSaisi(formulaire, 'millesime')),
      contexte: texteSaisi(formulaire, 'contexte'),
      lieu: texteSaisi(formulaire, 'lieu'),
      date: dateSaisie ? dateFrancaise(dateSaisie) : degustation.date,
      notation: nombreOuNull(texteSaisi(formulaire, 'notation')),
      commentaire: texteSaisi(formulaire, 'commentaire'),
      photo: photo.etat.photo,
      photoLocale: photo.etat.photoLocale,
      vinId: degustation.vinId,
    };
    const enregistre = creation
      ? store.ajouterDegustation(champs)
      : store.modifierDegustation(degustation.id, champs);
    message(creation ? 'Dégustation ajoutée' : 'Dégustation mise à jour');
    onEnregistre(enregistre);
  });

  return formulaire;
}

// --- listes de suggestions --------------------------------------------------

/**
 * Alimente les champs de saisie avec ce qui existe déjà dans la cave, pour
 * éviter d'écrire « Denner » de quatre façons différentes. Les listes sont
 * posées une seule fois dans le document et rafraîchies à chaque changement.
 */
export function installerSuggestions() {
  document.getElementById('suggestions')?.remove();
  const conteneur = listesSuggestions();
  conteneur.id = 'suggestions';
  document.body.append(conteneur);
}

function listesSuggestions() {
  const vins = store.vins();
  const degustations = store.degustations();
  const valeurs = (champ_) => {
    const ensemble = new Set();
    for (const fiche of [...vins, ...degustations]) {
      const valeur = String(fiche[champ_] ?? '').trim();
      if (valeur) ensemble.add(valeur);
    }
    return [...ensemble].sort((a, b) => a.localeCompare(b, 'fr'));
  };
  const liste = (id, options) => el('datalist', { id },
    options.map((v) => el('option', { value: v })));

  return el('div', { hidden: true }, [
    liste('liste-producteurs', valeurs('producteur')),
    liste('liste-regions', valeurs('region')),
    liste('liste-cepages', valeurs('cepage')),
    liste('liste-sources', valeurs('source')),
    liste('liste-provenances', ['Achat', 'Cadeau', ...valeurs('provenance')]),
    liste('liste-contextes', [...new Set([...CONTEXTES, ...valeurs('contexte')])]),
    liste('liste-volumes', VOLUMES),
  ]);
}
export { dateFrancaise };
