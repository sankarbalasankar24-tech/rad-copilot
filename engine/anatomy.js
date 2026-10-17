// anatomy.js — organ/section synonym index, laterality, severity, phases,
// negation spotting and location lexicon. Pure ES module shared by Node tests
// and the browser extension. Template-provided extra organ words are merged at
// load time (see template-engine.js) so behaviour stays configurable.

export const ORGANS = {
  kidney: {
    id: 'kidney',
    section: 'kidneys',
    synonyms: ['kidney', 'kidneys', 'renal', 'nephro', 'perinephric',
      'calyceal', 'pelvicalyceal', 'caliectasis', 'ureteric', 'ureter'],
  },
  liver: {
    id: 'liver',
    section: 'liver',
    synonyms: ['liver', 'hepatic', 'steatosis', 'fatty liver', 'fatty change',
      'ihbrd', 'inhbrd', 'intrahepatic radicles', 'dilated intrahepatic'],
  },
  spleen: {
    id: 'spleen',
    section: 'spleen',
    synonyms: ['spleen', 'splenic', 'splen(o)'],
  },
  pancreas: {
    id: 'pancreas',
    section: 'pancreas',
    synonyms: ['pancreas', 'pancreatic', 'uncinate process'],
  },
  gallbladder: {
    id: 'gallbladder',
    section: 'gallbladder',
    synonyms: ['gallbladder', 'gall bladder', 'gallstone', 'cholelithiasis', 'cholecyst'],
  },
  biliary: {
    id: 'biliary',
    section: 'biliary',
    synonyms: ['cbd', 'common bile duct', 'common hepatic duct', 'biliary'],
  },
  bowel: {
    id: 'bowel',
    section: 'bowel',
    synonyms: ['bowel', 'appendix', 'appendicitis', 'caecum', 'cecum', 'colon', 'ileum',
      'small bowel', 'large bowel', 'enteric', 'sigmoid', 'rectum', 'caecal'],
  },
  stomach: {
    id: 'stomach',
    section: 'stomach',
    synonyms: ['stomach', 'gastric', 'antrum'],
  },
  adrenal: {
    id: 'adrenal',
    section: 'adrenals',
    synonyms: ['adrenal glands', 'adrenals', 'adrenal'],
  },
  vessel: {
    id: 'vessel',
    section: 'vasculature',
    synonyms: ['aorta', 'celiac', 'coeliac', 'mesenteric', 'iliac arteries', 'portal vein',
      'smv', 'splenic vein', 'ivc', 'inferior vena cava'],
  },
  bladder: {
    id: 'bladder',
    section: 'bladder',
    synonyms: ['urinary bladder', 'bladder', 'vesical', 'mural'],
  },
  prostate: {
    id: 'prostate',
    section: 'prostate',
    synonyms: ['prostate'],
  },
  uterus: {
    id: 'uterus',
    section: 'uterus-adnexa',
    synonyms: ['uterus', 'adnexa', 'ovary', 'ovaries', 'endometrium', 'uterine', 'myometrium'],
  },
  peritoneum: {
    id: 'peritoneum',
    section: 'peritoneum',
    synonyms: ['peritoneum', 'omental', 'omentum', 'free fluid', 'ascites', 'lymph node',
      'mesenteric nodes', 'retroperitoneal nodes'],
  },
  lung: {
    id: 'lung',
    section: 'lung-bases',
    synonyms: ['lung', 'lobar', 'lobes', 'pleural', 'effusion', 'consolidation'],
  },
  bone: {
    id: 'bone',
    section: 'bones',
    synonyms: ['vertebra', 'vertebral', 'ribs', 'sternum', 'pelvic bones', 'sacrum', 'ilium', 'osseous'],
  },
};

export const LATERALITY = {
  right: ['right', 'rt'],
  left: ['left', 'lt'],
  bilateral: ['bilateral', 'both', 'b/l', 'bilaterally'],
};

/** Anatomically plausible descriptor words. Anything outside this list that
 *  ends up as a qualifier is kept but flagged for review (never silently
 *  dropped or reinterpreted). */
export const QUALIFIER_WHITELIST = new Set([
  'thin', 'thick', 'thickened', 'well-defined', 'defined', 'ill-defined',
  'hypodense', 'hyperdense', 'isodense', 'hypoattenuating', 'hyperattenuating',
  'isodense', 'calcified', 'simple', 'complex', 'enhancing', 'enhancement',
  'peripheral', 'central', 'smooth', 'irregular', 'broad-based', 'based',
  'posterior', 'anterior', 'paracentral', 'foraminal', 'extrusion', 'protrusion',
  'soft', 'hard', 'internal', 'external', 'septation', 'septations', 'septae',
  'border', 'borders', 'sclerotic', 'lytic', 'hypointense', 'hyperintense',
  'isointense', 'heterogeneous', 'homogeneous', 'echogenic', 'ill', 'circumferential',
  'multiple', 'solitary', 'focal', 'diffuse', 'acute', 'chronic', 'subacute',
]);

export const SEVERITY_WORDS = {
  mild: ['mild', 'slight', 'minimal', 'subtle', 'early'],
  moderate: ['moderate', 'moderate to severe', 'intermediate'],
  severe: ['severe', 'marked', 'gross', 'markedly'],
  extensive: ['extensive', 'widespread', 'diffuse'],
  moderate_to_severe: ['moderate to severe'],
};

export const PHASE_WORDS = {
  'non-contrast': ['non contrast', 'non-contrast', 'plain', 'precontrast', 'pre contrast', 'ncct', 'unenhanced'],
  arterial: ['arterial', 'arterial phase', 'late arterial'],
  'portal venous': ['portal venous', 'portalvenous', 'venous phase', 'pv phase', 'postcontrast'],
  corticomedullary: ['corticomedullary'],
  nephrographic: ['nephrographic'],
  excretory: ['excretory', 'delayed'],
  't2-weighted': ['t2', 't2 weighted', 't2w'],
  't1-weighted': ['t1', 't1 weighted', 't1w'],
  flair: ['flair'],
  stir: ['stir'],
  'diffusion-weighted': ['dwi', 'diffusion', 'dwi/adc'],
  postcontrast_mri: ['post gadolinium', 'post contrast mri', 'gadolinium'],
};

export const NEGATION_WORDS = ['no', 'without', 'absent', 'negative', 'no evidence of',
  'ruled out', 'excluded', 'denies', 'free of', 'unremarkable', 'normal'];

export const STOPWORDS = ['a', 'an', 'the', 'there', 'is', 'are', 'was', 'were', 'noted',
  'seen', 'with', 'and', 'of', 'in', 'it', 'its', 'at', 'on', 'showing', 'shows', 'not',
  'no', 'any', 'all', 'around', 'along', 'over', 'into', 'to', 'from', 'for', 'within',
  'also', 'this', 'that', 'which', 'their', 'have', 'has'];

export const LOCATIONS = {
  upper_pole: ['upper pole'],
  lower_pole: ['lower pole'],
  mid_pole: ['mid pole'],
  hilum: ['hilum', 'hilar'],
  cortex: ['cortex', 'cortical'],
  medulla: ['medulla'],
  frontal: ['frontal'],
  parietal: ['parietal'],
  temporal: ['temporal'],
  occipital: ['occipital'],
  basal_ganglia: ['basal ganglia'],
  thalamus: ['thalamus'],
  cerebellum: ['cerebellar', 'cerebellum'],
  brainstem: ['brainstem', 'brain stem', 'pons', 'midbrain'],
  periventricular: ['periventricular'],
  centrum_semiovale: ['centrum semiovale'],
  corona_radiata: ['corona radiata'],
  head: ['head of pancreas'],
  body: ['body of pancreas'],
  tail: ['tail of pancreas'],
  uncinate: ['uncinate process'],
  right_iliac_fossa: ['right iliac fossa'],
  mesogastric: ['mesogastric', 'central abdomen'],
  anterior_abdominal_wall: ['anterior abdominal wall'],
  posterior_wall: ['posterior wall'],
  lateral_recess: ['lateral recess'],
  foramina: ['foramina', 'neural foramina'],
  canal: ['canal'],
  facet: ['facet'],
  anterior_epidural: ['anterior epidural'],
  thecal_sac: ['thecal sac'],
  prevertebral: ['prevertebral'],
};

/** Escape user-provided template words for regex use. */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match phrases from a list against text as whole words, return longest first. */
export function matchPhrases(text, phrases) {
  const t = ` ${String(text).toLowerCase().replace(/[^\w\s/-]+/g, ' ').replace(/\s+/g, ' ')} `;
  const hits = [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    const p = String(phrase).toLowerCase().trim();
    if (!p) continue;
    const re = new RegExp(`(?:^|\\s)${escapeRegex(p).replace(/[\s-]+/g, '[\\s-]+')}(?=\\s|$)`, 'i');
    if (re.test(t)) hits.push(p);
  }
  return hits.sort((a, b) => b.length - a.length);
}

/** Find first organ implied by text using the ORGANS synonyms. */
export function resolveOrgan(text) {
  for (const organ of Object.values(ORGANS)) {
    for (const syn of organ.synonyms) {
      if (matchPhrases(text, [syn]).length) return organ.id;
    }
  }
  return null;
}

export function detectLaterality(text) {
  const t = String(text).toLowerCase();
  if (LATERALITY.bilateral.some((w) => matchPhrases(t, [w]).length)) return 'bilateral';
  if (LATERALITY.right.some((w) => matchPhrases(t, [w]).length)) return 'right';
  if (LATERALITY.left.some((w) => matchPhrases(t, [w]).length)) return 'left';
  return null;
}

export function detectSeverity(text) {
  const t = String(text).toLowerCase();
  for (const [key, words] of Object.entries(SEVERITY_WORDS)) {
    for (const w of words) {
      if (matchPhrases(t, [w]).length) return key;
    }
  }
  return null;
}

export function detectPhase(text) {
  const t = String(text).toLowerCase();
  for (const [key, words] of Object.entries(PHASE_WORDS)) {
    for (const w of words) {
      if (matchPhrases(t, [w]).length) return key;
    }
  }
  return null;
}

export function detectNegation(text) {
  const t = String(text).toLowerCase();
  for (const w of NEGATION_WORDS) {
    if (matchPhrases(t, [w]).length) return w;
  }
  return null;
}

/** Extract a recognised location phrase from text based on the LOCATIONS lexicon. */
export function detectLocation(text) {
  const t = String(text).toLowerCase();
  let best = null;
  for (const key of Object.keys(LOCATIONS)) {
    const hits = matchPhrases(t, LOCATIONS[key]);
    if (hits.length && (!best || hits[0].length > best.phrase.length)) {
      best = { key, phrase: hits[0] };
    }
  }
  return best;
}

/** Format laterality into a human site phrase like "the right kidney"/"both kidneys". */
export function sitePhrase(organId, laterality) {
  const ORGAN_NOUNS = {
    kidney: 'kidney',
    liver: 'liver',
    spleen: 'spleen',
    pancreas: 'pancreas',
    gallbladder: 'gallbladder',
    biliary: 'biliary tree',
    bowel: 'bowel',
    stomach: 'stomach',
    adrenal: 'adrenal glands',
    vessel: 'vasculature',
    bladder: 'urinary bladder',
    prostate: 'prostate',
    uterus: 'uterus',
    peritoneum: 'peritoneal cavity',
    lung: 'lungs',
    bone: 'bones',
  };
  const noun = ORGAN_NOUNS[organId] || 'structure';
  const pluralOrgans = ['kidney'];
  if (laterality === 'right') return `the right ${noun}`;
  if (laterality === 'left') return `the left ${noun}`;
  if (laterality === 'bilateral' && pluralOrgans.includes(organId)) return `both ${noun}s`;
  return `the ${noun}`;
}
