// Lecture d'étiquette par le service de vision de Google.
//
// Le moteur embarqué dans l'application ne sait chercher que des lignes
// droites. Or beaucoup d'étiquettes portent le nom du domaine en arc de cercle
// sur un verre bombé : il rend alors des bribes. Ce service-ci sait redresser
// un texte courbé avant de le lire, et c'est la seule façon mesurée d'obtenir
// le nom du vin.
//
// Le prix à payer est explicite : la photo quitte l'appareil le temps de la
// lecture. C'est pourquoi rien n'est envoyé tant qu'une clé n'a pas été
// déposée dans les réglages, et pourquoi le moteur embarqué reste là, prêt à
// prendre le relais dès que ce service refuse ou que le réseau manque.

const POINT = 'https://vision.googleapis.com/v1/images:annotate';
// Le service facture à l'image, pas au pixel, et lit très bien à cette taille.
// Plus grand ne fait qu'allonger l'envoi depuis un téléphone en cave.
const COTE_ENVOI = 1600;
const QUALITE_ENVOI = 0.85;
// Une cave suisse mêle le français, l'italien et l'anglais des contre-étiquettes.
const LANGUES = ['fr', 'it', 'en'];
const DELAI = 20000;

/** Les raisons de refus que l'on sait expliquer en français. */
const EXPLICATIONS = {
  API_KEY_INVALID: 'la clé est refusée, vérifiez qu’elle a été copiée en entier',
  API_KEY_SERVICE_BLOCKED: 'cette clé n’a pas le droit d’utiliser la lecture d’étiquettes',
  API_KEY_HTTP_REFERRER_BLOCKED: 'cette clé n’autorise pas ce site',
  SERVICE_DISABLED: 'le service de lecture n’est pas encore activé sur votre projet Google',
  RATE_LIMIT_EXCEEDED: 'le quota du mois est atteint',
  RESOURCE_EXHAUSTED: 'le quota du mois est atteint',
  BILLING_DISABLED: 'la facturation n’est pas activée sur votre projet Google',
};

/** Ce que le service a répondu, dit en français. */
function expliquer(charge, statut) {
  const erreur = charge?.error || charge?.responses?.[0]?.error;
  const raison = erreur?.details?.find((d) => d.reason)?.reason;
  if (raison && EXPLICATIONS[raison]) return EXPLICATIONS[raison];
  if (erreur?.status && EXPLICATIONS[erreur.status]) return EXPLICATIONS[erreur.status];
  if (erreur?.message) return erreur.message;
  return `réponse inattendue (${statut})`;
}

/** La photo, réduite puis mise sous la forme que le service attend. */
async function preparer(image) {
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
    .catch(() => createImageBitmap(image));
  const facteur = Math.min(1, COTE_ENVOI / (Math.max(bitmap.width, bitmap.height) || 1));
  const toile = document.createElement('canvas');
  toile.width = Math.max(1, Math.round(bitmap.width * facteur));
  toile.height = Math.max(1, Math.round(bitmap.height * facteur));
  toile.getContext('2d').drawImage(bitmap, 0, 0, toile.width, toile.height);
  if (bitmap.close) bitmap.close();

  const jpeg = await new Promise((r) => toile.toBlob(r, 'image/jpeg', QUALITE_ENVOI));
  if (!jpeg) throw new Error('photo impossible à préparer');
  // Le service attend du base64 sans l'en-tête « data: » que pose le lecteur.
  const lu = await new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(String(lecteur.result));
    lecteur.onerror = () => rejeter(new Error('photo illisible'));
    lecteur.readAsDataURL(jpeg);
  });
  return lu.slice(lu.indexOf(',') + 1);
}

/**
 * Lit une ou plusieurs photos d'étiquette.
 *
 * Les deux faces partent dans un seul appel : le service traite chaque image
 * séparément, et un aller-retour de moins compte depuis un téléphone.
 *
 * Rend `{ texte, confiance }`, ou lève avec un message montrable tel quel.
 */
export async function lireParGoogle(images, cle) {
  const photos = (Array.isArray(images) ? images : [images]).filter(Boolean);
  if (!photos.length) throw new Error('aucune photo à lire');
  if (!cle) throw new Error('aucune clé enregistrée');

  const requetes = await Promise.all(photos.map(async (photo) => ({
    image: { content: await preparer(photo) },
    features: [{ type: 'TEXT_DETECTION' }],
    imageContext: { languageHints: LANGUES },
  })));

  const abandon = new AbortController();
  const minuteur = setTimeout(() => abandon.abort(), DELAI);
  let reponse;
  try {
    reponse = await fetch(`${POINT}?key=${encodeURIComponent(cle)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: requetes }),
      signal: abandon.signal,
    });
  } catch (erreur) {
    throw new Error(erreur.name === 'AbortError' ? 'le service n’a pas répondu' : 'service injoignable');
  } finally {
    clearTimeout(minuteur);
  }

  const charge = await reponse.json().catch(() => null);
  if (!reponse.ok || charge?.error) throw new Error(expliquer(charge, reponse.status));

  // Une image illisible rend une réponse vide plutôt qu'une erreur. Seule une
  // erreur portée par toutes les images vaut un échec.
  const resultats = charge?.responses || [];
  const fautive = resultats.find((r) => r?.error);
  if (fautive && resultats.every((r) => r?.error)) throw new Error(expliquer(charge, reponse.status));

  const morceaux = resultats
    .map((r) => r?.fullTextAnnotation?.text || r?.textAnnotations?.[0]?.description || '')
    .filter(Boolean);
  if (!morceaux.length) throw new Error('aucun texte trouvé sur la photo');

  // Le service ne rend pas de note globale. Du texte reconnu par lui vaut
  // mieux que du texte deviné par le moteur embarqué, d'où cette valeur haute,
  // qui sert seulement à départager les deux lectures.
  return { texte: morceaux.join('\n'), confiance: 95 };
}
