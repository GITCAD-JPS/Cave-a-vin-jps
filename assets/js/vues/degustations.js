// Journal de la cave : ce qui y entre et ce qui en sort, sur une même ligne
// du temps. Les bouteilles rentrées y figurent au même titre que celles qu'on
// a bues, à la maison comme ailleurs.

import { bouton, confirmer, dialogue, el, message, pluriel, selection, vider } from '../dom.js';
import { etatVide, ligneDegustation, ligneEntree } from '../composants.js';
import { journalComplet, sansAccent } from '../model.js';
import { formulaireDegustation } from '../formulaires.js';
import * as store from '../store.js';

const FILTRES = [
  { valeur: '', libelle: 'Tout le journal' },
  { valeur: 'entrees', libelle: 'Bouteilles entrées' },
  { valeur: 'bues', libelle: 'Bouteilles bues' },
  { valeur: 'cave', libelle: 'Bues, issues de la cave' },
  { valeur: 'hors-cave', libelle: 'Bues hors cave' },
  { valeur: 'notees', libelle: 'Bues et notées' },
];

let filtre = '';
let recherche = '';

export function rendre(conteneur, { naviguer }) {
  const toutes = journalComplet(store.vins(), store.degustations());
  const resultats = filtrer(toutes);

  vider(conteneur);
  conteneur.append(el('div', { class: 'vue-degustations' }, [
    el('header', { class: 'entete-vue' }, [
      el('div', {}, [
        el('h1', { text: 'Journal' }),
        el('p', { class: 'discret', text: `${pluriel(resultats.length, 'ligne', 'lignes')} sur ${toutes.length}` }),
      ]),
      // Le journal réunit deux choses, mais on n'y ajoute que des dégustations :
      // une bouteille entre en cave par la fiche du vin, pas par ici.
      bouton('Dégustation', {
        icone: 'plus',
        classe: 'bouton bouton-primaire',
        onclick: () => ouvrirFormulaire(null, naviguer),
      }),
    ]),
    barreOutils(naviguer),
    resultats.length
      ? el('div', { class: 'liste-degustations' }, resultats.map(({ genre, fiche }) => (
        genre === 'entree'
          ? ligneEntree(fiche, { onOuvrir: (id) => naviguer(`/vin/${id}`) })
          : ligneDegustation(fiche, {
            onOuvrir: (id) => naviguer(`/vin/${id}`),
            onModifier: (entree) => ouvrirFormulaire(entree, naviguer),
          })
      )))
      : etatVide('Journal vide', 'Modifiez la recherche, ou ajoutez une bouteille à la cave.'),
  ]));
}

function barreOutils(naviguer) {
  const champRecherche = el('input', {
    type: 'search',
    class: 'recherche',
    placeholder: 'Rechercher dans le journal…',
    value: recherche,
    'aria-label': 'Rechercher dans le journal',
  });
  let minuteur = null;
  champRecherche.addEventListener('input', () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      recherche = champRecherche.value;
      naviguer(null);
      document.querySelector('.vue-degustations .recherche')?.focus();
    }, 200);
  });

  return el('div', { class: 'barre-recherche' }, [
    champRecherche,
    selection(FILTRES, filtre, {
      'aria-label': 'Filtrer le journal',
      onchange: (e) => { filtre = e.target.value; naviguer(null); },
    }),
  ]);
}

function filtrer(lignes) {
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
  return lignes.filter(({ genre, fiche: d }) => {
    if (filtre === 'entrees' && genre !== 'entree') return false;
    // Les quatre filtres suivants ne portent que sur les bouteilles bues.
    if (filtre && filtre !== 'entrees' && genre !== 'degustation') return false;
    if (filtre === 'cave' && !d.vinId) return false;
    if (filtre === 'hors-cave' && d.vinId) return false;
    if (filtre === 'notees' && d.notation === null) return false;
    if (!mots.length) return true;
    const cible = sansAccent([
      d.nom, d.producteur, d.region, d.cepage,
      d.contexte, d.lieu, d.commentaire, d.date, d.dateReception, d.provenance,
    ].filter(Boolean).join(' '));
    return mots.every((m) => cible.includes(m));
  });
}

function ouvrirFormulaire(degustation, naviguer) {
  const titre = degustation ? `Modifier — ${degustation.nom}` : 'Nouvelle dégustation';
  dialogue(titre, (fermer) => {
    const formulaire = formulaireDegustation(degustation, {
      onEnregistre: () => { fermer(); naviguer(null); },
    });
    if (degustation) {
      formulaire.querySelector('.formulaire-actions').prepend(bouton('Supprimer', {
        classe: 'bouton bouton-danger-discret',
        onclick: async () => {
          const accord = await confirmer(
            'Supprimer cette dégustation',
            `L'entrée « ${degustation.nom} » sera retirée du journal.`,
            { libelleAction: 'Supprimer', danger: true },
          );
          if (!accord) return;
          store.supprimerDegustation(degustation.id);
          message('Dégustation supprimée');
          fermer();
          naviguer(null);
        },
      }));
    }
    return formulaire;
  }, { largeur: '44rem' });
}
