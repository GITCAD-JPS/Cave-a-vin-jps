// Accords mets et vins.
//
// La cave n'a pas de connexion à un service extérieur : les accords viennent
// d'une table de profils écrite ici, centrée sur les cépages et appellations
// réellement présents dans cette cave. Chaque profil donne un corps, une
// température de service et une affinité par famille de plats, notée de 0 à 3.
//
// L'ordre de résolution est : cépage, puis appellation, puis couleur seule.

export const PLATS = [
  { cle: 'aperitif', libelle: 'Apéritif' },
  { cle: 'fruitsDeMer', libelle: 'Fruits de mer' },
  { cle: 'poisson', libelle: 'Poisson' },
  { cle: 'volaille', libelle: 'Volaille' },
  { cle: 'viandeBlanche', libelle: 'Viande blanche' },
  { cle: 'viandeRouge', libelle: 'Viande rouge' },
  { cle: 'gibier', libelle: 'Gibier' },
  { cle: 'charcuterie', libelle: 'Charcuterie' },
  { cle: 'pates', libelle: 'Pâtes et risotto' },
  { cle: 'patesFruitsDeMer', libelle: 'Pâtes aux fruits de mer' },
  { cle: 'pizza', libelle: 'Pizza' },
  { cle: 'fromageDoux', libelle: 'Fromages doux' },
  { cle: 'fromageFort', libelle: 'Fromages forts' },
  { cle: 'raclette', libelle: 'Raclette et fondue' },
  { cle: 'epice', libelle: 'Plats épicés' },
  { cle: 'vegetarien', libelle: 'Végétarien' },
  { cle: 'dessert', libelle: 'Dessert' },
];

export const LIBELLE_PLAT = new Map(PLATS.map((p) => [p.cle, p.libelle]));

const profil = (description, temperature, plats) => ({ description, temperature, plats });

// --- profils par cépage -----------------------------------------------------

const PAR_CEPAGE = {
  // Rouges
  barbera: profil('vif et fruité, acidité franche et tanins discrets', '16-18 °C',
    { pates: 3, pizza: 3, charcuterie: 3, viandeRouge: 2,
      volaille: 2, fromageDoux: 2, vegetarien: 2, patesFruitsDeMer: 1 }),
  nebbiolo: profil('tannique et racé, arômes de rose et de goudron', '17-18 °C',
    { gibier: 3, viandeRouge: 3, fromageFort: 3, pates: 2 }),
  sangiovese: profil('cerise et herbes, acidité vive', '16-18 °C',
    { pates: 3, pizza: 3, viandeRouge: 3, charcuterie: 2, volaille: 2, patesFruitsDeMer: 1 }),
  corvina: profil('fruits confits et épices, chaleureux', '17-18 °C',
    { viandeRouge: 3, gibier: 3, fromageFort: 3, pates: 2 }),
  montepulciano: profil('souple et généreux, fruits noirs', '16-18 °C',
    { pizza: 3, pates: 3, viandeRouge: 3, charcuterie: 2 }),
  primitivo: profil('puissant et confituré, léger sucré', '16-18 °C',
    { viandeRouge: 3, gibier: 2, fromageFort: 2, epice: 3, pizza: 2 }),
  negroamaro: profil('épicé et méditerranéen', '16-18 °C',
    { viandeRouge: 3, charcuterie: 2, pates: 2, epice: 2 }),
  merlot: profil('rond et velouté, prune', '16-17 °C',
    { viandeRouge: 3, volaille: 2, viandeBlanche: 3, fromageDoux: 2, pates: 2 }),
  'cabernet sauvignon': profil('structuré, cassis et cèdre', '17-18 °C',
    { viandeRouge: 3, gibier: 3, fromageFort: 2 }),
  'cabernet franc': profil('poivron et framboise, fine trame', '15-16 °C',
    { volaille: 3, viandeBlanche: 2, charcuterie: 2, vegetarien: 2, poisson: 1 }),
  syrah: profil('poivre noir et violette, dense', '16-18 °C',
    { viandeRouge: 3, gibier: 3, epice: 2, charcuterie: 2, fromageFort: 2 }),
  'pinot noir': profil('délicat, petits fruits rouges', '14-16 °C',
    { volaille: 3, viandeBlanche: 3, poisson: 2, fromageDoux: 3,
      vegetarien: 2, charcuterie: 2, patesFruitsDeMer: 1 }),
  tempranillo: profil('cuir et fruits mûrs, élevage boisé', '16-18 °C',
    { viandeRouge: 3, charcuterie: 3, fromageFort: 2, gibier: 2 }),
  'humagne rouge': profil('rustique et sauvage, note ferreuse', '16-17 °C',
    { gibier: 3, viandeRouge: 2, fromageFort: 2, charcuterie: 2 }),
  blaufrankisch: profil('épicé et frais, tanins fins', '15-17 °C',
    { volaille: 3, viandeRouge: 2, charcuterie: 2, pates: 2 }),
  teran: profil('acidulé et minéral, typé istrien', '15-17 °C',
    { charcuterie: 3, viandeRouge: 2, pates: 2, fromageFort: 2 }),
  ciliegiolo: profil('cerise croquante, léger', '14-16 °C',
    { charcuterie: 3, pizza: 2, volaille: 2, pates: 2 }),
  gamaret: profil('coloré et fruité, franc', '15-16 °C',
    { charcuterie: 2, volaille: 2, viandeRouge: 2, raclette: 2 }),
  grenache: profil('fruits rouges mûrs et garrigue, généreux', '16-17 °C',
    { viandeRouge: 3, epice: 2, charcuterie: 2, gibier: 2 }),

  // Blancs
  chardonnay: profil('ample, fruits blancs et beurre', '10-12 °C',
    { poisson: 3, fruitsDeMer: 3, volaille: 3, viandeBlanche: 2,
      fromageDoux: 2, aperitif: 2, patesFruitsDeMer: 2 }),
  chasselas: profil('léger et floral, très désaltérant', '9-11 °C',
    { aperitif: 3, raclette: 3, poisson: 2, fromageDoux: 2, vegetarien: 2, patesFruitsDeMer: 2 }),
  'sauvignon blanc': profil('vif, agrumes et buis', '8-10 °C',
    { aperitif: 3, fruitsDeMer: 3, poisson: 3,
      vegetarien: 3, fromageDoux: 2, patesFruitsDeMer: 3 }),
  pecorino: profil('sapide et salin, belle tension', '10-12 °C',
    { poisson: 3, fruitsDeMer: 3, pates: 2, vegetarien: 2, aperitif: 2, patesFruitsDeMer: 3 }),
  grillo: profil('sec et méditerranéen, amande', '9-11 °C',
    { poisson: 3, fruitsDeMer: 2, epice: 3, volaille: 2, vegetarien: 2, patesFruitsDeMer: 3 }),
  greco: profil('corsé pour un blanc, fruits jaunes', '10-12 °C',
    { poisson: 3, fruitsDeMer: 2, volaille: 2, pates: 2, patesFruitsDeMer: 3 }),
  arneis: profil('floral et poire, rondeur', '10-12 °C',
    { aperitif: 3, poisson: 2, volaille: 2, vegetarien: 2, patesFruitsDeMer: 2 }),
  'pinot gris': profil('riche et épicé, parfois demi-sec', '10-12 °C',
    { epice: 3, volaille: 2, fromageFort: 2, dessert: 2, aperitif: 2, patesFruitsDeMer: 2 }),
  gewurztraminer: profil('exubérant, litchi et rose', '10-12 °C',
    { epice: 3, fromageFort: 3, dessert: 2, aperitif: 2, patesFruitsDeMer: 1 }),
  marsanne: profil('gras et miellé, faible acidité', '11-13 °C',
    { poisson: 2, volaille: 3, fromageFort: 2, viandeBlanche: 2, patesFruitsDeMer: 2 }),
  ermitage: profil('gras et miellé, puissant', '11-13 °C',
    { volaille: 3, fromageFort: 3, viandeBlanche: 2, poisson: 2, patesFruitsDeMer: 1 }),
  heida: profil('altier et salin, notes d’agrumes', '10-12 °C',
    { aperitif: 3, poisson: 2, raclette: 2, fromageDoux: 2, patesFruitsDeMer: 2 }),
  viognier: profil('abricot et fleurs blanches, onctueux', '10-12 °C',
    { epice: 3, volaille: 2, poisson: 2, dessert: 1, patesFruitsDeMer: 1 }),
  malvasia: profil('aromatique et souple', '9-11 °C',
    { aperitif: 3, vegetarien: 2, poisson: 2, dessert: 1, patesFruitsDeMer: 2 }),
  'ribolla gialla': profil('tendu et minéral', '9-11 °C',
    { aperitif: 2, fruitsDeMer: 3, poisson: 3, vegetarien: 2, patesFruitsDeMer: 3 }),
  moscato: profil('muscaté et doux, légèrement pétillant', '7-9 °C',
    { dessert: 3, aperitif: 2, epice: 2 }),
  muscat: profil('raisin frais et fleurs, demi-sec à doux', '8-10 °C',
    { dessert: 3, aperitif: 2, epice: 2 }),
  glera: profil('bulles fines, poire et fleurs', '6-8 °C',
    { aperitif: 3, fruitsDeMer: 2, poisson: 2, dessert: 1, patesFruitsDeMer: 2 }),
};

// --- profils par appellation ------------------------------------------------

const PAR_APPELLATION = {
  amarone: profil('concentré et chaleureux, raisins passerillés', '17-18 °C',
    { gibier: 3, viandeRouge: 3, fromageFort: 3 }),
  ripasso: profil('charnu et épicé, entre deux mondes', '17-18 °C',
    { viandeRouge: 3, pates: 3, fromageFort: 2, gibier: 2 }),
  valpolicella: profil('fruits rouges et fraîcheur', '15-17 °C',
    { pates: 3, pizza: 3, charcuterie: 2, volaille: 2, patesFruitsDeMer: 1 }),
  barolo: profil('tannique et racé, garde longue', '17-18 °C',
    { gibier: 3, viandeRouge: 3, fromageFort: 3 }),
  brunello: profil('profond et élégant', '17-18 °C',
    { viandeRouge: 3, gibier: 3, fromageFort: 2 }),
  bolgheri: profil('assemblage bordelais solaire', '17-18 °C',
    { viandeRouge: 3, gibier: 2, fromageFort: 2 }),
  chianti: profil('cerise et herbes, gouleyant', '16-17 °C',
    { pates: 3, pizza: 3, viandeRouge: 2, charcuterie: 2, patesFruitsDeMer: 1 }),
  sauternes: profil('liquoreux, abricot confit et miel', '8-10 °C',
    { dessert: 3, fromageFort: 3, epice: 2 }),
  champagne: profil('bulles fines et tension', '8-10 °C',
    { aperitif: 3, fruitsDeMer: 3, poisson: 2, dessert: 1, patesFruitsDeMer: 3 }),
  prosecco: profil('bulles légères et fruitées', '6-8 °C',
    { aperitif: 3, fruitsDeMer: 2, pizza: 2, patesFruitsDeMer: 2 }),
  cerasuolo: profil('fruits rouges croquants, servi frais', '12-14 °C',
    { charcuterie: 3, pizza: 2, pates: 2, vegetarien: 2, patesFruitsDeMer: 2 }),
  bourgogne: profil('finesse bourguignonne', '13-16 °C',
    { volaille: 3, viandeBlanche: 2, fromageDoux: 2, poisson: 2, patesFruitsDeMer: 2 }),
  bordeaux: profil('assemblage structuré', '17-18 °C',
    { viandeRouge: 3, gibier: 2, fromageFort: 2 }),
  valais: profil('vin de montagne, franc', '11-16 °C',
    { raclette: 3, charcuterie: 2, fromageDoux: 2, patesFruitsDeMer: 1 }),
  vaud: profil('vin de Lavaux, léger et salin', '9-11 °C',
    { aperitif: 3, raclette: 3, poisson: 2, fromageDoux: 2, patesFruitsDeMer: 2 }),
};

// --- profils de repli par couleur -------------------------------------------

const PAR_COULEUR = {
  // Pas de pâtes aux fruits de mer ici : un rouge dont on ignore le cépage
  // n'est pas une recommandation sur ce plat-là. Seuls les rouges légers
  // nommément reconnus y figurent, et de justesse.
  rouge: profil('rouge de la cave', '16-18 °C',
    { viandeRouge: 2, pates: 2, charcuterie: 2, fromageFort: 2 }),
  blanc: profil('blanc de la cave', '9-12 °C',
    { poisson: 2, aperitif: 2, fruitsDeMer: 2, volaille: 2, patesFruitsDeMer: 3 }),
  rose: profil('rosé, à servir bien frais', '10-12 °C',
    { aperitif: 3, charcuterie: 2, vegetarien: 2, pizza: 2, epice: 2, patesFruitsDeMer: 2 }),
  petillant: profil('bulles', '6-8 °C',
    { aperitif: 3, fruitsDeMer: 2, dessert: 1, patesFruitsDeMer: 2 }),
  liquoreux: profil('vin doux', '8-10 °C',
    { dessert: 3, fromageFort: 3 }),
  inconnu: profil('couleur à préciser dans la fiche', '', {}),
};

// --- notes personnelles -----------------------------------------------------

// Les notes du classeur contiennent déjà des accords éprouvés. Quand la note
// d'un vin parle d'un plat, cet avis prime sur la table générique.
const INDICES_NOTE = {
  poisson: ['poisson', 'saumon', 'truite', 'cabillaud', 'dorade'],
  fruitsDeMer: ['fruits de mer', 'crustac', 'huitre', 'huître', 'coquillage', 'coquilles'],
  volaille: ['volaille', 'poulet', 'dinde', 'pintade', 'canard'],
  viandeRouge: ['viande rouge', 'viandes rouges', 'boeuf', 'bœuf', 'grillade',
    'entrecote', 'entrecôte', 'rôti', 'roti'],
  gibier: ['gibier', 'chevreuil', 'sanglier', 'cerf'],
  charcuterie: ['charcuterie', 'saucisson', 'jambon'],
  pates: ['pâtes', 'pates', 'risotto', 'lasagne'],
  patesFruitsDeMer: ['pâtes aux fruits de mer', 'pates aux fruits de mer',
    'spaghetti aux fruits de mer', 'risotto aux fruits de mer', 'frutti di mare',
    'vongole', 'scoglio', 'pâtes aux crevettes', 'pates aux crevettes',
    'spaghetti aux crevettes', 'linguine aux fruits de mer'],
  pizza: ['pizza'],
  fromageFort: ['fromage fort', 'fromages forts', 'fromage affiné', 'fromages affinés',
    'roquefort', 'gorgonzola', 'munster', 'bleu d'],
  fromageDoux: ['fromage', 'fromages'],
  raclette: ['raclette', 'fondue'],
  // « notes épicées » décrit le vin, pas le plat : seules les tournures qui
  // désignent un mets comptent.
  epice: ['plats épicés', 'plats epices', 'cuisine épicée', 'cuisine epicee',
    'asiatique', 'curry', 'exotique', 'exotiques', 'sucré-salé', 'sucre-sale'],
  vegetarien: ['végétarien', 'vegetarien', 'légume', 'legume', 'asperge'],
  dessert: ['dessert', 'tarte', 'chocolat', 'foie gras'],
  aperitif: ['apéritif', 'aperitif', 'apéro'],
};

// Un plat générique s'efface devant un plat plus précis cité dans la même
// proposition : « fromages affinés » est un fromage fort, pas un fromage doux.
const PLUS_PRECIS = {
  fromageDoux: ['fromageFort'],
  // « spaghetti aux vongole » cite des pâtes et des fruits de mer, mais c'est
  // le plat composé qu'il faut retenir, pas ses deux moitiés.
  pates: ['patesFruitsDeMer'],
  fruitsDeMer: ['patesFruitsDeMer'],
};

const sansAccent = (v) => String(v ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Une note enchaîne souvent un accord et une réserve sans rapport :
// « bon avec des plats épicés ; trop sec pour l'apéritif ». Chercher la
// négation dans toute la note reviendrait à perdre le premier accord, on
// découpe donc en propositions et on n'examine que celle qui cite le plat.
const SEPARATEURS = /[.;|—]/;
const NEGATION = /\ba eviter\b|\btrop\b|\bpas\b|\bjamais\b|\bsans\b|\bmoins\b/;

function propositionCitant(note, indice) {
  const cible = sansAccent(indice);
  for (const proposition of String(note).split(SEPARATEURS)) {
    if (sansAccent(proposition).includes(cible)) return proposition.trim();
  }
  return '';
}

/** Plats explicitement cités dans la note d'un vin, avec l'extrait qui le dit. */
export function accordsDeLaNote(vin) {
  if (!vin.note) return [];
  const note = sansAccent(vin.note);
  const trouves = [];
  for (const [plat, indices] of Object.entries(INDICES_NOTE)) {
    const indice = indices.find((mot) => note.includes(sansAccent(mot)));
    if (!indice) continue;
    const proposition = propositionCitant(vin.note, indice);
    // Une note qui déconseille explicitement ne vaut pas recommandation.
    if (!proposition || NEGATION.test(sansAccent(proposition))) continue;
    const precis = (PLUS_PRECIS[plat] || []).some((autre) => INDICES_NOTE[autre]
      .some((mot) => sansAccent(proposition).includes(sansAccent(mot))));
    if (precis) continue;
    trouves.push({ plat, extrait: raccourcir(proposition) });
  }
  return trouves;
}

const raccourcir = (texte) => (
  texte.length > 160 ? `${texte.slice(0, 157)}…` : texte
);

// --- résolution du profil ---------------------------------------------------

function chercher(table, texte) {
  const cible = sansAccent(texte);
  if (!cible) return null;
  for (const [cle, valeur] of Object.entries(table)) {
    if (cible.includes(sansAccent(cle))) return { cle, ...valeur };
  }
  return null;
}

/** Profil d'un vin : description, température et affinités par plat. */
export function profilDuVin(vin) {
  const parCepage = chercher(PAR_CEPAGE, vin.cepage);
  if (parCepage) return { ...parCepage, origine: 'cépage' };

  const appellation = `${vin.region} ${vin.nom}`;
  const parAppellation = chercher(PAR_APPELLATION, appellation);
  if (parAppellation) return { ...parAppellation, origine: 'appellation' };

  // Le nom du vin cite parfois le cépage sans que la colonne soit remplie.
  const parNom = chercher(PAR_CEPAGE, appellation);
  if (parNom) return { ...parNom, origine: 'cépage' };

  return { ...PAR_COULEUR[vin.couleur] || PAR_COULEUR.inconnu, cle: vin.couleur, origine: 'couleur' };
}

/**
 * Note d'affinité d'un vin pour un plat, de 0 à 4. Un accord confirmé par la
 * note personnelle passe devant tout le reste.
 */
export function affinite(vin, plat) {
  const personnel = accordsDeLaNote(vin).find((a) => a.plat === plat);
  const base = profilDuVin(vin).plats[plat] || 0;
  if (personnel) return { score: 4, raison: personnel.extrait, personnel: true };
  if (base === 0) return { score: 0, raison: '', personnel: false };
  return { score: base, raison: profilDuVin(vin).description, personnel: false };
}

/** Bouteilles en cave qui conviennent à un plat, les meilleures d'abord. */
export function vinsPourPlat(vins, plat) {
  return vins
    .filter((v) => v.statut === 'en-cave' && v.quantite > 0)
    .map((vin) => ({ vin, ...affinite(vin, plat), profil: profilDuVin(vin) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score
      || (b.vin.notation ?? 0) - (a.vin.notation ?? 0)
      || b.vin.quantite - a.vin.quantite);
}

/** Plats qui conviennent à un vin, les meilleurs d'abord. */
export function platsPourVin(vin) {
  const personnels = new Map(accordsDeLaNote(vin).map((a) => [a.plat, a.extrait]));
  const profil_ = profilDuVin(vin);
  const cles = new Set([...Object.keys(profil_.plats), ...personnels.keys()]);
  return [...cles]
    .map((plat) => ({
      plat,
      libelle: LIBELLE_PLAT.get(plat) || plat,
      score: personnels.has(plat) ? 4 : (profil_.plats[plat] || 0),
      extrait: personnels.get(plat) || '',
    }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.libelle.localeCompare(b.libelle, 'fr'));
}
