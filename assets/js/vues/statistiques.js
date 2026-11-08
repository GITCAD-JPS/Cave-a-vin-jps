// Tableau de bord : ce que contient la cave et ce qui en sort.

import { bouton, el, formaterNote, vider } from '../dom.js';
import { barres, section, tuile } from '../composants.js';
import { statistiques } from '../model.js';
import * as store from '../store.js';
import { appliquerFiltres, reinitialiserFiltres } from './cave.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function libelleMois(cle) {
  const [annee, mois] = cle.split('-');
  return `${MOIS[Number(mois) - 1]} ${annee}`;
}

export function rendre(conteneur, { naviguer }) {
  const stats = statistiques(store.vins(), store.degustations());
  vider(conteneur);

  conteneur.append(el('div', { class: 'vue-statistiques' }, [
    el('header', { class: 'entete-vue' }, [el('h1', { text: 'Statistiques' })]),

    el('div', { class: 'grille-tuiles' }, [
      tuile('bouteilles en cave', String(stats.bouteilles)),
      tuile('références', String(stats.references)),
      tuile('vins terminés', String(stats.terminees)),
      tuile('dégustations', String(stats.degustations)),
      tuile('note moyenne', stats.noteMoyenne === null ? '—' : formaterNote(stats.noteMoyenne),
        stats.noteMoyenne === null ? 'aucune note saisie' : 'sur 5'),
      tuile('fiches à vérifier', String(stats.aVerifier)),
    ]),

    stats.aVerifier > 0
      ? el('div', { class: 'encart' }, [
        el('p', {
          text: `${stats.aVerifier} fiches ont une quantité, un emplacement ou une couleur `
            + 'à confirmer, héritées du classeur.',
        }),
        bouton('Les passer en revue', {
          classe: 'bouton bouton-primaire',
          onclick: () => {
            // Partir d'une cave sans filtre : une puce « Rouge » restée posée
            // cachait les fiches à couleur inconnue, justement à vérifier.
            reinitialiserFiltres();
            appliquerFiltres({ anomalies: true, statut: 'en-cave', recherche: '' });
            naviguer('/cave');
          },
        }),
      ])
      : null,

    el('div', { class: 'grille-blocs' }, [
      section('Par couleur', barres(stats.parCouleur, { unite: '', couleurParCle: true })),
      section('Par emplacement', barres(
        [...stats.parEmplacement,
          ...(stats.horsEmplacement ? [{ libelle: 'Non rangées', nombre: stats.horsEmplacement }] : [])],
      )),
      section('Par région', barres(stats.parRegion)),
      section('Par producteur', barres(stats.parProducteur)),
      section('Par millésime', barres(stats.parMillesime)),
      section('Par provenance', barres(stats.parProvenance)),
      stats.degustationsParMois.length
        ? section('Dégustations par mois', barres(
          stats.degustationsParMois.map((m) => ({ ...m, libelle: libelleMois(m.libelle) })),
        ))
        : null,
      stats.parContexte.length ? section('Contextes de dégustation', barres(stats.parContexte)) : null,
    ]),
  ]));
}
