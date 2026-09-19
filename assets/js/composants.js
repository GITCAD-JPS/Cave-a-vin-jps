// Fragments d'interface partagés par plusieurs vues.

import { ajouter, el, etoiles, icone } from './dom.js';
import { anomalies, libelleCouleur, repartition } from './model.js';
import * as photos from './photos.js';

/**
 * Vignette d'étiquette. Les photos du classeur sont des fichiers statiques,
 * celles prises dans l'application viennent d'IndexedDB et sont résolues
 * après coup.
 */
export function vignette(fiche, { taille = 'moyenne', face = 'avant' } = {}) {
  const cadre = el('div', { class: `vignette vignette-${taille} couleur-${fiche.couleur}` });
  const initiale = (fiche.nom || '?').trim().charAt(0).toUpperCase();
  cadre.append(el('span', { class: 'vignette-initiale', text: initiale, 'aria-hidden': 'true' }));

  const afficher = (source) => {
    if (!source) return;
    const image = el('img', {
      src: source,
      alt: face === 'arriere' ? `Étiquette arrière de ${fiche.nom}` : `Étiquette de ${fiche.nom}`,
      loading: 'lazy',
      decoding: 'async',
    });
    image.addEventListener('error', () => image.remove());
    cadre.append(image);
  };

  if (face === 'arriere') {
    if (fiche.photoArriere) photos.url(fiche.photoArriere).then(afficher);
  } else if (fiche.photoLocale) photos.url(fiche.photoLocale).then(afficher);
  else if (fiche.photo) afficher(fiche.photo);
  return cadre;
}

export function pastilleCouleur(couleur) {
  return el('span', { class: `pastille couleur-${couleur}`, text: libelleCouleur(couleur) });
}

/** Ligne « Producteur · Région · Millésime », les champs vides en moins. */
export function sousTitre(fiche) {
  const parties = [fiche.producteur, fiche.region, fiche.millesime].filter(Boolean);
  return parties.join(' · ');
}

export function etiquettesEmplacement(vin) {
  const liste = repartition(vin);
  if (!liste.length) return null;
  return el('div', { class: 'etiquettes' }, liste.map((e) => el('span', {
    class: 'etiquette',
    title: `${e.nombre} en ${e.libelle.toLowerCase()}`,
    text: `${e.court} ${e.nombre}`,
  })));
}

export function badgesAnomalies(vin) {
  // La pastille de couleur affiche déjà « À préciser » : inutile de le répéter.
  const liste = anomalies(vin).filter((texte) => texte !== 'Couleur à préciser');
  if (!liste.length) return null;
  return el('div', { class: 'etiquettes' }, liste.map((texte) => el('span', {
    class: 'etiquette etiquette-alerte',
    text: texte,
  })));
}

/** Carte d'un vin dans la liste de la cave. */
export function carteVin(vin, { onOuvrir, onBoire }) {
  const carte = el('article', { class: 'carte', dataset: { id: vin.id } });

  const ouvrir = el('button', {
    type: 'button',
    class: 'carte-ouvrir',
    onclick: () => onOuvrir(vin),
    'aria-label': `Ouvrir la fiche de ${vin.nom}`,
  }, [
    vignette(vin),
    el('div', { class: 'carte-texte' }, [
      el('h3', { class: 'carte-titre', text: vin.nom }),
      el('p', { class: 'carte-soustitre', text: sousTitre(vin) || '—' }),
      el('div', { class: 'carte-meta' }, [
        pastilleCouleur(vin.couleur),
        vin.cepage ? el('span', { class: 'discret', text: vin.cepage }) : null,
      ]),
      etiquettesEmplacement(vin),
      badgesAnomalies(vin),
      vin.notation !== null ? etoiles(vin.notation) : null,
    ]),
  ]);
  carte.append(ouvrir);

  const pied = el('div', { class: 'carte-pied' });
  if (vin.statut === 'termine') {
    pied.append(el('span', { class: 'etiquette etiquette-termine', text: 'Terminé' }));
  } else {
    pied.append(el('span', {
      class: 'compteur',
      text: `${vin.quantite}`,
      title: `${vin.quantite} bouteille${vin.quantite > 1 ? 's' : ''}`,
    }));
    if (vin.quantite > 0) {
      const boire = el('button', {
        type: 'button',
        class: 'bouton-icone bouton-boire',
        title: 'Ouvrir une bouteille',
        'aria-label': `Ouvrir une bouteille de ${vin.nom}`,
        onclick: () => onBoire(vin),
      });
      boire.append(icone('verre'));
      pied.append(boire);
    }
  }
  carte.append(pied);
  return carte;
}

/** Ligne du journal des dégustations. */
export function ligneDegustation(degustation, { onOuvrir, onModifier }) {
  const ligne = el('article', { class: 'ligne-degustation' });
  ligne.append(vignette(degustation, { taille: 'petite' }));

  const texte = el('div', { class: 'ligne-texte' }, [
    el('h3', { text: degustation.nom || 'Vin sans nom' }),
    el('p', { class: 'carte-soustitre', text: sousTitre(degustation) || '—' }),
  ]);
  const meta = el('div', { class: 'carte-meta' });
  if (degustation.date) meta.append(el('span', { class: 'etiquette', text: degustation.date }));
  if (degustation.contexte) meta.append(el('span', { class: 'discret', text: degustation.contexte }));
  if (degustation.lieu) meta.append(el('span', { class: 'discret', text: degustation.lieu }));
  if (degustation.notation !== null) meta.append(etoiles(degustation.notation));
  texte.append(meta);
  if (degustation.commentaire) {
    texte.append(el('p', { class: 'ligne-commentaire', text: degustation.commentaire }));
  }
  ligne.append(texte);

  const actions = el('div', { class: 'ligne-actions' });
  if (degustation.vinId && onOuvrir) {
    actions.append(el('button', {
      type: 'button', class: 'bouton-lien', text: 'Voir la fiche',
      onclick: () => onOuvrir(degustation.vinId),
    }));
  }
  actions.append(el('button', {
    type: 'button', class: 'bouton-lien', text: 'Modifier',
    onclick: () => onModifier(degustation),
  }));
  ligne.append(actions);
  return ligne;
}

/** Diagramme en barres horizontales, sans dépendance. */
export function barres(donnees, { unite = '', max = null, couleurParCle = false } = {}) {
  const sommet = max ?? Math.max(1, ...donnees.map((d) => d.nombre));
  return el('ul', { class: 'barres' }, donnees.map((entree) => el('li', {}, [
    el('span', { class: 'barre-libelle', text: entree.libelle, title: entree.libelle }),
    el('span', { class: 'barre-piste' }, [
      el('span', {
        class: `barre-valeur${couleurParCle && entree.cle ? ` couleur-${entree.cle}` : ''}`,
        style: `width:${Math.max(2, (entree.nombre / sommet) * 100)}%`,
      }),
    ]),
    el('span', { class: 'barre-nombre', text: `${entree.nombre}${unite}` }),
  ])));
}

export function tuile(libelle, valeur, detail) {
  return el('div', { class: 'tuile' }, [
    el('span', { class: 'tuile-valeur', text: valeur }),
    el('span', { class: 'tuile-libelle', text: libelle }),
    detail ? el('span', { class: 'tuile-detail', text: detail }) : null,
  ]);
}

export function etatVide(titre, texte, action) {
  const bloc = el('div', { class: 'etat-vide' }, [
    el('h3', { text: titre }),
    el('p', { text: texte }),
  ]);
  if (action) ajouter(bloc, action);
  return bloc;
}

export function section(titre, contenu, actions) {
  return el('section', { class: 'bloc' }, [
    el('div', { class: 'bloc-entete' }, [
      el('h2', { text: titre }),
      actions || null,
    ]),
    ...(Array.isArray(contenu) ? contenu : [contenu]),
  ]);
}
