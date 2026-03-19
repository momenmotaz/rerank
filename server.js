import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { pipeline } from '@xenova/transformers';
import { performance } from 'perf_hooks';
import Redis from 'ioredis';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const PORT = process.env.PORT || 4000;
const MODEL_NAME = process.env.MODEL_NAME || 'Xenova/bge-reranker-base';
const REDIS_URL = process.env.REDIS_URL;

let reranker = null;
let isModelLoading = false;
let redis = null;

if (REDIS_URL) {
  console.log('🔌 Connecting to Redis for caching...');
  redis = new Redis(REDIS_URL);
  redis.on('error', (err) => console.error('❌ Redis Error:', err));
  redis.on('connect', () => console.log('✅ Connected to Redis successfully.'));
}

async function initModel() {
  if (isModelLoading) return;
  isModelLoading = true;
  console.log(`⏳ Loading ${MODEL_NAME} model into RAM. Please wait...`);
  try {
    reranker = await pipeline('text-classification', MODEL_NAME, {
      quantized: true 
    });
    console.log('✅ Re-Ranker model loaded successfully and ready for queries!');
  } catch (err) {
    console.error('❌ Failed to load model:', err);
  } finally {
    isModelLoading = false;
  }
}

// Start loading immediately
initModel();

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: reranker ? 'ready' : (isModelLoading ? 'loading' : 'error'),
    model: MODEL_NAME,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/rerank', async (req, res) => {
  try {
    const { query, documents, top_k = 5, use_cache = true } = req.body;
    
    if (!query || !documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "Invalid request payload. 'query' and non-empty 'documents' array required." });
    }
    
    if (!reranker) {
      return res.status(503).json({ error: "Model is still loading or failed to load. Try again in a few seconds." });
    }

    const startTime = performance.now();
    const queryHash = crypto.createHash('md5').update(query).digest('hex');
    
    let scoredDocs = [];
    let cacheHits = 0;
    const docsToScore = [];
    const docsToScoreIndices = [];

    // 1. Check Cache
    if (redis && use_cache) {
      const cacheKeys = documents.map(doc => {
        const docText = doc.text || doc.chunkText || '';
        const docHash = crypto.createHash('md5').update(docText).digest('hex');
        return `rerank:cache:${queryHash}:${docHash}`;
      });

      const cachedScores = await redis.mget(...cacheKeys);
      
      documents.forEach((doc, i) => {
        if (cachedScores[i] !== null) {
          scoredDocs[i] = { ...doc, rerankScore: parseFloat(cachedScores[i]), cached: true };
          cacheHits++;
        } else {
          docsToScore.push(doc);
          docsToScoreIndices.push(i);
        }
      });
    } else {
      docsToScore.push(...documents);
      docsToScoreIndices.push(...documents.map((_, i) => i));
    }

    // 2. Score remaining documents
    if (docsToScore.length > 0) {
      console.log(`[ReRank] Scoring ${docsToScore.length} docs (Cache hits: ${cacheHits}) for query hash: ${queryHash}`);
      
      const scorePromises = docsToScore.map(doc => 
        reranker(query, doc.text || doc.chunkText || '', { topk: null })
      );
      
      const results = await Promise.all(scorePromises);
      
      const cachePipe = redis ? redis.pipeline() : null;

      results.forEach((result, i) => {
        let score = 0;
        if (Array.isArray(result)) {
          const relMatch = result.find(r => r.label === '1' || r.label === 'LABEL_1');
          score = relMatch ? relMatch.score : result[0].score;
        } else if (result && typeof result.score === 'number') {
          score = result.score;
        }

        const originalIndex = docsToScoreIndices[i];
        scoredDocs[originalIndex] = { ...docsToScore[i], rerankScore: score, cached: false };

        // Save to cache
        if (cachePipe) {
          const docText = docsToScore[i].text || docsToScore[i].chunkText || '';
          const docHash = crypto.createHash('md5').update(docText).digest('hex');
          const cacheKey = `rerank:cache:${queryHash}:${docHash}`;
          cachePipe.set(cacheKey, score, 'EX', 86400); // 24h expiry
        }
      });

      if (cachePipe) await cachePipe.exec();
    }

    // Sort descending by highest relevance
    scoredDocs.sort((a, b) => b.rerankScore - a.rerankScore);
    
    const topKDocs = scoredDocs.slice(0, top_k);
    const duration = (performance.now() - startTime).toFixed(2);
    
    console.log(`✅ Reranked ${documents.length} docs in ${duration}ms. [Hits: ${cacheHits}, Fresh: ${docsToScore.length}]`);

    return res.json({ 
      results: topKDocs,
      meta: {
        total_candidates: documents.length,
        cache_hits: cacheHits,
        fresh_scores: docsToScore.length,
        duration_ms: parseFloat(duration)
      }
    });

  } catch (error) {
    console.error("[ReRank API Error]", error);
    return res.status(500).json({ error: "Internal server error during reranking. " + error.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Dedicated AI Re-Ranker Server listening on http://localhost:${PORT}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
