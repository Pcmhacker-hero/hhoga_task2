// RAG Quantitative Evaluation Engine
// Evaluates: Retrieval (Recall@K, MRR, NDCG), Generation (Faithfulness, Relevance, Correctness), and System Latencies

export interface GroundTruthQAPair {
  id: string
  query: string
  language: 'hi' | 'en'
  expectedAnswerKeywords: string[]
  expectedAnswer: string
  relevantDocSnippet: string
}

export interface RetrievalMetrics {
  recallAt1: number
  recallAt3: number
  recallAt5: number
  recallAt10: number
  mrr: number
  ndcgAt5: number
  totalQueries: number
}

export interface GenerationMetrics {
  averageFaithfulness: number     // 0.0 - 1.0
  averageRelevance: number        // 0.0 - 1.0
  correctnessRate: number         // 0.0 - 1.0
  citationPrecision: number       // % of responses with valid source citations
  supportedRate: number           // % of responses marked SUPPORTED
}

export interface EvaluationReport {
  timestamp: string
  datasetSize: number
  retrieval: RetrievalMetrics
  generation: GenerationMetrics
  latencySummary: {
    avgRetrievalMs: number
    avgLlmMs: number
    avgGuardrailMs: number
    avgTotalMs: number
  }
  queryResults: {
    query: string
    language: string
    retrievalRank: number | null
    faithfulness: string
    correctness: boolean
    response: string
    latencyMs: number
  }[]
}

/**
 * Standard benchmark evaluation set for multilingual Hindi/English RAG
 */
export const BENCHMARK_QA_SET: GroundTruthQAPair[] = [
  {
    id: 'eval-1',
    query: 'भारत की राजधानी क्या है?',
    language: 'hi',
    expectedAnswerKeywords: ['नई दिल्ली', 'दिल्ली'],
    expectedAnswer: 'नई दिल्ली',
    relevantDocSnippet: 'भारत की राजधानी नई दिल्ली है',
  },
  {
    id: 'eval-2',
    query: 'What is the capital of India?',
    language: 'en',
    expectedAnswerKeywords: ['New Delhi', 'Delhi'],
    expectedAnswer: 'New Delhi',
    relevantDocSnippet: 'New Delhi is the official capital of India',
  },
  {
    id: 'eval-3',
    query: 'ताजमहल कहाँ स्थित है और इसका निर्माण किसने कराया था?',
    language: 'hi',
    expectedAnswerKeywords: ['आगरा', 'शाहजहाँ', 'यमुना'],
    expectedAnswer: 'आगरा, शाहजहाँ',
    relevantDocSnippet: 'ताजमहल भारत के आगरा शहर में यमुना नदी के किनारे स्थित है। इसे शाहजहाँ ने बनवाया था।',
  },
  {
    id: 'eval-4',
    query: 'गोवा भारत का हिस्सा कब बना और इसकी राजधानी क्या है?',
    language: 'hi',
    expectedAnswerKeywords: ['1961', 'पणजी'],
    expectedAnswer: '1961, पणजी',
    relevantDocSnippet: 'गोवा 1961 में भारतीय संघ का हिस्सा बना। गोवा की राजधानी पणजी है।',
  },
  {
    id: 'eval-5',
    query: 'विश्व की सबसे ऊँची पर्वत चोटी कौन सी है?',
    language: 'hi',
    expectedAnswerKeywords: ['माउंट एवरेस्ट', '8,848', '8848', 'एवरेस्ट'],
    expectedAnswer: 'माउंट एवरेस्ट',
    relevantDocSnippet: 'माउंट एवरेस्ट हिमालय की सबसे ऊँची चोटी है',
  },
  {
    id: 'eval-6',
    query: 'When was the first train operated in India?',
    language: 'en',
    expectedAnswerKeywords: ['1853', 'Mumbai', 'Thane', 'Bombay'],
    expectedAnswer: '1853 between Mumbai and Thane',
    relevantDocSnippet: 'The first passenger train ran on 16 April 1853 between Bori Bunder and Thane',
  },
  {
    id: 'eval-7',
    query: 'What are the three doshas in Ayurveda?',
    language: 'en',
    expectedAnswerKeywords: ['Vata', 'Pitta', 'Kapha', 'वात', 'पित्त', 'कफ'],
    expectedAnswer: 'Vata, Pitta, and Kapha',
    relevantDocSnippet: 'वात, पित्त और कफ ये तीन दोष आयुर्वेद के मूल सिद्धांत हैं',
  },
  {
    id: 'eval-8',
    query: 'महात्मा गांधी का जन्म कहाँ हुआ था?',
    language: 'hi',
    expectedAnswerKeywords: ['पोरबंदर', 'गुजरात', '1869'],
    expectedAnswer: 'पोरबंदर, गुजरात',
    relevantDocSnippet: 'उनका जन्म 2 अक्टूबर 1869 को पोरबंदर में हुआ था',
  },
  {
    id: 'eval-9',
    query: 'What is photosynthesis?',
    language: 'en',
    expectedAnswerKeywords: ['photosynthesis', 'sunlight', 'glucose', 'oxygen', 'plants', 'chlorophyll'],
    expectedAnswer: 'Photosynthesis is the process by which green plants convert sunlight and carbon dioxide into glucose and oxygen.',
    relevantDocSnippet: 'Photosynthesis is the biological process by which green plants convert sunlight, carbon dioxide, and water into chemical energy in the form of glucose',
  },
  {
    id: 'eval-10',
    query: 'प्रकाश संश्लेषण क्या है?',
    language: 'hi',
    expectedAnswerKeywords: ['प्रकाश संश्लेषण', 'पौधे', 'सूर्य', 'क्लोरोफिल', 'ऑक्सीजन', 'ग्लूकोज'],
    expectedAnswer: 'प्रकाश संश्लेषण वह प्रक्रिया है जिससे पौधे सूर्य के प्रकाश और क्लोरोफिल की मदद से भोजन बनाते हैं।',
    relevantDocSnippet: 'प्रकाश संश्लेषण वह जैव रासायनिक प्रक्रिया है जिसके द्वारा हरे पौधे सूर्य के प्रकाश, पर्णहरित और कार्बन डाइऑक्साइड का उपयोग करके भोजन बनाते हैं',
  },
]

/**
 * Computes Discounted Cumulative Gain (DCG)
 */
function computeDCG(relevances: number[]): number {
  return relevances.reduce((acc, rel, i) => acc + (Math.pow(2, rel) - 1) / Math.log2(i + 2), 0)
}

/**
 * Evaluates retrieval performance over a set of ranked document candidates
 */
export function evaluateRetrieval(
  searchResultsPerQuery: { queryId: string; retrievedDocs: { text: string }[] }[],
  groundTruths: GroundTruthQAPair[] = BENCHMARK_QA_SET
): RetrievalMetrics {
  let hitsAt1 = 0
  let hitsAt3 = 0
  let hitsAt5 = 0
  let hitsAt10 = 0
  let sumRR = 0
  let sumNDCG5 = 0

  const totalQueries = groundTruths.length

  for (const gt of groundTruths) {
    const searchResult = searchResultsPerQuery.find(s => s.queryId === gt.id)
    const retrieved = searchResult?.retrievedDocs ?? []

    let rankOfFirstMatch: number | null = null
    const relevances: number[] = []

    for (let i = 0; i < retrieved.length; i++) {
      const docText = retrieved[i]!.text.toLowerCase()
      const isRelevant = gt.expectedAnswerKeywords.some(kw => docText.includes(kw.toLowerCase()))

      relevances.push(isRelevant ? 1 : 0)

      if (isRelevant && rankOfFirstMatch === null) {
        rankOfFirstMatch = i + 1
      }
    }

    if (rankOfFirstMatch !== null) {
      if (rankOfFirstMatch <= 1) hitsAt1++
      if (rankOfFirstMatch <= 3) hitsAt3++
      if (rankOfFirstMatch <= 5) hitsAt5++
      if (rankOfFirstMatch <= 10) hitsAt10++
      sumRR += 1 / rankOfFirstMatch
    }

    // Compute NDCG@5
    const idealRelevances = [...relevances].sort((a, b) => b - a).slice(0, 5)
    const dcg5 = computeDCG(relevances.slice(0, 5))
    const idcg5 = computeDCG(idealRelevances)
    sumNDCG5 += idcg5 > 0 ? dcg5 / idcg5 : 0
  }

  return {
    recallAt1: Math.round((hitsAt1 / totalQueries) * 100) / 100,
    recallAt3: Math.round((hitsAt3 / totalQueries) * 100) / 100,
    recallAt5: Math.round((hitsAt5 / totalQueries) * 100) / 100,
    recallAt10: Math.round((hitsAt10 / totalQueries) * 100) / 100,
    mrr: Math.round((sumRR / totalQueries) * 1000) / 1000,
    ndcgAt5: Math.round((sumNDCG5 / totalQueries) * 1000) / 1000,
    totalQueries,
  }
}
