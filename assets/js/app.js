// Point d'entrée : routage par ancre, barre de navigation, montage des vues.

import { $, el, icone, message, vider } from './dom.js';
import { installerSuggestions } from './formulaires.js';
import * as store from './store.js';
import { appliquerTheme, suivreSysteme } from './theme.js';

import * as vueCave from './vues/cave.js';
import * as vueFiche from './vues/fiche.js';
import * as vueAccords from './vues/accords.js';
import * as vuePhoto from './vues/photo.js';
import * as vueDegustations from './vues/degustations.js';
import * as vueStatistiques from './vues/statistiques.js';
import * as vueReglages from './vues/reglages.js';

const ONGLETS = [
  { chemin: '/cave', libelle: 'Cave', icone: 'cave' },
  { chemin: '/accords', libelle: 'Accords', icone: 'assiette' },
  { chemin: '/degustations', libelle: 'Journal', icone: 'verre' },
  { chemin: '/statistiques', libelle: 'Stats', icone: 'graphique' },
  { chemin: '/reglages', libelle: 'Réglages', icone: 'reglages' },
];

const ROUTES = [
  { motif: /^\/cave$/, vue: vueCave, titre: 'Cave' },
  { motif: /^\/vin\/([^/]+)$/, vue: vueFiche, titre: 'Fiche', params: ['id'] },
  { motif: /^\/accords$/, vue: vueAccords, titre: 'Accords' },
  { motif: /^\/photo\/([^/]+)$/, vue: vuePhoto, titre: 'Photo', params: ['mode'] },
  { motif: /^\/degustations$/, vue: vueDegustations, titre: 'Dégustations' },
  { motif: /^\/statistiques$/, vue: vueStatistiques, titre: 'Statistiques' },
  { motif: /^\/reglages$/, vue: vueReglages, titre: 'Réglages' },
];

const principal = $('#principal');
let routeCourante = null;

function cheminCourant() {
  const ancre = location.hash.replace(/^#/, '');
  return ancre.startsWith('/') ? ancre : '/cave';
}

function resoudre(chemin) {
  for (const route of ROUTES) {
    const trouve = chemin.match(route.motif);
    if (!trouve) continue;
    const params = {};
    (route.params || []).forEach((nom, index) => { params[nom] = decodeURIComponent(trouve[index + 1]); });
    return { ...route, params };
  }
  return null;
}

/**
 * Navigue vers un chemin. `naviguer(null)` redessine la vue courante, ce dont
 * les vues se servent après une modification des données.
 */
function naviguer(chemin) {
  if (chemin === null) {
    rendre();
    return;
  }
  if (cheminCourant() === chemin) {
    rendre();
    return;
  }
  location.hash = chemin;
}

function rendre() {
  const chemin = cheminCourant();
  const route = resoudre(chemin);

  if (!route) {
    location.replace('#/cave');
    return;
  }
  const changementDeVue = routeCourante?.vue !== route.vue;
  routeCourante = route;
  document.title = `${route.titre} — Cave à vin`;

  if (changementDeVue) vider(principal);
  route.vue.rendre(principal, { naviguer, params: route.params });
  majOnglets(chemin);
  if (changementDeVue) principal.scrollTo({ top: 0 });
}

function majOnglets(chemin) {
  for (const lien of document.querySelectorAll('.onglet')) {
    const actif = chemin === lien.dataset.chemin
      || (lien.dataset.chemin === '/cave'
        && RATTACHE_A_LA_CAVE.some((prefixe) => chemin.startsWith(prefixe)));
    lien.classList.toggle('actif', actif);
    if (actif) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  }
}

function construireNavigation() {
  const barre = $('#navigation');
  vider(barre);
  for (const onglet of ONGLETS) {
    const lien = el('a', {
      class: 'onglet',
      href: `#${onglet.chemin}`,
      dataset: { chemin: onglet.chemin },
    }, [icone(onglet.icone), el('span', { text: onglet.libelle })]);
    barre.append(lien);
  }
}

/** L'onglet Cave reste actif pendant qu'on est sur une fiche ou une photo. */
const RATTACHE_A_LA_CAVE = ['/vin/', '/photo/'];

async function demarrer() {
  construireNavigation();
  $('#ajouter-vin').addEventListener('click', () => naviguer('/photo/ajout'));
  window.addEventListener('hashchange', rendre);

  try {
    await store.charger();
  } catch (erreur) {
    console.error(erreur);
    vider(principal).append(el('div', { class: 'etat-vide' }, [
      el('h3', { text: 'Chargement impossible' }),
      el('p', {
        text: "Les données de la cave n'ont pas pu être lues. Ouvrez l'application "
          + 'depuis un serveur web plutôt que directement depuis le fichier.',
      }),
      el('p', { class: 'discret', text: String(erreur.message || erreur) }),
    ]));
    return;
  }

  appliquerTheme(store.preferences().theme);
  suivreSysteme(() => store.preferences().theme);
  installerSuggestions();
  store.abonner(installerSuggestions);

  document.body.classList.remove('chargement');
  avertirSiStockageRefuse();
  surveillerLePartage();
  rendre();
  suivreLesDonnees();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((erreur) => {
      console.info('Mode hors ligne indisponible', erreur);
    });
  }
}

/**
 * Certains navigateurs refusent de garder quoi que ce soit à une page
 * affichée dans le cadre d'un autre site, ou en navigation privée. Mieux vaut
 * le dire franchement que de laisser perdre une soirée de saisie.
 */
function avertirSiStockageRefuse() {
  if (store.stockageDurable()) return;
  document.body.prepend(el('div', { class: 'bandeau-alerte', role: 'status' }, [
    el('strong', { text: 'Vos modifications ne seront pas conservées. ' }),
    el('span', {
      text: 'Ce navigateur refuse le stockage à cette page. Exportez une '
        + 'sauvegarde depuis les réglages avant de fermer.',
    }),
  ]));
}

// Les vues où un redessin serait malvenu : on y est en train de faire quelque
// chose, et le contenu d'une liste n'y est pas ce qu'on regarde.
const VUES_EN_COURS = ['/photo/'];

/**
 * Redessine la vue courante quand la cave change sous elle.
 *
 * Les données arrivent après l'affichage : au démarrage, et à chaque fois que
 * l'autre appareil modifie quelque chose. Sans cela, rejoindre une cave
 * partagée laissait un écran vide jusqu'à ce qu'on change d'onglet, ce qui
 * ressemblait à un échec alors que tout était arrivé.
 *
 * Un dialogue ouvert ou un parcours photo en cours suspend le redessin : on
 * ne retire pas un formulaire des mains de quelqu'un qui le remplit.
 */
function suivreLesDonnees() {
  let signature = empreinte();
  store.abonner(() => {
    const courante = empreinte();
    if (courante === signature) return;
    signature = courante;
    if (document.querySelector('dialog[open]')) return;
    if (VUES_EN_COURS.some((prefixe) => cheminCourant().startsWith(prefixe))) return;
    rendre();
  });
}

const empreinte = () => `${store.vins().length}:${store.degustations().length}:${store.donnees().majLe}`;

// Ce que dit le bandeau selon la raison du non-partage. Une cave qui n'est
// pas partagée n'est pas une panne, mais le dire évite de saisir une soirée
// de dégustations en croyant qu'elles rejoignent l'autre téléphone.
const AVERTISSEMENTS = {
  sansCode: {
    titre: 'Cette cave n’est pas encore partagée. ',
    texte: 'Ce que vous saisissez reste dans ce navigateur. Créez la cave '
      + 'partagée, ou rejoignez-la avec son code, depuis les réglages.',
  },
  local: {
    titre: 'Aucun partage possible sur cette version. ',
    texte: 'Ce que vous saisissez reste dans ce navigateur et ne rejoindra '
      + 'aucun autre appareil.',
  },
};

/**
 * Prévient quand cette cave ne rejoint aucun autre appareil.
 *
 * L'avertissement attend que la synchronisation ait tranché : au démarrage
 * elle cherche encore, et conclure trop tôt serait faux. Il mène aux réglages,
 * car savoir sans savoir quoi faire ne sert à rien.
 */
function surveillerLePartage() {
  let annonce = false;
  const verifier = () => {
    const avertissement = AVERTISSEMENTS[store.etatSynchro()];
    if (annonce || !avertissement) return;
    annonce = true;
    document.body.prepend(el('div', { class: 'bandeau-alerte', role: 'status' }, [
      el('strong', { text: avertissement.titre }),
      el('span', { text: avertissement.texte }),
      el('a', { class: 'bandeau-lien', href: '#/reglages', text: 'Ouvrir les réglages' }),
    ]));
  };
  store.abonner(verifier);
  verifier();
}

window.addEventListener('error', (evenement) => {
  console.error(evenement.error || evenement.message);
  message('Une erreur est survenue', 'erreur');
});

demarrer();
