const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const Redis = require('redis');
require('dotenv').config();
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const redisClient = Redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.connect().catch(console.error);

redisClient.on('error', (err) => console.log('Redis Client Error', err));

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
                target: targetLang || 'es', // Default to Spanish
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

        // The image comes as "data:image/png;base64,...", we need just the base64 part
        const base64Image = image.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

        // Simple hash of base64 string for cache key
        // keeping it simple to avoid extra dependencies, but could use crypto
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
                EX: 86400 * 7 // Cache for 7 days, OCR results unlikely to change
            });
        } catch (e) {
            console.error('Redis set error', e);
        }

        res.json(response.data);
    } catch (error) {
        console.error('OCR Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'OCR failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
