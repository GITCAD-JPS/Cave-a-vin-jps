/* Service worker : la cave reste consultable sans réseau, y compris au sous-sol.
   Changez VERSION à chaque modification des fichiers pour forcer la mise à jour. */

const VERSION = 'cave-a-vin-v19';

const COQUILLE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/styles.css',
  './assets/js/app.js',
  './assets/js/accords.js',
  './assets/js/composants.js',
  './assets/js/dom.js',
  './assets/js/etiquette.js',
  './assets/js/export.js',
  './assets/js/formulaires.js',
  './assets/js/model.js',
  './assets/js/photos.js',
  './assets/js/store.js',
  './assets/js/nuage.js',
  './assets/js/nuage-configuration.js',
  './assets/js/theme.js',
  './assets/js/vues/accords.js',
  './assets/js/vues/cave.js',
  './assets/js/vues/degustations.js',
  './assets/js/vues/fiche.js',
  './assets/js/vues/photo.js',
  './assets/js/vues/reglages.js',
  './assets/js/vues/statistiques.js',
  './assets/vendor/tesseract/tesseract.min.js',
  './assets/icons/icone.svg',
  './assets/icons/icone-180.png',
  './assets/icons/icone-192.png',
  './assets/icons/icone-512.png',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(COQUILLE);
      await self.skipWaiting();
  })());
});

/**
 * Le moteur de lecture pèse une dizaine de méga-octets : le précharger
 * imposerait cette attente à la première ouverture, alors que la plupart des
 * consultations ne lisent aucune étiquette. Il est donc mis en cache à la
 * première lecture, par la règle générale du gestionnaire de requêtes, et
 * reste disponible hors ligne ensuite.
 */


self.addEventListener('activate', (evenement) => {
  evenement.waitUntil((async () => {
    const noms = await caches.keys();
    await Promise.all(noms.filter((nom) => nom !== VERSION).map((nom) => caches.delete(nom)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET' || !requete.url.startsWith(self.location.origin)) return;

  // Navigation : on tente le réseau puis on retombe sur la page mise en cache.
  if (requete.mode === 'navigate') {
    evenement.respondWith((async () => {
      try {
        return await fetch(requete);
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  evenement.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const enCache = await cache.match(requete);
    if (enCache) {
      // Rafraîchissement discret en arrière-plan.
      fetch(requete).then((reponse) => {
        if (reponse.ok) cache.put(requete, reponse.clone());
      }).catch(() => {});
      return enCache;
    }
    try {
      const reponse = await fetch(requete);
      if (reponse.ok) cache.put(requete, reponse.clone());
      return reponse;
    } catch (erreur) {
      return Response.error();
    }
  })());
});
