const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const Redis = require('redis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// calculate cosine similarity
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// RAG Service
class RAGService {
    constructor(apiKey, redisClient) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.embeddingModel = this.genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        this.chatModel = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        this.redisClient = redisClient;
        this.redisKey = 'rag:context';
    }

    async getEmbedding(text) {
        const result = await this.embeddingModel.embedContent(text);
        return result.embedding.values;
    }

    async addDocument(text) {

        if (!text || text.length < 10) return;

        try {
            const embedding = await this.getEmbedding(text);
            const doc = {
                text,
                embedding,
                timestamp: Date.now()
            };

            // Push to Redis List (Right push)
            await this.redisClient.rPush(this.redisKey, JSON.stringify(doc));

            await this.redisClient.lTrim(this.redisKey, -50, -1);
        } catch (e) {
            console.error('Error adding to Redis vector store:', e);
        }
    }

    async query(question, topK = 3) {
        const queryEmbedding = await this.getEmbedding(question);

        // Retrieve all docs from Redis
        const rawDocs = await this.redisClient.lRange(this.redisKey, 0, -1);
        const docs = rawDocs.map(d => JSON.parse(d));

        const scoredDocs = docs.map(doc => ({
            ...doc,
            score: cosineSimilarity(queryEmbedding, doc.embedding)
        }));

        scoredDocs.sort((a, b) => b.score - a.score);
        return scoredDocs.slice(0, topK);
    }

    async generateAnswer(question) {
        const contextDocs = await this.query(question);
        const contextText = contextDocs.map(d => d.text).join("\n\n");

        const prompt = `
        You are a helpful AI assistant residing in a screen translation tool.
        The user is sharing their screen. Here is some text content that has been detected on their screen recently:
        
        --- STARTED CONTEXT ---
        ${contextText}
        --- END CONTEXT ---
        
        Values in context are OCR results, so they might have slight errors.
        User Question: ${question}
        
        If the answer is in the context, answer based on it. 
        If the answer is NOT in the context, using your own knowledge to answer, but mention that you didn't see it on the screen.
        Keep answers concise and helpful.
        `;

        const result = await this.chatModel.generateContent(prompt);
        return result.response.text();
    }
}

const redisClient = Redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
// Connect immediately for RAG service usage
(async () => {
    await redisClient.connect();
})();

const ragService = new RAGService(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY, redisClient);

app.use(cors());
// app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Translate API Proxy
app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLang } = req.body;

        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: 'Google API Key not configured' });
        }

        const cacheKey = `translate:${text}:${targetLang || 'es'}`;

        try {
            const cachedResult = await redisClient.get(cacheKey);
            if (cachedResult) {
                console.log('Serving from cache');
                return res.json(JSON.parse(cachedResult));
            }
        } catch (e) {
            console.error('Redis get error', e);
        }

        const response = await axios.post(
            `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
            {
                q: text,
                target: targetLang || 'zh-CN', // Default to Spanish
                format: 'text'
            }
        );

        try {
            await redisClient.set(cacheKey, JSON.stringify(response.data), {
                EX: 86400 // Cache for 24 hours
            });
        } catch (e) {
            console.error('Redis set error', e);
        }

        res.json(response.data);
    } catch (error) {
        console.error('Translation Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Translation failed' });
    }
});

// OCR API Proxy
app.post('/api/ocr', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Image data is required' });
        }

        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: 'Google API Key not configured' });
        }

        const base64Image = image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

        const apiCacheKey = `ocr:${base64Image.substring(0, 50)}:${base64Image.length}`;

        try {
            const cachedResult = await redisClient.get(apiCacheKey);
            if (cachedResult) {
                console.log('Serving OCR from cache');
                return res.json(JSON.parse(cachedResult));
            }
        } catch (e) {
            console.error('Redis get error', e);
        }

        const response = await axios.post(
            `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_API_KEY}`,
            {
                requests: [
                    {
                        image: {
                            content: base64Image
                        },
                        features: [
                            {
                                type: 'TEXT_DETECTION'
                            }
                        ]
                    }
                ]
            }
        );

        try {
            await redisClient.set(apiCacheKey, JSON.stringify(response.data), {
                EX: 86400 * 7 // Cache for 7 days
            });
        } catch (e) {
            console.error('Redis set error', e);
        }

        // --- RAG Indexing ---
        try {
            if (response.data.responses && response.data.responses[0]?.fullTextAnnotation?.text) {
                const fullText = response.data.responses[0].fullTextAnnotation.text;
                ragService.addDocument(fullText).catch(console.error);
                console.log('Indexed OCR text for RAG');
            }
        } catch (e) {
            console.error('RAG Indexing error', e);
        }

        res.json(response.data);
    } catch (error) {
        console.error('OCR Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'OCR failed' });
    }
});

// Chat API Endpoint
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const answer = await ragService.generateAnswer(message);
        res.json({ answer });

    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).json({ error: 'Failed to generate answer' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
