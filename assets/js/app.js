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
    surveillerLesMisesAJour();
    navigator.serviceWorker.register('sw.js')
      .then((enregistrement) => enregistrement.update().catch(() => {}))
      .catch((erreur) => {
        console.info('Mode hors ligne indisponible', erreur);
      });
  }
}

/**
 * Prend la mise à jour dès qu'elle est publiée.
 *
 * S'en remettre aux événements du service worker revenait à dépendre d'un
 * moment imprévisible : la page tournait déjà sur l'ancien code, et il fallait
 * fermer puis rouvrir une seconde fois pour voir la nouvelle version, ce que
 * personne ne devine. On demande donc nous-mêmes au serveur quelle version il
 * publie, au démarrage et chaque fois que l'application revient au premier
 * plan, ce qui est le moment où l'on rouvre son téléphone.
 *
 * Recharger sous les doigts de quelqu'un qui remplit une fiche lui ferait
 * perdre sa saisie : tant qu'une modale est ouverte ou qu'un parcours photo
 * est en cours, on attend, en le disant.
 */
function surveillerLesMisesAJour() {
  let enCours = false;
  let faite = false;

  const appliquer = async () => {
    if (faite) return;
    faite = true;
    // Installer le nouveau service worker avant de recharger, sans quoi la
    // page reviendrait servie par l'ancien et rien n'aurait changé.
    const enregistrement = await navigator.serviceWorker.getRegistration().catch(() => null);
    await enregistrement?.update().catch(() => {});
    location.reload();
  };

  const quandCestSur = () => {
    const occupe = document.querySelector('dialog[open]')
      || VUES_EN_COURS.some((prefixe) => cheminCourant().startsWith(prefixe));
    if (!occupe) {
      appliquer();
      return;
    }
    proposerLaMiseAJour(appliquer);
    document.addEventListener('close', () => {
      if (!document.querySelector('dialog[open]')) quandCestSur();
    }, { capture: true, once: true });
  };

  const verifier = async () => {
    if (enCours || faite) return;
    enCours = true;
    try {
      // Adresse unique et `no-store` : ni le cache du navigateur ni celui du
      // service worker ne peuvent répondre à la place du serveur.
      const reponse = await fetch(`sw.js?v=${Date.now()}`, { cache: 'no-store' });
      if (!reponse.ok) return;
      const publiee = (await reponse.text()).match(/cave-a-vin-v(\d+)/)?.[1];
      if (publiee && publiee !== store.VERSION_APP) quandCestSur();
    } catch (erreur) {
      console.info('Version publiée inconnue', erreur);
    } finally {
      enCours = false;
    }
  };

  verifier();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') verifier();
  });
}

/** Bandeau discret quand la mise à jour doit attendre la fin d'une saisie. */
function proposerLaMiseAJour(recharger) {
  if (document.querySelector('.bandeau-maj')) return;
  const bandeau = el('div', { class: 'bandeau-alerte bandeau-maj', role: 'status' }, [
    el('strong', { text: 'Une mise à jour est prête. ' }),
    el('span', { text: 'Elle s’appliquera dès que vous aurez terminé. ' }),
    el('button', { type: 'button', class: 'bouton-lien', text: 'Recharger maintenant', onclick: recharger }),
  ]);
  document.body.prepend(bandeau);
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
  // Un changement survenu pendant qu'une modale était ouverte était marqué
  // comme vu sans avoir été dessiné : l'écran gardait l'ancien contenu, et
  // aucune notification suivante ne le rattrapait puisque l'empreinte
  // concordait déjà. La marque n'est désormais posée qu'après le dessin, et
  // ce qui a été différé est repris dès que la modale se ferme.
  let differe = false;

  const libre = () => !document.querySelector('dialog[open]')
    && !VUES_EN_COURS.some((prefixe) => cheminCourant().startsWith(prefixe));

  const rafraichir = () => {
    const courante = empreinte();
    if (courante === signature && !differe) return;
    if (!libre()) {
      differe = true;
      return;
    }
    signature = courante;
    differe = false;
    rendre();
  };

  store.abonner(rafraichir);
  // Une modale ne fait pas remonter sa fermeture : on l'attrape à la descente.
  document.addEventListener('close', rafraichir, true);
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
