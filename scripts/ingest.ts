#!/usr/bin/env npx tsx
// Data Ingestion Pipeline — MSMARCO-XI multilingual dataset chunking, embedding & vector store creation
//
// Usage:
//   npx tsx scripts/ingest.ts [--strategy sentence_boundary|fixed_overlap|paragraph|keyword_group|sliding_window|all] [--limit N] [--dry-run]
//
// Outputs: data/embeddings.json

import { config } from 'dotenv'
config()

import { GoogleGenerativeAI } from '@google/generative-ai'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

import {
  chunkWithStrategy,
  detectLanguage,
  type Chunk,
  type ChunkStrategy,
} from '../src/lib/chunking'

// ---- Parse CLI Arguments ----
const args = process.argv.slice(2)
const limitArgIdx = args.indexOf('--limit')
const LIMIT = limitArgIdx !== -1 && args[limitArgIdx + 1] ? parseInt(args[limitArgIdx + 1]!, 10) : 50

const stratArgIdx = args.indexOf('--strategy')
const STRATEGY_ARG = stratArgIdx !== -1 && args[stratArgIdx + 1] ? (args[stratArgIdx + 1]! as ChunkStrategy | 'all') : 'sentence_boundary'

const DRY_RUN = args.includes('--dry-run')
const GEMINI_API_KEY = process.env.GEMINI_API_KEY

const HF_API_URL = 'https://datasets-server.huggingface.co/rows?dataset=ai4bharat%2FMSMARCO-XI&config=hi&split=train'

if (!GEMINI_API_KEY && !DRY_RUN) {
  console.error('❌ GEMINI_API_KEY is required in .env for generating embeddings')
  process.exit(1)
}

// Built-in sample dataset for Hindi and English QA pairs
function getSampleData() {
  return [
    // 1. Biology & Plant Science
    {
      query: 'What is photosynthesis?',
      passages: [
        'Photosynthesis is the biological process by which green plants, algae, and certain bacteria convert sunlight, carbon dioxide, and water into chemical energy in the form of glucose or sugars. During this process, chlorophyll inside plant chloroplasts absorbs light energy, and oxygen is released as a vital byproduct into the atmosphere.',
      ],
      answer: 'Photosynthesis is the process by which green plants use sunlight, water, and carbon dioxide to create glucose and oxygen.',
    },
    {
      query: 'प्रकाश संश्लेषण क्या है?',
      passages: [
        'प्रकाश संश्लेषण वह जैव रासायनिक प्रक्रिया है जिसके द्वारा हरे पौधे सूर्य के प्रकाश, पर्णहरित (क्लोरोफिल), जल और कार्बन डाइऑक्साइड का उपयोग करके अपने भोजन के रूप में ग्लूकोज का निर्माण करते हैं। इस प्रक्रिया में ऑक्सीजन गैस उप-उत्पाद के रूप में वातावरण में मुक्त होती है।',
      ],
      answer: 'प्रकाश संश्लेषण वह प्रक्रिया है जिससे पौधे सूर्य के प्रकाश और क्लोरोफिल की मदद से भोजन बनाते हैं और ऑक्सीजन छोड़ते हैं।',
    },
    {
      query: 'What is DNA and its function in living organisms?',
      passages: [
        'Deoxyribonucleic acid (DNA) is the hereditary molecule that carries the genetic instructions used in the growth, development, functioning, and reproduction of all known living organisms. DNA is structured as a double helix composed of four chemical bases: adenine, thymine, guanine, and cytosine.',
      ],
      answer: 'DNA is a double-helix molecule that stores the genetic code and instructions for all living organisms.',
    },
    {
      query: 'What is cellular respiration?',
      passages: [
        'Cellular respiration is a metabolic pathway in cells that breaks down glucose in the presence of oxygen to produce adenosine triphosphate (ATP), the primary energy currency of cells. Carbon dioxide and water are produced as waste products of this process.',
      ],
      answer: 'Cellular respiration is the process where cells break down glucose with oxygen to produce ATP energy.',
    },

    // 2. Physics, Astronomy & Energy
    {
      query: 'What is gravity and how does it work?',
      passages: [
        'Gravity is a fundamental natural force by which all things with mass or energy are attracted toward one another. On Earth, gravity gives weight to physical objects and causes the ocean tides. Sir Isaac Newton described gravity with his universal law, while Albert Einstein described it as the curvature of spacetime in General Relativity.',
      ],
      answer: 'Gravity is the fundamental force of attraction between masses, causing objects to fall and planets to orbit.',
    },
    {
      query: 'What is the solar system and how many planets are in it?',
      passages: [
        'The solar system consists of the Sun and the gravitationally bound celestial bodies that orbit it, including eight recognized planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. The solar system formed approximately 4.6 billion years ago from the collapse of a giant interstellar molecular cloud.',
      ],
      answer: 'The solar system consists of the Sun and eight planets: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune.',
    },
    {
      query: 'What is the speed of light in a vacuum?',
      passages: [
        'The speed of light in a vacuum is an exact universal physical constant equal to 299,792,458 meters per second (approximately 300,000 kilometers per second or 186,282 miles per second). It represents the maximum speed at which all conventional matter and information in the universe can travel.',
      ],
      answer: 'The speed of light in a vacuum is exactly 299,792,458 meters per second (approx. 300,000 km/s).',
    },
    {
      query: 'What are renewable energy sources?',
      passages: [
        'Renewable energy is derived from natural sources that replenish themselves faster than they are consumed, such as solar power, wind energy, hydroelectric power, geothermal energy, and biomass. Renewable energy produces minimal greenhouse gas emissions compared to burning fossil fuels.',
      ],
      answer: 'Renewable energy comes from inexhaustible sources like solar, wind, hydro, and geothermal power.',
    },

    // 3. Computer Science, AI & Technology
    {
      query: 'What is Artificial Intelligence and Machine Learning?',
      passages: [
        'Artificial Intelligence (AI) is the simulation of human intelligence in machines programmed to think, learn, and solve problems. Machine Learning (ML) is a subset of AI that enables computer systems to learn patterns and improve their performance automatically from data without being explicitly programmed.',
      ],
      answer: 'AI is computer systems simulating human intelligence, and Machine Learning is algorithms learning patterns from data.',
    },
    {
      query: 'What is Retrieval-Augmented Generation or RAG?',
      passages: [
        'Retrieval-Augmented Generation (RAG) is an AI architecture that enhances large language model responses by retrieving relevant, verified factual passages from an external knowledge base or vector database before generating an answer. This significantly reduces hallucinations and ensures answers are grounded in verifiable sources.',
      ],
      answer: 'RAG is an AI technique that retrieves relevant factual context from a vector database to ground LLM answers and prevent hallucinations.',
    },
    {
      query: 'How does the Internet work?',
      passages: [
        'The Internet is a global network of interconnected computers communicating via standardized protocols known as the Internet Protocol Suite (TCP/IP). Data is broken down into small packets, routed across fiber-optic cables, satellites, and routers, and reassembled at the destination IP address.',
      ],
      answer: 'The Internet is a global network that routes data packets between computers using the TCP/IP protocol suite.',
    },

    // 4. Indian History, Geography & Culture
    {
      query: 'भारत की राजधानी क्या है?',
      passages: [
        'भारत एक दक्षिण एशियाई देश है जो क्षेत्रफल के हिसाब से सातवाँ सबसे बड़ा और जनसंख्या के हिसाब से सबसे बड़ा देश है। भारत की राजधानी नई दिल्ली है। भारत में 28 राज्य और 8 केंद्र शासित प्रदेश हैं। भारत की अर्थव्यवस्था विश्व की प्रमुख अर्थव्यवस्थाओं में से एक है।',
      ],
      answer: 'नई दिल्ली',
    },
    {
      query: 'ताजमहल कहाँ स्थित है और इसे किसने बनवाया?',
      passages: [
        'ताजमहल भारत के आगरा शहर में यमुना नदी के किनारे स्थित एक विश्व प्रसिद्ध स्मारक है। इसे मुगल सम्राट शाहजहाँ ने अपनी पत्नी मुमताज महल की याद में बनवाया था। यह यूनेस्को विश्व धरोहर स्थल है। इसका निर्माण 1632 में शुरू हुआ और 1653 में पूरा हुआ।',
      ],
      answer: 'आगरा, शाहजहाँ द्वारा निर्मित',
    },
    {
      query: 'What is the capital of India?',
      passages: [
        'India is a country in South Asia that is the seventh-largest country by area and the most populous country in the world. New Delhi is the official capital of India. The country comprises 28 states and 8 union territories.',
      ],
      answer: 'New Delhi',
    },
    {
      query: 'Where is the Taj Mahal located and who built it?',
      passages: [
        'The Taj Mahal is an ivory-white marble mausoleum on the right bank of the river Yamuna in the Indian city of Agra. It was commissioned in 1632 by the Mughal emperor Shah Jahan to house the tomb of his favourite wife, Mumtaz Mahal. It is a UNESCO World Heritage site.',
      ],
      answer: 'The Taj Mahal is located in Agra, India, and was built by Mughal emperor Shah Jahan.',
    },
    {
      query: 'गोवा के बारे में बताइए',
      passages: [
        'गोवा भारत का क्षेत्रफल के हिसाब से सबसे छोटा राज्य है। यह अपने खूबसूरत समुद्र तटों, ऐतिहासिक चर्चों और समृद्ध संस्कृति के लिए प्रसिद्ध है। गोवा 1961 में भारतीय संघ का हिस्सा बना। गोवा की राजधानी पणजी है।',
      ],
      answer: 'गोवा भारत का सबसे छोटा राज्य है, राजधानी पणजी है।',
    },
    {
      query: 'महात्मा गांधी कौन थे?',
      passages: [
        'महात्मा गांधी, जिनका पूरा नाम मोहनदास करमचंद गांधी था, भारत के स्वतंत्रता आंदोलन के प्रमुख नेता थे। उन्होंने सत्य और अहिंसा के सिद्धांतों पर आधारित सत्याग्रह आंदोलन का नेतृत्व किया। उनका जन्म 2 अक्टूबर 1869 को पोरबंदर में हुआ था।',
      ],
      answer: 'भारत के स्वतंत्रता आंदोलन के प्रमुख नेता और राष्ट्रपिता',
    },
    {
      query: 'हिमालय पर्वत श्रृंखला के बारे में जानकारी दें',
      passages: [
        'हिमालय पर्वत श्रृंखला एशिया में स्थित विश्व की सबसे ऊँची पर्वत श्रृंखला है। माउंट एवरेस्ट, जिसकी ऊँचाई 8,848.86 मीटर है, हिमालय की और पृथ्वी की सबसे ऊँची चोटी है। गंगा, यमुना और ब्रह्मपुत्र जैसी नदियाँ हिमालय से निकलती हैं।',
      ],
      answer: 'एशिया की सबसे ऊँची पर्वत श्रृंखला, माउंट एवरेस्ट सबसे ऊँची चोटी है।',
    },
    {
      query: 'भारतीय रेलवे का इतिहास क्या है?',
      passages: [
        'भारतीय रेलवे दुनिया के सबसे बड़े रेल नेटवर्कों में से एक है। भारत में पहली यात्री ट्रेन 16 अप्रैल 1853 को मुंबई के बोरीबंदर से ठाणे के बीच चलाई गई थी। इसका मुख्यालय नई दिल्ली में है।',
      ],
      answer: 'पहली ट्रेन 1853 में मुंबई से ठाणे के बीच चली।',
    },
    {
      query: 'आयुर्वेद चिकित्सा पद्धति क्या है?',
      passages: [
        'आयुर्वेद भारत की प्राचीन और पारंपरिक चिकित्सा पद्धति है जो 5,000 वर्षों से अधिक पुरानी है। यह स्वास्थ्य और कल्याण के लिए शरीर, मन और आत्मा के संतुलन पर जोर देती है। इसमें वात, पित्त और कफ तीन मुख्य दोष माने गए हैं।',
      ],
      answer: 'भारत की 5000 वर्ष पुरानी पारंपरिक चिकित्सा प्रणाली',
    },
    {
      query: 'What are the major rivers of India?',
      passages: [
        'Major rivers of India include the Ganges, Yamuna, Brahmaputra, Godavari, Krishna, and Narmada. The Ganges is considered sacred and flows over 2,525 km from the Gangotri glacier in the Himalayas to the Bay of Bengal.',
      ],
      answer: 'Ganges, Yamuna, Brahmaputra, Godavari, Krishna, and Narmada.',
    },
    {
      query: 'Tell me about Indian cuisine and spices',
      passages: [
        'Indian cuisine is known for its wide variety of regional culinary traditions and the balanced use of aromatic spices such as turmeric, cumin, coriander, cardamom, and black pepper. Distinct regional styles include North Indian gravies and South Indian rice-based delicacies.',
      ],
      answer: 'Diverse regional traditions characterized by spices like turmeric, cumin, and cardamom.',
    },
    {
      query: 'When was the Indian Constitution adopted?',
      passages: [
        'The Constitution of India was adopted by the Constituent Assembly on 26 November 1949 and came into legal effect on 26 January 1950, which is celebrated annually as Republic Day. Dr. B.R. Ambedkar served as the chairman of the Drafting Committee.',
      ],
      answer: 'The Constitution came into effect on 26 January 1950, with Dr. B.R. Ambedkar as drafting chairman.',
    },

    // 5. Earth Science & Human Body
    {
      query: 'What are the major oceans in the world?',
      passages: [
        'The Earth has five major oceans: the Pacific Ocean (the largest and deepest), the Atlantic Ocean, the Indian Ocean, the Southern (Antarctic) Ocean, and the Arctic Ocean (the smallest and shallowest). Together, they cover about 71% of Earth’s surface.',
      ],
      answer: 'The five oceans are Pacific, Atlantic, Indian, Southern, and Arctic oceans.',
    },
    {
      query: 'How does the human heart function?',
      passages: [
        'The human heart is a muscular organ with four chambers: two upper atria and two lower ventricles. It acts as a pump to circulate oxygenated blood received from the lungs throughout the body via arteries, and returns deoxygenated blood through veins back to the lungs.',
      ],
      answer: 'The heart is a four-chambered muscle that pumps oxygenated blood throughout the body and circulates it back through the lungs.',
    },
  ]
}

async function fetchHuggingFaceDataset(limit: number): Promise<{ query: string; passages: string[]; answer: string }[]> {
  console.log('📥 Fetching MSMARCO-XI dataset from HuggingFace API...')
  const records: { query: string; passages: string[]; answer: string }[] = []

  try {
    const url = `${HF_API_URL}&offset=0&length=${Math.min(limit, 50)}`
    const res = await fetch(url)
    if (res.ok) {
      const data = (await res.json()) as { rows: { row: Record<string, unknown> }[] }
      for (const { row } of data.rows) {
        const query = String(row.query ?? '')
        const answer = Array.isArray(row.answers) ? String(row.answers[0] ?? '') : String(row.answers ?? '')
        const passages: string[] = []

        if (row.passages && typeof row.passages === 'object') {
          const pTexts = (row.passages as any).passage_text
          if (Array.isArray(pTexts)) {
            for (const pt of pTexts) {
              if (typeof pt === 'string' && pt.trim()) passages.push(pt.trim())
            }
          }
        }

        if (query && passages.length > 0) {
          records.push({ query, passages, answer })
        }
      }
    }
  } catch (err) {
    console.warn('   ⚠️ Could not reach HuggingFace API, using comprehensive built-in dataset:', err instanceof Error ? err.message : err)
  }

  return records
}

async function main() {
  console.log('🚀 HHOGA Voice RAG Data Ingestion Pipeline')
  console.log(`   Strategy: ${STRATEGY_ARG}`)
  console.log(`   Limit: ${LIMIT}`)
  console.log(`   Dry Run: ${DRY_RUN}`)

  // 1. Fetch data
  let dataset = await fetchHuggingFaceDataset(LIMIT)
  if (dataset.length === 0) {
    dataset = getSampleData()
    console.log(`   Loaded ${dataset.length} bilingual sample documents`)
  }

  // 2. Chunk documents
  console.log('\n✂️  Chunking documents...')
  const allChunks: Chunk[] = []

  const strategiesToUse: ChunkStrategy[] = STRATEGY_ARG === 'all'
    ? ['sentence_boundary', 'fixed_overlap', 'paragraph', 'keyword_group', 'sliding_window']
    : [STRATEGY_ARG]

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i]!
    for (let pIdx = 0; pIdx < item.passages.length; pIdx++) {
      const passageText = item.passages[pIdx]!
      const docId = `doc-${i}-p${pIdx}`
      const lang = detectLanguage(passageText)

      for (const strat of strategiesToUse) {
        const chunks = chunkWithStrategy(passageText, docId, strat, lang)
        for (const chunk of chunks) {
          chunk.metadata.queryText = item.query
          chunk.metadata.answerText = item.answer
          chunk.metadata.source = item.query.length > 60 ? `${item.query.slice(0, 57)}...` : item.query
        }
        allChunks.push(...chunks)
      }
    }
  }

  console.log(`   Generated ${allChunks.length} chunks across strategies: [${strategiesToUse.join(', ')}]`)

  if (DRY_RUN) {
    console.log('✅ Dry run completed successfully.')
    return
  }

  // 3. Generate Gemini Embeddings
  console.log('\n🧮 Generating embeddings with Google Gemini (gemini-embedding-001)...')
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY!)
  const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })

  interface VectorRecord {
    id: string
    text: string
    embedding: number[]
    metadata: Chunk['metadata']
  }

  const vectors: VectorRecord[] = []

  for (let i = 0; i < allChunks.length; i++) {
    const chunk = allChunks[i]!
    try {
      const res = await embeddingModel.embedContent(chunk.text)
      vectors.push({
        id: chunk.id,
        text: chunk.text,
        embedding: res.embedding.values,
        metadata: chunk.metadata,
      })
      process.stdout.write(`\r   Embedded ${vectors.length}/${allChunks.length} chunks (${Math.round((vectors.length / allChunks.length) * 100)}%)`)
    } catch (err) {
      console.warn(`\n   ⚠️ Embedding failed for chunk ${chunk.id}:`, err instanceof Error ? err.message : err)
    }

    // Rate-limit delay (free tier friendly)
    if (i < allChunks.length - 1) {
      await new Promise(r => setTimeout(r, 600))
    }
  }

  // 4. Save to data/embeddings.json
  const dataDir = join(process.cwd(), 'data')
  mkdirSync(dataDir, { recursive: true })
  const outputPath = join(dataDir, 'embeddings.json')

  writeFileSync(outputPath, JSON.stringify(vectors, null, 2))
  console.log(`\n\n✅ Successfully saved ${vectors.length} vectors (${vectors[0]?.embedding.length ?? 0}D) to ${outputPath}`)
}

main().catch(err => {
  console.error('Fatal ingestion error:', err)
  process.exit(1)
})
