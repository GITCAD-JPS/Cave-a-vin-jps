// Aides minimales pour construire le DOM sans bibliothèque.

/**
 * Crée un élément. Les clés de `attributs` deviennent des attributs, sauf
 * `class`, `text`, `html`, `dataset` et les gestionnaires `on*`.
 */
export function el(balise, attributs = {}, enfants = []) {
  const noeud = document.createElement(balise);
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (valeur === null || valeur === undefined || valeur === false) continue;
    if (cle === 'class') noeud.className = valeur;
    else if (cle === 'text') noeud.textContent = valeur;
    else if (cle === 'html') noeud.innerHTML = valeur;
    else if (cle === 'dataset') Object.assign(noeud.dataset, valeur);
    else if (cle.startsWith('on')) noeud.addEventListener(cle.slice(2).toLowerCase(), valeur);
    else if (valeur === true) noeud.setAttribute(cle, '');
    else noeud.setAttribute(cle, valeur);
  }
  ajouter(noeud, enfants);
  return noeud;
}

export function ajouter(parent, enfants) {
  const liste = Array.isArray(enfants) ? enfants : [enfants];
  for (const enfant of liste) {
    if (enfant === null || enfant === undefined || enfant === false) continue;
    parent.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)));
  }
  return parent;
}

export function vider(noeud) {
  noeud.replaceChildren();
  return noeud;
}

export const $ = (selecteur, racine = document) => racine.querySelector(selecteur);
export const $$ = (selecteur, racine = document) => [...racine.querySelectorAll(selecteur)];

/** Icône SVG du jeu défini dans index.html. */
export function icone(nom, classe = 'icone') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', classe);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icone-${nom}`);
  svg.append(use);
  return svg;
}

export function bouton(libelle, { icone: nomIcone, classe = 'bouton', ...reste } = {}) {
  const noeud = el('button', { type: 'button', class: classe, ...reste });
  if (nomIcone) noeud.append(icone(nomIcone));
  noeud.append(el('span', { text: libelle }));
  return noeud;
}

let numeroGroupe = 0;

/**
 * Un champ fait de plusieurs contrôles, comme le choix d'une photo.
 *
 * Il ne peut pas être un <label> : un label transmet tout clic sur une partie
 * inerte (l'image, son libellé) au premier bouton qu'il contient. Toucher
 * l'aperçu d'une photo retirait la photo, ou lançait une relecture facturée.
 */
export function champGroupe(etiquette, controle, aide) {
  numeroGroupe += 1;
  const id = `champ-groupe-${numeroGroupe}`;
  return el('div', { class: 'champ', role: 'group', 'aria-labelledby': id }, [
    el('span', { class: 'champ-etiquette', id, text: etiquette }),
    controle,
    aide ? el('span', { class: 'champ-aide', text: aide }) : null,
  ]);
}

export function champ(etiquette, controle, aide) {
  return el('label', { class: 'champ' }, [
    el('span', { class: 'champ-etiquette', text: etiquette }),
    controle,
    aide ? el('span', { class: 'champ-aide', text: aide }) : null,
  ]);
}

export function selection(options, valeur, attributs = {}) {
  const noeud = el('select', attributs);
  for (const option of options) {
    const { valeur: v, libelle } = typeof option === 'string'
      ? { valeur: option, libelle: option }
      : option;
    noeud.append(el('option', { value: v, text: libelle, selected: v === valeur }));
  }
  noeud.value = valeur ?? '';
  return noeud;
}

/** Affiche un message éphémère en bas de l'écran. */
let minuteurMessage = null;
export function message(texte, variante = '') {
  let zone = $('#message');
  if (!zone) {
    zone = el('div', { id: 'message', class: 'message', role: 'status', 'aria-live': 'polite' });
    document.body.append(zone);
  }
  zone.className = `message ${variante}`.trim();
  zone.textContent = texte;
  zone.classList.add('visible');
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => zone.classList.remove('visible'), 3200);
}

/** Boîte de dialogue modale. `contenu` reçoit une fonction pour la fermer. */
export function dialogue(titre, contenu, { largeur = '' } = {}) {
  const modale = el('dialog', { class: 'dialogue', style: largeur ? `--largeur:${largeur}` : null });
  const fermer = () => modale.close();
  const fermeture = el('button', {
    type: 'button', class: 'bouton-icone', onclick: fermer, 'aria-label': 'Fermer',
  });
  fermeture.append(icone('fermer'));
  modale.append(
    el('header', { class: 'dialogue-entete' }, [el('h2', { text: titre }), fermeture]),
    el('div', { class: 'dialogue-corps' }, contenu(fermer)),
  );
  modale.addEventListener('close', () => modale.remove());
  // Un clic sur le fond ferme, mais seulement s'il y a commencé : une
  // sélection de texte relâchée hors de la boîte produit aussi un clic sur le
  // fond, et faisait perdre toute la saisie.
  let gesteSurLeFond = false;
  modale.addEventListener('pointerdown', (evenement) => {
    gesteSurLeFond = evenement.target === modale;
  });
  modale.addEventListener('click', (evenement) => {
    if (evenement.target === modale && gesteSurLeFond) fermer();
    gesteSurLeFond = false;
  });
  document.body.append(modale);
  modale.showModal();
  const premier = modale.querySelector('input, select, textarea, button:not(.bouton-icone)');
  if (premier) premier.focus();
  return modale;
}

export function confirmer(titre, texte, { libelleAction = 'Confirmer', danger = false } = {}) {
  return new Promise((resoudre) => {
    let reponse = false;
    const modale = dialogue(titre, (fermer) => [
      el('p', { class: 'dialogue-texte', text: texte }),
      el('div', { class: 'dialogue-actions' }, [
        bouton('Annuler', { classe: 'bouton', onclick: fermer }),
        bouton(libelleAction, {
          classe: `bouton ${danger ? 'bouton-danger' : 'bouton-primaire'}`,
          onclick: () => { reponse = true; fermer(); },
        }),
      ]),
    ], { largeur: '26rem' });
    modale.addEventListener('close', () => resoudre(reponse));
  });
}

/** Étoiles de notation, en lecture seule. */
export function etoiles(note, max = 5) {
  const conteneur = el('span', {
    class: 'etoiles',
    title: `${note} sur ${max}`,
    'aria-label': `Noté ${note} sur ${max}`,
  });
  for (let i = 1; i <= max; i += 1) {
    const remplissage = Math.min(1, Math.max(0, note - i + 1));
    const etoile = icone('etoile', 'etoile');
    etoile.style.setProperty('--remplissage', `${Math.round(remplissage * 100)}%`);
    conteneur.append(etoile);
  }
  conteneur.append(el('span', { class: 'etoiles-valeur', text: formaterNote(note) }));
  return conteneur;
}

export const formaterNote = (note) => (
  Number.isInteger(note) ? String(note) : note.toFixed(1).replace('.', ',')
);

export function pluriel(nombre, singulier, pluriel_) {
  return `${nombre} ${nombre > 1 ? pluriel_ : singulier}`;
}
