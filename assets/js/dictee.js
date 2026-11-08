// Répartition d'une fiche dictée à la voix.
//
// L'iPhone sait déjà écrire sous la dictée : le micro du clavier suffit, et
// rien n'a besoin d'être installé ni autorisé. Ce qui manquait, c'était de
// savoir ce que la phrase dit. « Bolgheri Sabbiato de Sensi, Toscane, 2021,
// rouge, 14 degrés 5, deux bouteilles dans l'armoire » porte huit
// renseignements, et la parole ne les sépare pas comme un formulaire.
//
// Le dépouillement va donc du plus sûr au plus vague : d'abord ce qui a une
// forme reconnaissable entre mille — une année, un degré, un nombre de
// bouteilles — que l'on retire du texte au passage, puis les tournures
// annoncées (« producteur X », « cépage Y »), et ce qui reste à la fin est le
// nom du vin. La ponctuation n'est pas requise, la dictée n'en met guère.

const sansAccent = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Les petits nombres se disent plus souvent qu'ils ne s'écrivent. */
const NOMBRES = new Map(Object.entries({
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15,
  seize: 16, dixsept: 17, dixhuit: 18, dixneuf: 19, vingt: 20, vingtdeux: 22, vingttrois: 23,
  vingtquatre: 24, vingtcinq: 25, vingtsix: 26, trente: 30, cinquante: 50,
}));

function nombre(mot) {
  const brut = String(mot).trim();
  if (/^\d+$/.test(brut)) return Number(brut);
  const nu = sansAccent(brut).toLowerCase().replace(/[\s-]/g, '');
  return NOMBRES.get(nu) ?? null;
}

// Les bornes d'un mot. `\b` ne les reconnaît qu'entre lettres sans accent : il
// ne voyait pas la fin de « rosé » ni le début d'« élaboré », et la dictée,
// qui écrit les accents, n'en comprenait aucun. Le trait d'union compte comme
// une lettre, pour que « vingt-deux » ne se lise pas « deux ».
const DEBUT = '(?<![\\p{L}\\p{N}-])';
const FIN = '(?![\\p{L}\\p{N}])';
const mot = (corps, suite = '') => new RegExp(`${DEBUT}(?:${corps})${FIN}${suite}`, 'iu');

// Les composés d'abord : « dix » ne doit pas prendre « dix-sept » de court.
const CHIFFRE = '\\d+|dix[\\s-](?:sept|huit|neuf)|vingt[\\s-](?:deux|trois|quatre|cinq|six)'
  + '|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize'
  + '|vingt|trente|cinquante';

/** Les couleurs, dites comme on les dit. */
const COULEURS_DITES = [
  [mot('p[ée]tillants?|mousseux|champagnes?|cr[ée]mants?|prosecco|spumante'), 'petillant'],
  [mot('liquoreux|moelleux|doux\\s+naturels?'), 'liquoreux'],
  [mot('ros[ée]s?'), 'rose'],
  [mot('blancs?'), 'blanc'],
  [mot('rouges?'), 'rouge'],
];

// Une couleur qui fait partie d'un nom : « Pinot Blanc », « Cheval Blanc »,
// « Blanc de Blancs ». Elle dit encore la couleur quand rien d'autre ne la
// dit, mais elle reste dans le nom.
const AVANT_UNE_COULEUR_DE_NOM = /(?:pinot|sauvignon|chenin|grenache|cheval|ugni|merlot|mont|blancs?\s+de)\s+$/iu;
const APRES_UNE_COULEUR_DE_NOM = /^\s+de\s/iu;

/** Les trois rangements de la cave, et les façons de les nommer. */
const EMPLACEMENTS_DITS = [
  [/\bcave\s+(?:de\s+)?droite\b|\b(?:[àa]\s+)?droite\b/i, 'caveDroite'],
  [/\bcave\s+(?:de\s+)?gauche\b|\b(?:[àa]\s+)?gauche\b/i, 'caveGauche'],
  [/\barmoire\b/i, 'armoire'],
];

// Les tournures qui annoncent un champ. Ce qui suit, jusqu'à la prochaine
// annonce ou à la fin du segment, lui revient.
const ANNONCES = [
  // Seuls les mots qui ne servent qu'à annoncer : « domaine », « château » ou
  // « maison » ouvrent bien plus souvent le nom du vin — « Domaine de
  // Villemajou » — qu'ils n'annoncent un producteur.
  ['producteur', mot('producteur|vigneron|r[ée]coltant|[ée]labor[ée]\\s+par|vinifi[ée]\\s+par', '\\s*:?\\s*')],
  ['region', mot('r[ée]gion|appellation|terroir', '\\s*:?\\s*')],
  ['cepage', mot('c[ée]pages?|assemblage', '\\s*:?\\s*')],
  ['source', mot('achet[ée]\\s+(?:chez|[àa]|au)|provenance|fournisseur|caviste', '\\s*:?\\s*')],
  ['emplacementPrecis', mot('casier|rang[ée]e|[ée]tag[èe]re|emplacement', '\\s*:?\\s*')],
  ['note', mot('note|remarque|commentaire|observation', '\\s*:?\\s*')],
  ['nom', mot('nom|cuv[ée]e', '\\s*:?\\s*')],
];

// Là où s'arrête ce qu'une annonce a pris : une ponctuation, ou l'annonce suivante.
const FIN_ANNONCE = new RegExp(`[,.;]|${DEBUT}(?:producteur|vigneron|r[ée]coltant|r[ée]gion|appellation`
  + `|terroir|c[ée]pages?|assemblage|note|remarque|commentaire|observation|casier|rang[ée]e`
  + `|[ée]tag[èe]re|emplacement|cuv[ée]e)${FIN}`, 'iu');

const VIDE = /^[\s,.;:–—-]*$/;

// Les mots par lesquels un nom de vin commence quand il porte déjà son domaine.
const OUVRE_UN_NOM = /^(?:domaine|ch[âa]teau|clos|mas|maison|cave|caves|casa|cascina|tenuta|castello|azienda|cantina|bodega|weingut|quinta|finca|podere|villa|abbaye|manoir)\b/i;

/**
 * Dépouille une fiche dictée.
 *
 * Rend les champs reconnus, et `reste` pour ce qui n'a pas trouvé sa place.
 * Ne devine jamais contre l'évidence : un champ absent vaut mieux qu'un champ
 * faux, que l'on ne penserait pas à corriger.
 */
export function analyserDictee(texte) {
  let flot = ` ${String(texte || '').replace(/\s+/g, ' ')} `;
  const champs = {};
  // Retirer ce qui vient d'être reconnu, pour que la suite ne le relise pas.
  const consommer = (motif, garder = ' ') => {
    const trouve = flot.match(motif);
    if (trouve) flot = flot.replace(motif, garder);
    return trouve;
  };

  // 1. La couleur. Celle qui est dite pour elle-même l'emporte, et se retire
  //    du texte. Celle qui fait partie d'un nom (« Pinot Blanc ») ne sert que
  //    si rien d'autre ne la dit, et reste dans le nom : « Château Cheval
  //    Blanc, rouge » est un rouge qui s'appelle Cheval Blanc.
  let couleurDeNom = '';
  for (const [motif, cle] of COULEURS_DITES) {
    const global = new RegExp(motif.source, 'giu');
    const seule = [...flot.matchAll(global)].find((m) => {
      const dansUnNom = AVANT_UNE_COULEUR_DE_NOM.test(flot.slice(0, m.index))
        || APRES_UNE_COULEUR_DE_NOM.test(flot.slice(m.index + m[0].length));
      if (dansUnNom && !couleurDeNom) couleurDeNom = cle;
      return !dansUnNom;
    });
    if (seule) {
      champs.couleur = cle;
      flot = `${flot.slice(0, seule.index)} ${flot.slice(seule.index + seule[0].length)}`;
      break;
    }
  }
  if (!champs.couleur && couleurDeNom) champs.couleur = couleurDeNom;

  // 2. La contenance, avant les nombres : « magnum » ou « 75 centilitres ».
  if (consommer(/\bmagnums?\b/i)) champs.volume = '150 cl (Magnum)';
  else if (consommer(/\bdemi[\s-]bouteilles?\b/i)) champs.volume = '37.5 cl';
  else {
    const vol = consommer(/\b(\d{2,3})\s*(?:centilitres?|cl)\b/i);
    if (vol) champs.volume = `${Number(vol[1])} cl`;
  }

  // 3. Le millésime : quatre chiffres d'une année plausible, rien d'autre
  //    n'y ressemble dans une phrase de cave.
  const annee = consommer(/\b(1[89]\d{2}|20\d{2})\b/);
  if (annee) champs.millesime = Number(annee[1]);

  // 4. Le degré. « 14 degrés 5 » se dit plus souvent que « 14,5 % ».
  // La décimale ne doit pas happer le nombre de bouteilles qui suit :
  // « 12 degrés 2 bouteilles » se lisait 12,2.
  const degre = consommer(/\b(\d{1,2})\s*(?:degr[ée]s?|°|%)\s*(\d)\b(?!\s*(?:bouteilles?|flacons?|fois|exemplaires?))/i)
    || consommer(/\b(\d{1,2})[,.](\d)\s*(?:degr[ée]s?|°|%|vol)/i)
    || consommer(/\b(\d{1,2})\s*(?:degr[ée]s?|°|%)(?:\s*vol)?/i);
  if (degre) {
    const valeur = degre[2] ? Number(`${degre[1]}.${degre[2]}`) : Number(degre[1]);
    if (valeur >= 4 && valeur <= 22) champs.degre = valeur;
  }

  // 5. Le rangement, avant le nombre de bouteilles : « cave droite » porte un
  //    mot que l'on prendrait sinon pour le producteur.
  for (const [motif, cle] of EMPLACEMENTS_DITS) {
    if (consommer(motif)) { champs.emplacement = cle; break; }
  }

  // 6. Le nombre de bouteilles, en chiffres ou en toutes lettres.
  const quantite = consommer(new RegExp(`${DEBUT}(${CHIFFRE})\\s*(?:bouteilles?|flacons?)${FIN}`, 'iu'))
    || consommer(new RegExp(`${DEBUT}(${CHIFFRE})\\s*(?:fois|exemplaires?)${FIN}`, 'iu'));
  if (quantite) {
    const n = nombre(quantite[1]);
    if (n !== null && n >= 0 && n <= 999) champs.quantite = n;
  }

  // 7. Les tournures annoncées. Chacune prend ce qui la suit jusqu'à la
  //    prochaine annonce, une virgule ou la fin.
  for (const [cle, motif] of ANNONCES) {
    const depart = flot.search(motif);
    if (depart < 0) continue;
    const apres = flot.slice(depart).replace(motif, '');
    const fin = apres.search(FIN_ANNONCE);
    const valeur = (fin < 0 ? apres : apres.slice(0, fin)).trim();
    if (!valeur) continue;
    champs[cle] = valeur;
    flot = `${flot.slice(0, depart)} ${apres.slice(fin < 0 ? apres.length : fin)} `;
  }

  // 8. Ce qui n'a pas trouvé preneur. Le premier morceau nomme le vin, parce
  //    qu'on le dit d'abord ; un deuxième morceau, s'il reste, est une
  //    précision que l'on propose plutôt que de la placer d'office.
  const restes = flot
    // « du », « de la », « au » ne séparent rien : ils tiennent ensemble
    // « Domaine du Mont d'Or » ou « Château de la Tour ».
    .split(/[,.;]| \b(?:et|puis|avec|dans)\b /i)
    .map((m) => m.replace(/^\s*(?:le|la|les|l'|un|une|des|c'est|il\s+y\s+a)\s+/i, '').trim())
    .filter((m) => m && !VIDE.test(m) && m.length > 1);

  if (!champs.nom && restes.length) champs.nom = restes.shift();

  // « Bolgheri Sabbiato de Sensi » nomme le vin puis son producteur, tandis que
  // « Domaine de Villemajou » n'en fait qu'un : c'est le mot d'ouverture qui
  // tranche, et l'on ne coupe que s'il reste un vrai nom devant.
  if (champs.nom && !champs.producteur && !OUVRE_UN_NOM.test(champs.nom)) {
    const coupe = champs.nom.match(/^(.*\S)\s+(?:de|d'|d’|chez|par)\s+(\S[^,]*)$/i);
    if (coupe && coupe[1].split(' ').length >= 2) {
      champs.nom = coupe[1].trim();
      champs.producteur = coupe[2].trim();
    }
  }
  if (restes.length) champs.reste = restes;
  return champs;
}
