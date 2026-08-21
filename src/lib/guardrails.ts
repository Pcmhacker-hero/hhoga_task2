// Guardrails — Input & Output safety, PII detection, Relevance, and Grounding/Faithfulness validation
// Supports deterministic regex/keyword checks and optional LLM-assisted verification

export interface GuardrailResult {
  name: string
  passed: boolean
  details: string
  durationMs: number
  severity?: 'low' | 'medium' | 'high'
}

export type FaithfulnessLevel = 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED'

export interface FaithfulnessResult extends GuardrailResult {
  level: FaithfulnessLevel
  claims?: { claim: string; supported: boolean; reason?: string; supportingSentence?: string }[]
}

export type RelevanceLevel = 'RELEVANT' | 'AMBIGUOUS' | 'IRRELEVANT'

export interface RetrievalRelevance {
  level: RelevanceLevel
  semanticScore: number
  bm25Score: number
  threshold: number
}

export interface GuardrailsReport {
  inputChecks: GuardrailResult[]
  outputChecks: GuardrailResult[]
  allPassed: boolean
  totalMs: number
}

// ---- 1. PII Detection Patterns ----
// Includes Indian context identifiers (Aadhaar, PAN, Indian mobile numbers)
export const PII_PATTERNS = [
  {
    name: 'Aadhaar Number',
    pattern: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g,
    description: '12-digit Indian Aadhaar number',
  },
  {
    name: 'PAN Card',
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
    description: '10-character Indian Permanent Account Number',
  },
  {
    name: 'Phone Number',
    pattern: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
    description: 'Indian mobile number (+91 or 10 digits starting with 6-9)',
  },
  {
    name: 'Email Address',
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    description: 'Standard email address',
  },
  {
    name: 'Credit / Debit Card',
    pattern: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g,
    description: '16-digit payment card number',
  },
]

export function checkPII(text: string): { result: GuardrailResult; cleanText: string } {
  const start = performance.now()
  const found: string[] = []
  let cleanText = text

  for (const { name, pattern } of PII_PATTERNS) {
    const matches = text.match(pattern)
    if (matches && matches.length > 0) {
      found.push(`${name} (${matches.length})`)
      cleanText = cleanText.replace(pattern, '[REDACTED]')
    }
  }

  const durationMs = Math.round(performance.now() - start)
  return {
    result: {
      name: 'PII Detection',
      passed: found.length === 0,
      details: found.length > 0 ? `Redacted: ${found.join(', ')}` : 'Clean (No PII detected)',
      durationMs,
      severity: found.length > 0 ? 'medium' : 'low',
    },
    cleanText,
  }
}

export function redactPII(text: string): string {
  return checkPII(text).cleanText
}

// ---- 2. Toxicity / Safety Guardrail ----
// Deterministic fast keyword filter (English & Hindi)
const TOXICITY_KEYWORDS = [
  // English dangerous/harmful keywords
  'kill', 'murder', 'bomb', 'terrorist', 'weapon', 'suicide', 'assassinate', 'explosive',
  'hack password', 'ddos', 'exploit vulnerability', 'poison',
  // Hindi equivalents
  'मारना', 'हत्या', 'बम', 'आतंकवादी', 'हथियार', 'आत्महत्या', 'विस्फोटक', 'जहर',
]

// Educational context allowlist keywords to reduce false positives
const CONTEXTUAL_ALLOWLIST = [
  'history', 'historical', 'museum', 'monument', 'war of', 'treaty', 'defence',
  'इतिहास', 'ऐतिहासिक', 'संग्रहालय', 'स्मारक', 'युद्ध',
]

export function checkToxicity(text: string): GuardrailResult {
  const start = performance.now()
  const lower = text.toLowerCase()

  // Allow if educational/historical context is present with non-violent intent
  const hasAllowlistContext = CONTEXTUAL_ALLOWLIST.some(w => lower.includes(w))
  const matchedKeywords = TOXICITY_KEYWORDS.filter(kw => {
    // Word boundary match where possible
    const regex = new RegExp(`(^|\\s|[.,!?])${kw.toLowerCase()}($|\\s|[.,!?])`, 'i')
    return regex.test(lower) || lower.includes(kw.toLowerCase())
  })

  // If educational words are present and only mild historical terms triggered, soften check
  const isViolative = matchedKeywords.length > 0 && !(hasAllowlistContext && matchedKeywords.length === 1 && (matchedKeywords[0] === 'weapon' || matchedKeywords[0] === 'हथियार'))

  const durationMs = Math.round(performance.now() - start)
  return {
    name: 'Toxicity Filter',
    passed: !isViolative,
    details: isViolative
      ? `Safety flag: [${matchedKeywords.join(', ')}]`
      : 'Safe (No toxicity flagged)',
    durationMs,
    severity: isViolative ? 'high' : 'low',
  }
}

// ---- 3. Query Relevance Guardrail ----
export function checkRelevance(query: string): GuardrailResult {
  const start = performance.now()
  const trimmed = query.trim()

  if (trimmed.length < 3) {
    return {
      name: 'Relevance Check',
      passed: false,
      details: 'Query is too short (< 3 characters)',
      durationMs: Math.round(performance.now() - start),
      severity: 'medium',
    }
  }

  // Count alphanumeric and Devanagari characters
  const validChars = trimmed.match(/[\w\u0900-\u097F]/g)
  if (!validChars || validChars.length < 2) {
    return {
      name: 'Relevance Check',
      passed: false,
      details: 'Query appears to be noise or non-verbal characters',
      durationMs: Math.round(performance.now() - start),
      severity: 'medium',
    }
  }

  const durationMs = Math.round(performance.now() - start)

  return {
    name: 'Relevance Check',
    passed: true,
    details: 'Query shape is valid; knowledge-base relevance will be checked after retrieval',
    durationMs,
    severity: 'low',
  }
}

/**
 * Classifies relevance from the actual retrieved evidence, never from a mere
 * non-negative BM25 score.  The lower ambiguity band prevents a weak semantic
 * nearest-neighbour from being treated as evidence for a factual answer.
 */
export function assessRetrievalRelevance(
  semanticScore: number,
  bm25Score: number,
  threshold = 0.35,
): RetrievalRelevance {
  const lexicalSignal = bm25Score > 0
  const strongSemantic = semanticScore >= threshold
  const semanticAndLexical = semanticScore >= threshold - 0.08 && lexicalSignal
  const strongLexical = bm25Score >= 1.0

  if (strongSemantic || semanticAndLexical || strongLexical) {
    return { level: 'RELEVANT', semanticScore, bm25Score, threshold }
  }

  if (semanticScore >= threshold - 0.15 || lexicalSignal) {
    return { level: 'AMBIGUOUS', semanticScore, bm25Score, threshold }
  }

  return { level: 'IRRELEVANT', semanticScore, bm25Score, threshold }
}

export function relevanceResultFromRetrieval(assessment: RetrievalRelevance): GuardrailResult {
  const start = performance.now()
  const label = assessment.level.toLowerCase()
  return {
    name: 'Knowledge-base Relevance',
    passed: assessment.level === 'RELEVANT',
    details: `${label} (semantic ${assessment.semanticScore.toFixed(3)}, BM25 ${assessment.bm25Score.toFixed(3)}, threshold ${assessment.threshold.toFixed(3)})`,
    durationMs: Math.round(performance.now() - start),
    severity: assessment.level === 'IRRELEVANT' ? 'medium' : assessment.level === 'AMBIGUOUS' ? 'medium' : 'low',
  }
}

// ---- 4. Claim-level grounding guardrail ----
// A deterministic verifier is deliberately used here to avoid an extra LLM call
// on every voice turn. It verifies each factual sentence independently, rejects
// numeric contradictions, and checks its key entities against retrieved context.
const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this', 'that', 'these',
  'those', 'as', 'from', 'has', 'have', 'had', 'according', 'source', 'answer',
  'information', 'about', 'which', 'what', 'who', 'when', 'where', 'also', 'its',
  'called', 'process', 'using', 'into', 'can', 'such', 'other', 'some',
])
const HINDI_STOP_WORDS = new Set([
  'है', 'हैं', 'था', 'थी', 'थे', 'के', 'का', 'की', 'को', 'में', 'से', 'पर', 'और', 'या',
  'यह', 'वह', 'इस', 'उस', 'एक', 'लिए', 'द्वारा', 'स्रोत', 'अनुसार', 'जानकारी', 'हैं।',
  'होता', 'होती', 'होते', 'कहा', 'जाता', 'जाती', 'जाते', 'रूप',
])

function isSafeNoAnswer(text: string): boolean {
  return /i (do not|don't) have enough information|cannot answer (that )?reliably|knowledge base.*(does not|doesn't) contain/i.test(text)
    || /पर्याप्त जानकारी नहीं है|विश्वसनीय रूप से उत्तर नहीं दे सकता|ज्ञान.*आधार.*जानकारी नहीं/i.test(text)
}

function splitClaims(text: string): string[] {
  return text
    .replace(/[*#_`~>]/g, '')
    .replace(/\[?source\s*\d+\]?/gi, '')
    .replace(/according to/gi, '')
    .split(/(?<=[.!?।॥])\s+|\n+/)
    .map(part => part.trim())
    .filter(part => part.length > 2)
}

function contentTokens(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(token => {
      if (!token) return false
      if (ENGLISH_STOP_WORDS.has(token) || HINDI_STOP_WORDS.has(token)) return false
      return /[\u0900-\u097F]/.test(token) ? token.length >= 2 : token.length >= 3
    })
}

function numbers(text: string): string[] {
  return text.replace(/source\s*\d+/gi, '').match(/\b\d+(?:[,.]\d+)?\b/g) ?? []
}

function hasNegation(text: string): boolean {
  return /\b(?:not|never|no|none|without)\b|नहीं|नही/.test(text.toLocaleLowerCase())
}

function normalizeForContainment(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function checkClaimGrounding(response: string, context: string): FaithfulnessResult {
  const start = performance.now()

  if (isSafeNoAnswer(response)) {
    return {
      name: 'Faithfulness',
      passed: true,
      level: 'SUPPORTED',
      details: 'Safe no-answer response contains no factual claim',
      durationMs: Math.round(performance.now() - start),
    }
  }

  if (!context || !context.trim() || !response || !response.trim()) {
    return {
      name: 'Faithfulness',
      passed: false,
      level: 'UNSUPPORTED',
      details: 'Factual response has no retrieved context',
      durationMs: Math.round(performance.now() - start),
      severity: 'high',
    }
  }

  const contextSentences = splitClaims(context)
  const fullNormalizedContext = normalizeForContainment(context)
  const allContextNumbers = new Set(numbers(context))
  const claims = splitClaims(response)

  const verifiedClaims = claims.map(claim => {
    const claimTokens = contentTokens(claim)
    const claimNumbers = numbers(claim)
    const normalizedClaim = normalizeForContainment(claim)

    // Check numeric consistency across all context
    const hasUnmatchedNumber = claimNumbers.some(number => !allContextNumbers.has(number))

    // 1. Check against full context text
    const fullMatchingTokens = claimTokens.filter(token => fullNormalizedContext.includes(token))
    const fullCoverage = claimTokens.length === 0 ? 1 : fullMatchingTokens.length / claimTokens.length
    const directFullContainment = fullNormalizedContext.includes(normalizedClaim)
      || normalizedClaim.includes(fullNormalizedContext)

    let bestScore = directFullContainment ? 1 : fullCoverage
    let bestSentence = ''
    let bestReason = bestScore >= 0.50
      ? `Supported by key-term coverage ${(fullCoverage * 100).toFixed(0)}% across retrieved context`
      : 'Insufficient key-term coverage in retrieved context'

    // 2. Check per candidate sentence for precision
    for (const candidate of contextSentences) {
      const normalizedCandidate = normalizeForContainment(candidate)
      const candidateNumbers = new Set(numbers(candidate))
      const numericMismatch = claimNumbers.some(number => !candidateNumbers.has(number))
      if (numericMismatch && candidateNumbers.size > 0) continue

      const matchingTokens = claimTokens.filter(token => normalizedCandidate.includes(token))
      const coverage = claimTokens.length === 0 ? 1 : matchingTokens.length / claimTokens.length
      const directContainment = normalizedCandidate.includes(normalizedClaim)
        || normalizedClaim.includes(normalizedCandidate)
      const negationMismatch = hasNegation(claim) !== hasNegation(candidate)
      const score = directContainment ? 1 : coverage

      if (!negationMismatch && score > bestScore) {
        bestScore = score
        bestSentence = candidate
        const minimumCoverage = claimTokens.length <= 2 ? 1 : 0.55
        const supported = directContainment || coverage >= minimumCoverage
        if (supported) {
          bestReason = `Supported by key-term coverage ${(coverage * 100).toFixed(0)}% in candidate sentence`
        }
      }
    }

    const supported = (bestScore >= 0.50 || directFullContainment) && !hasUnmatchedNumber
    return {
      claim,
      supported,
      reason: hasUnmatchedNumber
        ? `Unsupported numeric value: ${claimNumbers.filter(number => !allContextNumbers.has(number)).join(', ')}`
        : bestReason,
      supportingSentence: bestSentence || undefined,
    }
  })

  const supportedCount = verifiedClaims.filter(claim => claim.supported).length
  const level: FaithfulnessLevel = supportedCount === verifiedClaims.length
    ? 'SUPPORTED'
    : supportedCount > 0
      ? 'PARTIALLY_SUPPORTED'
      : 'UNSUPPORTED'
  const passed = level === 'SUPPORTED'
  const details = `${supportedCount}/${verifiedClaims.length} factual claim${verifiedClaims.length === 1 ? '' : 's'} supported by retrieved context`

  const durationMs = Math.round(performance.now() - start)
  return {
    name: 'Faithfulness',
    passed,
    level,
    details,
    durationMs,
    severity: passed ? 'low' : level === 'PARTIALLY_SUPPORTED' ? 'medium' : 'high',
    claims: verifiedClaims,
  }
}

// Backwards-compatible export retained for callers/tests from the first pass.
export const checkFaithfulnessHeuristic = checkClaimGrounding

// ---- 5. Length Guardrail (Voice-friendly) ----
export function checkLength(response: string, maxChars = 500): GuardrailResult {
  const start = performance.now()
  const passed = response.length <= maxChars

  return {
    name: 'Length Check',
    passed,
    details: passed
      ? `${response.length} chars (within ${maxChars} limit)`
      : `${response.length} chars (truncated for voice TTS)`,
    durationMs: Math.round(performance.now() - start),
    severity: passed ? 'low' : 'medium',
  }
}

// ---- Full Input & Output Guardrail Pipelines ----
export function runInputGuardrails(query: string): {
  results: GuardrailResult[]
  cleanQuery: string
  allPassed: boolean
} {
  const { result: piiResult, cleanText: cleanQuery } = checkPII(query)
  const toxicityResult = checkToxicity(query)
  const relevanceResult = checkRelevance(query)

  const results = [piiResult, toxicityResult, relevanceResult]
  const allPassed = results.every(r => r.passed)

  return { results, cleanQuery, allPassed }
}

export function runOutputGuardrails(response: string, context: string): {
  results: GuardrailResult[]
  allPassed: boolean
} {
  const faithfulnessResult = checkClaimGrounding(response, context)
  const toxicityResult = checkToxicity(response)
  const lengthResult = checkLength(response)

  const results = [faithfulnessResult, toxicityResult, lengthResult]
  const allPassed = results.every(r => r.passed)

  return { results, allPassed }
}
