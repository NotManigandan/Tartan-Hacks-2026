const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const Redis = require('redis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const PDFDocument = require('pdfkit');
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

// Session Management
app.post('/api/start-session', async (req, res) => {
    try {
        const sessionId = Date.now().toString();
        // Initialize empty logs list
        await redisClient.del(`session:${sessionId}:logs`);
        res.json({ sessionId });
    } catch (error) {
        console.error('Start Session Error:', error);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

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
        const { image, sessionId } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'Image is required' });
        }

        // Remove header if present
        const base64Image = image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

        // Generate a hash or key for the image to cache results
        // For simplicity, use first 50 chars + length as key (in production use real hash)
        const apiCacheKey = `ocr:${base64Image.substring(0, 50)}:${base64Image.length}`;

        try {
            const cachedResult = await redisClient.get(apiCacheKey);
            if (cachedResult) {
                console.log('Serving OCR from cache');
                const data = JSON.parse(cachedResult);

                // Log to session even on cache hit if helpful, but maybe dedupe
                if (sessionId && data.responses && data.responses[0]?.fullTextAnnotation?.text) {
                    const text = data.responses[0].fullTextAnnotation.text;
                    await redisClient.rPush(`session:${sessionId}:logs`, JSON.stringify({
                        type: 'ocr',
                        text: text,
                        timestamp: Date.now()
                    }));
                }

                return res.json(data);
            }
        } catch (e) {
            console.error('Redis get error', e);
        }

        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: 'Google API Key not configured' });
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
                EX: 86400 * 7 // Cache for 7 days, OCR results unlikely to change
            });
        } catch (e) {
            console.error('Redis set error', e);
        }

        // --- RAG Indexing & Session Logging ---
        try {
            if (response.data.responses && response.data.responses[0]?.fullTextAnnotation?.text) {
                const fullText = response.data.responses[0].fullTextAnnotation.text;
                // Run in background to not block response
                ragService.addDocument(fullText).catch(console.error);

                if (sessionId) {
                    await redisClient.rPush(`session:${sessionId}:logs`, JSON.stringify({
                        type: 'ocr',
                        text: fullText,
                        timestamp: Date.now()
                    }));
                }

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
        const { message, sessionId } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const answer = await ragService.generateAnswer(message);

        if (sessionId) {
            await redisClient.rPush(`session:${sessionId}:logs`, JSON.stringify({
                type: 'chat',
                question: message,
                answer: answer,
                timestamp: Date.now()
            }));
        }

        res.json({ answer });

    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).json({ error: 'Failed to generate answer' });
    }
});

// Generate Report Endpoint
app.get('/api/generate-report', async (req, res) => {
    try {
        const { sessionId } = req.query;
        if (!sessionId) return res.status(400).send('Session ID required');

        const logsRaw = await redisClient.lRange(`session:${sessionId}:logs`, 0, -1);
        const logs = logsRaw.map(l => JSON.parse(l));

        if (logs.length === 0) {
            return res.status(404).send('No logs found for this session');
        }

        // 1. Generate Summary with Gemini
        const logText = logs.map(l => {
            if (l.type === 'ocr') return `[SCREEN TEXT]: ${l.text.substring(0, 200)}...`;
            if (l.type === 'chat') return `[USER ASKED]: ${l.question}\n[AI ANSWERED]: ${l.answer}`;
            return '';
        }).join('\n');

        const summaryPrompt = `
        Analyze the following troubleshooting session logs and generate a structured Incident Report.
        
        LOGS:
        ${logText}
        
        OUTPUT FORMAT (JSON):
        {
            "problem_description": "Brief summary of what the user was looking at or asking about.",
            "root_cause": "Inferred root cause based on errors seen or questions asked.",
            "steps_taken": ["Step 1", "Step 2", ...],
            "recommendations": "What should be done next?"
        }
        `;

        const model = ragService.chatModel;
        const result = await model.generateContent(summaryPrompt);
        const summaryText = result.response.text();

        // Clean markdown code blocks if present
        const jsonString = summaryText.replace(/```json/g, '').replace(/```/g, '').trim();
        let summaryData = {};
        try {
            summaryData = JSON.parse(jsonString);
        } catch (e) {
            summaryData = { problem_description: "Could not parse AI summary", steps_taken: [] };
        }

        // 2. Generate PDF using PDFKit
        const doc = new PDFDocument();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=incident_report_${sessionId}.pdf`);

        doc.pipe(res);

        // Header
        doc.fontSize(20).text('Incident Report & SOP', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Session ID: ${sessionId}`);
        doc.text(`Date: ${new Date().toLocaleString()}`);
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // AI Summary Section
        doc.fontSize(16).text('Executive Summary');
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold').text('Problem Description:');
        doc.font('Helvetica').text(summaryData.problem_description || 'N/A');
        doc.moveDown();

        if (summaryData.root_cause) {
            doc.font('Helvetica-Bold').text('Inferred Root Cause:');
            doc.font('Helvetica').text(summaryData.root_cause);
            doc.moveDown();
        }

        doc.font('Helvetica-Bold').text('Steps Taken / SOP:');
        if (summaryData.steps_taken && Array.isArray(summaryData.steps_taken)) {
            summaryData.steps_taken.forEach((step, i) => {
                doc.font('Helvetica').text(`${i + 1}. ${step}`);
            });
        }
        doc.moveDown();

        if (summaryData.recommendations) {
            doc.font('Helvetica-Bold').text('Recommendations:');
            doc.font('Helvetica').text(summaryData.recommendations);
            doc.moveDown();
        }

        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Detailed Logs
        doc.fontSize(16).text('Session Verification Logs');
        doc.moveDown(0.5);
        doc.fontSize(10);

        logs.forEach(log => {
            const time = new Date(log.timestamp).toLocaleTimeString();
            if (log.type === 'ocr') {
                doc.fillColor('gray').text(`[${time}] Text Detected on Screen:`);
                doc.fillColor('black').text(log.text.substring(0, 100).replace(/\n/g, ' ') + '...');
            } else if (log.type === 'chat') {
                doc.fillColor('blue').text(`[${time}] User: ${log.question}`);
                doc.fillColor('green').text(`AI: ${log.answer}`);
            }
            doc.moveDown(0.5);
        });

        doc.end();

    } catch (error) {
        console.error('Report Generation Error:', error);
        if (!res.headersSent) res.status(500).send('Failed to generate report');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
