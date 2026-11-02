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
  seize: 16, dix7: 17, dixhuit: 18, vingt: 20, vingtquatre: 24, trente: 30, cinquante: 50,
}));

function nombre(mot) {
  const brut = String(mot).trim();
  if (/^\d+$/.test(brut)) return Number(brut);
  const nu = sansAccent(brut).toLowerCase().replace(/[\s-]/g, '');
  return NOMBRES.get(nu) ?? null;
}

const CHIFFRE = '\\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|vingt(?:[\\s-]quatre)?|trente|cinquante';

/** Les couleurs, dites comme on les dit. */
const COULEURS_DITES = [
  [/\b(?:p[ée]tillants?|mousseux|champagnes?|cr[ée]mants?|prosecco|spumante)\b/i, 'petillant'],
  [/\b(?:liquoreux|moelleux|doux\s+naturels?)\b/i, 'liquoreux'],
  [/\bros[ée]s?\b/i, 'rose'],
  [/\bblancs?\b/i, 'blanc'],
  [/\brouges?\b/i, 'rouge'],
];

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
  ['producteur', /\b(?:producteur|vigneron|r[ée]coltant|[ée]labor[ée]\s+par|vinifi[ée]\s+par)\b\s*:?\s*/i],
  ['region', /\b(?:r[ée]gion|appellation|terroir)\b\s*:?\s*/i],
  ['cepage', /\b(?:c[ée]pages?|assemblage)\b\s*:?\s*/i],
  ['source', /\b(?:achet[ée]\s+(?:chez|[àa]|au)|provenance|fournisseur|caviste)\b\s*:?\s*/i],
  ['emplacementPrecis', /\b(?:casier|rang[ée]e|[ée]tag[èe]re|emplacement)\b\s*:?\s*/i],
  ['note', /\b(?:note|remarque|commentaire|observation)\b\s*:?\s*/i],
  ['nom', /\b(?:nom|cuv[ée]e)\b\s*:?\s*/i],
];

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

  // 1. La couleur : un mot, sans ambiguïté possible avec le reste.
  for (const [motif, cle] of COULEURS_DITES) {
    if (consommer(motif)) { champs.couleur = cle; break; }
  }

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
  const quantite = consommer(new RegExp(`\\b(${CHIFFRE})\\s*(?:bouteilles?|flacons?)\\b`, 'i'))
    || consommer(new RegExp(`\\b(${CHIFFRE})\\s*(?:fois|exemplaires?)\\b`, 'i'));
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
    const fin = apres.search(/[,.;]|\b(?:producteur|vigneron|r[ée]coltant|r[ée]gion|appellation|terroir|c[ée]pages?|assemblage|note|remarque|commentaire|observation|casier|rang[ée]e|[ée]tag[èe]re|emplacement|cuv[ée]e)\b/i);
    const valeur = (fin < 0 ? apres : apres.slice(0, fin)).trim();
    if (!valeur) continue;
    champs[cle] = valeur;
    flot = `${flot.slice(0, depart)} ${apres.slice(fin < 0 ? apres.length : fin)} `;
  }

  // 8. Ce qui n'a pas trouvé preneur. Le premier morceau nomme le vin, parce
  //    qu'on le dit d'abord ; un deuxième morceau, s'il reste, est une
  //    précision que l'on propose plutôt que de la placer d'office.
  const restes = flot
    .split(/[,.;]| \b(?:et|puis|avec|dans|de la|du|au)\b /i)
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
