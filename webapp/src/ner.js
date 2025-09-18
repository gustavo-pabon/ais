// In-browser NER using transformers.js
// import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;   // don't look for /models/...
env.localModelPath = null;      // force remote
env.useBrowserCache = true;     // cache in IndexedDB

let cache = { lang: null, ner: null };

async function getNER(preferSpanish){
  const lang = preferSpanish ? 'es' : 'en';
  if (!cache.ner || cache.lang !== lang){
    cache.lang = lang;
    const model = preferSpanish ? 'PlanTL-GOB-ES/roberta-base-bne-ner' : 'Xenova/bert-base-NER';
    cache.ner = await pipeline('token-classification', model);
  }
  return cache.ner;
}

export async function nerMask(text, { preferSpanish } = {}){
  const ner = await getNER(!!preferSpanish);
  let out = await ner(text, { aggregation_strategy: 'simple' });
  let masked = text;
  /*
  // Filter noisy tags
  out = out.filter(e => {
    if (!e || !e.entity_group) return false;
    if (e.entity_group === 'MISC') return false;
    const len = (e.end - e.start);
    return len >= 3;
  });
  const tags = { PER: '<NAME>', LOC: '<LOC>', ORG: '<ORG>', DATE: '<DATE>' };
  const sorted = out.sort((a,b)=> b.start - a.start);
  let masked = text;
  for (const e of sorted){
    const tag = tags[e.entity_group] || '<ENT>';
    masked = masked.slice(0, e.start) + tag + masked.slice(e.end);
  }
  */
  return masked;
}
