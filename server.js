const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
require('dotenv').config();
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

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

        const response = await axios.post(
            `https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_API_KEY}`,
            {
                q: text,
                target: targetLang || 'es', // Default to Spanish
                format: 'text'
            }
        );

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

        res.json(response.data);
    } catch (error) {
        console.error('OCR Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'OCR failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
