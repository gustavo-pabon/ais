import { nerMask } from './ner.js';

/** Keep last 4 digits helper */
function keepLast4Placeholder(placeholder){
  return (m) => {
    const digits = (m.match(/\d/g) || []).join('');
    const keep = digits.slice(-4);
    return `${placeholder}${keep ? '_'+keep : ''}`;
  };
}

/** Month names (EN) for date detectors */
const MONTHS = "(January|February|March|April|May|June|July|August|September|October|November|December)";

/** Regex policy: conservative + labeled field detectors for migration docs. */
function regexPass(text){
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

    // For: NAME (uppercase names). Preserve spacing after the label.
    { re: /\bFor:(\s+)([A-Z][A-Z\s.'-]{2,}?)(\s{2,})/g,
      repl:(m, s1, name, s2)=>`For:${s1}<NAME>${s2}` },

    // Last/Surname ... First (Given) Name — never eat the "F"
    { re: /Last\/Surname:(\s+)([A-Z][A-Z\s.'-]*?)(\s{2,})First\b/g,
      repl:(m, s1, last, s2)=>`Last/Surname:${s1}<NAME_LAST>${s2}First` },

    // First (Given) Name
    { re: /First\s*\(Given\)\s*Name:(\s+)([A-Z][A-Z\s.'-]*?)(?=\s{2,}|$)/g,
      repl:(m, s1, first)=>`First (Given) Name:${s1}<NAME_FIRST>` },

    // Dates
    { re: new RegExp(`\\bBirth\\s*Date:\\s*(\\d{4}\\s+${MONTHS}\\s+\\d{1,2}|\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4})\\b`, 'gi'),
      repl:(m, date)=>m.replace(date, '<DOB>') },
    { re: new RegExp(`\\b(Arrival\\/Issued\\s*Date|Admit\\s*Until\\s*Date):\\s*(\\d{4}\\s+${MONTHS}\\s+\\d{1,2}|\\d{1,2}[\\/\\-]\\d{1,2}[\\/\\-]\\d{2,4})\\b`, 'gi'),
      repl:(m, lbl, date)=>m.replace(date, '<DATE>') },

    // I-94 numbers (alpha-numeric when labeled; must contain at least one digit)
    { re: /\bAdmission\s*I-94\s*Record\s*Number:\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{9,15})\b/gi,
      repl:(m, n)=>m.replace(n, '<I94>') },
    { re: /\bI[\s-]?94(?:\/I[\s-]?95)?\s*(?:No\.?|Number|#|Núm\.?|Nº)?\s*[:#-]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{9,15})\b/gi,
      repl:(m,n)=>m.replace(n,'<I94>') },

    // USCIS Receipt / Case Number
    { re: /\b(?:IOE|EAC|WAC|LIN|SRC|MSC|NBC|YSC)[0-9]{10}\b/gi, repl:'<USCIS_CASE>' },

    // Document Number
    { re: /\bDocument\s*Number:\s*([A-Z0-9]{6,12})\b/gi, repl:(m,n)=>m.replace(n,'<DOC_NO>') },

    // Country of Citizenship (stop before "Effective", punctuation, or double space)
    { re: /\bCountry\s+of\s+Citizenship:\s*([A-Z][A-Za-z \-']{1,50}?)(?=\s{2,}|,?\s+Effective\b|[.;]|$)/gi,
      repl:(m,n)=>m.replace(n,'<COUNTRY>') },

    // IPv4
    { re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, repl:'<IP>' },
  ];

  let out = text;
  for (const r of rules){ out = out.replace(r.re, r.repl); }
  return out;
}

export async function anonymizeText(raw, opts={}){
  const stage1 = regexPass(raw);
  const stage2 = await nerMask(stage1, opts);
  const finalPass = regexPass(stage2);
  return finalPass;
}
