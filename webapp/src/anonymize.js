import { nerMask } from './ner.js';

/** Keep last 4 digits helper */
function keepLast4Placeholder(placeholder){
  return (m) => {
    const digits = (m.match(/\d/g) || []).join('');
    const keep = digits.slice(-4);
    return `${placeholder}${keep ? '_'+keep : ''}`;
  };
}

/** Month names (EN) for date detectors (long and short forms) */
const MONTHS = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

/** Regex policy: conservative + labeled field detectors for migration docs. */
function regexPass(text){
  // Ensure we always operate on a string to avoid runtime failures when callers
  // accidentally pass null/undefined or when upstream NER returns unexpected values.
  if (text === null || typeof text === 'undefined') text = ''
  else if (typeof text !== 'string') text = String(text)

  // Small helper to safely replace a substring only when the target exists.
  function safeReplace(str, target, replacement) {
    try {
      const s = (str === null || typeof str === 'undefined') ? '' : String(str)
      if (typeof target === 'undefined' || target === null) return s
      return s.replace(target, replacement)
    } catch (err) {
      // If replace fails for any reason, return the original string unchanged
      return (str === null || typeof str === 'undefined') ? '' : String(str)
    }
  }

  const rules = [
    // Shield OMB number
    { re: /\bOMB\s*No\.?\s*\d{4}-\d{4}\b/gi, repl:'<OMB_NO>' },

    // URLs
    { re: /\b[a-z][a-z0-9+.\-]*:\/\/[^\s)]+/gi, repl:'<URL>' },

    // Emails, phones (tighter), SSN, credit cards
    { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, repl:'<EMAIL>' },
    { re: /(?:(?:\+?\d[\s\-()])?(?:\d[\s\-()]){9,14}\d)/g, repl:'<PHONE>' },
    { re: /\b\d{3}-?\d{2}-?\d{4}\b/g, repl:'<US_SSN>' },
    { re: /\b(?:\d[ -]?){13,19}\b/g, repl: keepLast4Placeholder('<CARD>') },

    // Labeled name fields (conservative) — capture after explicit labels
    { re: /\b(Name|Full Name|Applicant Name|Client Name|Beneficiary Name|Person Name)\s*[:\-]\s*([^\n]{2,150})/gi,
      repl:(m, lbl, name)=> safeReplace(m, name, '<NAME>') },
    { re: /\b(Last|Surname|Family)\s*(?:Name)?\s*[:\-]\s*([^\n]{2,80})/gi,
      repl:(m, lbl, name)=> safeReplace(m, name, '<NAME_LAST>') },
    { re: /\b(First|Given)\s*(?:Name)?\s*[:\-]\s*([^\n]{2,80})/gi,
      repl:(m, lbl, name)=> safeReplace(m, name, '<NAME_FIRST>') },
    // Older 'For: NAME' uppercase label handling
    { re: /\bFor:(\s+)([A-Z][A-Z\s.'-]{2,}?)(\s{2,})/g,
      repl:(m, s1, name, s2)=>`For:${s1}<NAME>${s2}` },

    // Last/Surname ... First (Given) Name — never eat the "F"
    { re: /Last\/Surname:(\s+)([A-Z][A-Z\s.'-]*?)(\s{2,})First\b/g,
      repl:(m, s1, last, s2)=>`Last/Surname:${s1}<NAME_LAST>${s2}First` },

    // First (Given) Name
    { re: /First\s*\(Given\)\s*Name:(\s+)([A-Z][A-Z\s.'-]*?)(?=\s{2,}|$)/g,
      repl:(m, s1, first)=>`First (Given) Name:${s1}<NAME_FIRST>` },

    // Dates (labels and common variants). Use multiple date formats and allow short month names.
    { re: new RegExp(`\\b(Date\\s+of\\s+Birth|Birth\\s*Date|DOB|D\\.?O\\.?B\\.)\\s*[:\-]?\\s*(\\d{4}\\s+${MONTHS}\\s+\\d{1,2}|\\d{1,2}[\\/\\-]\\d{1,1}[\\/\\-]\\d{2,4}|${MONTHS}\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'gi'),
      repl:(m, lbl, date)=> safeReplace(m, date, '<DOB>') },
    { re: new RegExp(`\\b(Arrival\\/Issued\\s*Date|Admit\\s*Until\\s*Date|Issued\\s*Date|Issue\\s*Date):\\s*(\\d{4}\\s+${MONTHS}\\s+\\d{1,2}|\\d{1,2}[\\/\\-]\\d{1,1}[\\/\\-]\\d{2,4}|${MONTHS}\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'gi'),
      repl:(m, lbl, date)=> safeReplace(m, date, '<DATE>') },
    // Generic unlabeled date patterns (conservative replacement of birth-like labels only handled above)
    { re: new RegExp(`\\b(${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'gi'), repl: '<DATE>' },

    // I-94 numbers (alpha-numeric when labeled; must contain at least one digit)
    { re: /\bAdmission\s*I-94\s*Record\s*Number:\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{9,15})\b/gi,
      repl:(m, n)=> safeReplace(m, n, '<I94>') },
    { re: /\bI[\s-]?94(?:\/I[\s-]?95)?\s*(?:No\.?|Number|#|Núm\.?|Nº)?\s*[:#-]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{9,15})\b/gi,
      repl:(m,n)=> safeReplace(m,n,'<I94>') },

    // USCIS Receipt / Case Number
    { re: /\b(?:IOE|EAC|WAC|LIN|SRC|MSC|NBC|YSC)[0-9]{10}\b/gi, repl:'<USCIS_CASE>' },

    // Document Number
    { re: /\bDocument\s*Number:\s*([A-Z0-9]{6,12})\b/gi, repl:(m,n)=>safeReplace(m,n,'<DOC_NO>') },

    // Country of Citizenship (stop before "Effective", punctuation, or double space)
    { re: /\bCountry\s+of\s+Citizenship:\s*([A-Z][A-Za-z \-']{1,50}?)(?=\s{2,}|,?\s+Effective\b|[.;]|$)/gi,
      repl:(m,n)=>safeReplace(m,n,'<COUNTRY>') },

    // Address fields: replace labeled addresses conservatively
    { re: /\b(Address|Residence|Street|Mailing Address|Home Address)\s*[:\-]\s*([^\n]{3,300})/gi, repl:(m, lbl, v)=> safeReplace(m, v, '<ADDRESS>') },
    // City, State ZIP patterns like "City, ST 12345" — mask ZIP and state
    { re: /\b([A-Za-z\s\-]{2,80}),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)\b/g, repl:(m, city, st, zip)=> safeReplace(safeReplace(safeReplace(m, zip, '<ZIP>'), st, '<STATE>'), city, '<CITY>') },
    // Standalone ZIP codes
    { re: /\b\d{5}(?:-\d{4})?\b/g, repl:'<ZIP>' },

    // Passport numbers (labeled) — conservative capture when preceded by the word Passport
    { re: /\bPassport\s*(?:No\.?|Number)?\s*[:\-]?\s*([A-Z0-9\-]{5,20})\b/gi, repl:(m,n)=> safeReplace(m,n,'<PASSPORT>') },

    // IPv4
    { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, repl:'<IP>' },
  ];

  let out = text;
  for (const r of rules){
    try {
      if (typeof r.repl === 'function') {
        out = out.replace(r.re, (...args) => {
          try {
            return r.repl(...args)
          } catch (err) {
            console.warn('anonymize rule repl error', { rule: r.re, args, err })
            // Return the original matched substring to avoid accidental data loss
            return args[0]
          }
        })
      } else {
        out = out.replace(r.re, r.repl)
      }
    } catch (err) {
      console.warn('anonymize rule application failed', { rule: r.re, repl: r.repl, err })
    }
  }
   return out;
 }

export async function anonymizeText(raw, opts={}){
  const stage1 = regexPass(raw);
  let stage2
  try {
    stage2 = await nerMask(stage1, opts)
    if (stage2 === null || typeof stage2 === 'undefined') stage2 = ''
    else if (typeof stage2 !== 'string') stage2 = String(stage2)
  } catch (err) {
    console.error('NER masking failed, falling back to regex-only anonymization', err)
    stage2 = stage1
  }
  const finalPass = regexPass(stage2)
  return finalPass
}
