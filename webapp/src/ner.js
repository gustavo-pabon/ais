// In-browser NER using transformers.js
// import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;   // don't look for /models/...
env.localModelPath = '';        // force remote (must be string, not null, to avoid e.replace error)
env.useBrowserCache = true;     // cache in IndexedDB

// Try to use transformers in-browser via CDN when available, otherwise fall back to a conservative heuristic NER

let cache = { lang: null, nerFunc: null, source: null };

async function loadTransformers(preferSpanish){
  // Only attempt loading the Xenova transformers pipeline when explicitly enabled.
  // This prevents spurious stack traces and long network/model loads in CI or restricted environments.
  const enabled = import.meta.env.VITE_ENABLE_XENOVA === 'true'
  if (!enabled) {
    // Mark as failed for this language so we don't repeatedly attempt
    cache = { lang: preferSpanish ? 'es' : 'en', nerFunc: null, source: 'disabled' }
    return null
  }
  const lang = preferSpanish ? 'es' : 'en'
  // If we've previously attempted and failed, don't retry repeatedly
  if (cache.source === 'failed' && cache.lang === lang) return null
  if (cache.nerFunc && cache.lang === lang && cache.source === 'xenova') return cache.nerFunc

  try {
    // Dynamic CDN import avoids bundling with Rollup and works in the browser runtime
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2')
    const { pipeline, env } = mod
    if (env) {
      env.allowLocalModels = false
      env.localModelPath = null
      env.useBrowserCache = true
    }
    const model = preferSpanish ? 'PlanTL-GOB-ES/roberta-base-bne-ner' : 'Xenova/bert-base-NER'

    // Enforce a timeout for model loading so the UI doesn't hang and we can fallback
    const pipelinePromise = pipeline('token-classification', model)
    const timeoutMs = 15000
    const ner = await Promise.race([
      pipelinePromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('transformers pipeline timed out')), timeoutMs))
    ])

    cache = { lang, nerFunc: ner, source: 'xenova' }
    return ner
  } catch (err) {
    // Log a concise message only (avoid printing enormous library stacks in the console)
    try { console.warn('Transformers.js pipeline failed to load; using heuristic NER fallback —', err && err.message ? err.message : String(err)) } catch(e){}
    cache = { lang, nerFunc: null, source: 'failed' }
    return null
  }
}

// Conservative heuristic NER: detect labeled fields and a few common unlabeled patterns.
function heuristicNER(text){
  const entities = []
  if (!text) return entities
  // Helper to push entity
  const push = (group, start, end, score=0.85) => entities.push({ entity_group: group, start, end, score })

  // Labeled names: Name:, Full Name:, Applicant Name:, Client Name:, Beneficiary Name:, Person Name
  const nameLabelRe = /\b(?:Name|Full Name|Applicant Name|Client Name|Beneficiary Name|Person Name)\s*[:\-]\s*([^\n]{2,150})/gi
  for (const m of text.matchAll(nameLabelRe)){
    const full = m[1]
    const idx = m.index + m[0].indexOf(full)
    push('PER', idx, idx + full.length, 0.99)
  }

  // Labeled Given/First/Last names
  const firstLabelRe = /\b(?:First|Given)\s*(?:Name)?\s*[:\-]\s*([^\n]{2,80})/gi
  for (const m of text.matchAll(firstLabelRe)){
    const v = m[1]; const idx = m.index + m[0].indexOf(v); push('PER', idx, idx+v.length, 0.95)
  }
  const lastLabelRe = /\b(?:Last|Surname|Family)\s*(?:Name)?\s*[:\-]\s*([^\n]{2,80})/gi
  for (const m of text.matchAll(lastLabelRe)){
    const v = m[1]; const idx = m.index + m[0].indexOf(v); push('PER', idx, idx+v.length, 0.95)
  }

  // Uppercase name lines: e.g., FOR: JOHN DOE  (common in forms)
  const uppercaseNameRe = /\bFor:\s*([A-Z][A-Z\s.'-]{2,200})/g
  for (const m of text.matchAll(uppercaseNameRe)){
    const v = m[1].trim(); const idx = m.index + m[0].indexOf(v); if (v.length >= 3) push('PER', idx, idx+v.length, 0.95)
  }

  // Title-case two-word names (conservative: only when line contains 'Name' label or prefixed by Mr/Ms/Dr)
  const titleNameContextRe = /(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Name|Full Name)\s*(?:[:\-])?\s*([A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g
  for (const m of text.matchAll(titleNameContextRe)){
    const v = m[1]; const idx = m.index + m[0].indexOf(v); push('PER', idx, idx+v.length, 0.9)
  }

  // Dates: common formats
  const dateRe = /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[A-Za-z]*\s+\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})\b/gi
  for (const m of text.matchAll(dateRe)) { const idx = m.index; push('DATE', idx, idx + m[0].length, 0.98) }

  // Passport-like numbers (labeled)
  const passportRe = /\bPassport\s*(?:No\.?|Number)?\s*[:\-]?\s*([A-Z0-9\-]{5,20})\b/gi
  for (const m of text.matchAll(passportRe)){ const v = m[1]; const idx = m.index + m[0].indexOf(v); push('ID', idx, idx+v.length, 0.9) }

  // I-94 / Receipt numbers already handled by regex pass; but detect alphanumeric sequences that look like case numbers
  const caseRe = /\b(?:IOE|EAC|WAC|LIN|SRC|MSC|NBC|YSC)\d{10}\b/gi
  for (const m of text.matchAll(caseRe)){ push('CASE', m.index, m.index + m[0].length, 0.98) }

  // Addresses: look for number + street name + type
  const addrRe = /\b\d{1,5}\s+[A-Za-z0-9\.\s]{2,100}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct)\b/gi
  for (const m of text.matchAll(addrRe)){ push('LOC', m.index, m.index + m[0].length, 0.9) }

  // City, State ZIP
  const cityStateZipRe = /\b([A-Za-z\s\-]{2,80}),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)\b/g
  for (const m of text.matchAll(cityStateZipRe)){
    const city = m[1].trim(); const st = m[2]; const zip = m[3];
    const cityStart = m.index + m[0].indexOf(city);
    const stStart = m.index + m[0].indexOf(st);
    const zipStart = m.index + m[0].indexOf(zip);
    push('LOC', cityStart, cityStart + city.length, 0.9)
    push('LOC', stStart, stStart + st.length, 0.9)
    push('DATE', zipStart, zipStart + zip.length, 0.9) // treat ZIP as date-like token for masking purposes
  }

  // Phone numbers (loose)
  const phoneRe = /(?:(?:\+?\d[\s\-()])?(?:\d[\s\-()]){7,}\d)/g
  for (const m of text.matchAll(phoneRe)){ push('PHONE', m.index, m.index + m[0].length, 0.95) }

  // Basic emails
  const emailRe = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  for (const m of text.matchAll(emailRe)){ push('EMAIL', m.index, m.index + m[0].length, 0.99) }

  // Normalize overlapping entities by sorting (descending start) - callers expect entities sorted this way
  entities.sort((a,b)=> b.start - a.start)
  return entities
}

async function getNER(preferSpanish){
  // Try to load a real transformer-based NER pipeline; if not available return null so the caller can fallback
  const tried = await loadTransformers(preferSpanish)
  if (tried) return tried
  // Return a function that mimics the pipeline signature and returns heuristic entities
  return async function fakeNER(text, opts={}){
    // The real transformers pipeline returns an array of entity objects when called with text
    const ents = heuristicNER(text)
    // For compatibility with the aggregation_strategy used elsewhere, we return the raw entities
    return ents
  }
}

export async function nerMask(text, { preferSpanish } = {}){
  const ner = await getNER(!!preferSpanish)
  let out = []
  try {
    const res = await ner(text, { aggregation_strategy: 'simple' })
    // If the transformers pipeline returns strings or other shapes, normalize to array
    if (Array.isArray(res)) out = res
    else if (res && typeof res === 'object') out = Array.isArray(res) ? res : []
  } catch (err) {
    console.error('NER pipeline failed; using heuristic fallback', err)
    out = heuristicNER(text)
  }

  // Filter noisy tags: keep entries with a group and length >= 3 chars
  out = (out || []).filter(e => {
    if (!e || !e.entity_group) return false;
    const len = Math.max(0, (e.end || 0) - (e.start || 0));
    if (len < 3) return false
    return true
  })

  // Map common groups to masks
  const tags = { PER: '<NAME>', LOC: '<LOC>', ORG: '<ORG>', DATE: '<DATE>', ID: '<ID>', CASE: '<USCIS_CASE>', PHONE: '<PHONE>', EMAIL: '<EMAIL>' };

  // If transformer returns labels like 'PER' or 'MISC' or 'ORG' etc., use them; otherwise try to interpret entity labels
  const normalized = out.map((e)=>{
    // e.entity_group may be present or the pipeline might use 'entity' or 'label'
    const group = e.entity_group || e.entity || e.label || ''
    return { ...e, entity_group: String(group).toUpperCase() }
  })

  const sorted = normalized.sort((a,b)=> b.start - a.start)
  let masked = text
  for (const e of sorted){
    const tag = tags[e.entity_group] || '<ENT>'
    const s = Math.max(0, e.start || 0)
    const en = Math.min(masked.length, e.end || (s + 1))
    masked = masked.slice(0, s) + tag + masked.slice(en)
  }
  return masked
}
