document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const video = document.getElementById('screenVideo');
    const videoContainer = document.getElementById('videoContainer');
    const startBtn = document.getElementById('startShareBtn');
    const stopBtn = document.getElementById('stopShareBtn');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const ctx = overlayCanvas.getContext('2d');
    const statusText = document.getElementById('statusId');
    const progressBar = document.getElementById('progressBar');
    const targetLangSelect = document.getElementById('targetLang');
    const overlayToggle = document.getElementById('overlayToggle');

    // Theme Elements
    const themeToggleBtn = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;
    const themeIcon = themeToggleBtn.querySelector('i');

    // Chat Elements
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatMessages = document.getElementById('chatMessages');

    // --- State ---
    const VISION_API_URL = '/api/ocr';
    let stream = null;
    let translationCache = new Map();
    let isProcessing = false;
    let currentSessionId = null;

    // --- Theme Logic ---
    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        htmlElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    }

    function toggleTheme() {
        const currentTheme = htmlElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        htmlElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    }

    function updateThemeIcon(theme) {
        if (theme === 'dark') {
            themeIcon.classList.replace('ph-sun', 'ph-moon');
        } else {
            themeIcon.classList.replace('ph-moon', 'ph-sun');
        }
    }

    themeToggleBtn.addEventListener('click', toggleTheme);
    initTheme();

    // --- Chat Logic ---
    function addMessage(text, isUser = false) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        if (isUser) {
            contentDiv.textContent = text;
        } else {
            // Parse Markdown for bot messages
            contentDiv.innerHTML = marked.parse(text);
            // Highlight code blocks
            contentDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }

        msgDiv.appendChild(contentDiv);
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function handleChatSubmit() {
        const text = chatInput.value.trim();
        if (!text) return;

        addMessage(text, true);
        chatInput.value = '';

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId: currentSessionId })
            });
            const data = await response.json();

            if (data.answer) {
                addMessage(data.answer);
            } else {
                addMessage("Sorry, I couldn't generate an answer.");
            }
        } catch (e) {
            console.error(e);
            addMessage("Error: Could not connect to the assistant.");
        }
    }

    sendChatBtn.addEventListener('click', handleChatSubmit);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleChatSubmit();
    });

    // --- Screen Share & Translation Logic ---

    startBtn.addEventListener('click', startScreenShare);

    async function startScreenShare() {
        try {
            // Start Session on Backend
            try {
                const res = await fetch('/api/start-session', { method: 'POST' });
                const data = await res.json();
                currentSessionId = data.sessionId;
                console.log('Session Started:', currentSessionId);
            } catch (e) {
                console.error('Failed to start session', e);
            }

            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: false
            });
            video.srcObject = stream;

            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusText.innerText = 'Session Recording...';
            progressBar.classList.remove('hide');
            videoContainer.classList.add('sharing-active');

            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };

            // Removed video.onloadedmetadata as per diff, assuming video is ready immediately or handled by processFrame
            resizeCanvas(); // Ensure canvas is sized correctly
            isProcessing = true;
            processFrame();
        } catch (err) {
            console.error("Error starting screen share:", err);
            statusText.innerText = 'Error starting screen share';
        }
    }

    stopBtn.addEventListener('click', stopScreenShare);

    function stopScreenShare() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null; // Set stream to null after stopping tracks
        }
        video.srcObject = null;
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); // Clear overlay

        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusText.innerText = 'Generating Report...';
        progressBar.classList.add('hide');
        videoContainer.classList.remove('sharing-active');
        isProcessing = false;

        // Trigger Report Download
        if (currentSessionId) {
            window.location.href = `/api/generate-report?sessionId=${currentSessionId}`;
            statusText.innerText = 'Report Downloaded. Ready to start.';
            currentSessionId = null;
        } else {
            statusText.innerText = 'Ready to start';
        }
    }

    function resizeCanvas() {
        if (!video.videoWidth) return;
        overlayCanvas.width = video.clientWidth;
        overlayCanvas.height = video.clientHeight;
    }

    window.addEventListener('resize', resizeCanvas);

    function startProcessing() {
        processFrame();
    }

    async function processFrame() {
        if (!stream || !stream.active) return;

        if (!overlayToggle.checked) {
            setTimeout(processFrame, 1000);
            return;
        }

        isProcessing = true;

        try {
            const captureCanvas = document.createElement('canvas');
            captureCanvas.width = video.videoWidth;
            captureCanvas.height = video.videoHeight;
            const captureCtx = captureCanvas.getContext('2d');
            captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

            const base64Image = captureCanvas.toDataURL('image/jpeg', 0.8);

            const response = await fetch(VISION_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image, sessionId: currentSessionId })
            });

            const data = await response.json();
            let lines = [];

            if (data.responses && data.responses[0] && data.responses[0].fullTextAnnotation) {
                lines = parseVisionResponse(data.responses[0].fullTextAnnotation);
            }

            const validLines = lines.filter(line => line.text.trim().length > 0);

            // Clear Overlay
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

            const scaleX = overlayCanvas.width / video.videoWidth;
            const scaleY = overlayCanvas.height / video.videoHeight;
            ctx.textBaseline = 'middle';

            for (const line of validLines) {
                const originalText = line.text.trim();
                const targetLang = targetLangSelect.value;
                const cacheKey = `${originalText}_${targetLang}`;

                let translatedText = originalText;

                if (translationCache.has(cacheKey)) {
                    translatedText = translationCache.get(cacheKey);
                } else {
                    try {
                        const response = await fetch('/api/translate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: originalText, targetLang })
                        });
                        const data = await response.json();
                        if (data.data && data.data.translations) {
                            translatedText = data.data.translations[0].translatedText;
                            translationCache.set(cacheKey, translatedText);
                        }
                    } catch (e) {
                        console.error('Translation API error', e);
                    }
                }

                // Draw Text
                const x0 = Math.min(...line.bbox.map(v => v.x));
                const y0 = Math.min(...line.bbox.map(v => v.y));
                const x1 = Math.max(...line.bbox.map(v => v.x));
                const y1 = Math.max(...line.bbox.map(v => v.y));

                const padding = 6;
                const sx = (x0 * scaleX) - padding;
                const sy = (y0 * scaleY) - padding;
                const sw = ((x1 - x0) * scaleX) + (padding * 2);
                const sh = ((y1 - y0) * scaleY) + (padding * 2);

                const bgColor = getAverageColor(captureCtx, x0, y0, x1 - x0, y1 - y0);

                // Rounded corners for text background
                roundRect(ctx, sx, sy, sw, sh, 4);
                ctx.fillStyle = `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`;
                ctx.fill();

                const brightness = (bgColor.r * 299 + bgColor.g * 587 + bgColor.b * 114) / 1000;
                ctx.fillStyle = brightness > 125 ? '#000' : '#FFF';

                const fontSize = Math.min(24, Math.max(12, (sh - 4) * 0.9));
                ctx.font = `bold ${fontSize}px Inter, Arial`;

                const textX = sx + padding;
                const textY = sy + (sh / 2);
                ctx.fillText(translatedText, textX, textY);
            }

        } catch (err) {
            console.error("Processing error: ", err);
        } finally {
            isProcessing = false;
            if (stream && stream.active) {
                setTimeout(processFrame, 1000);
            }
        }
    }

    // Helper to draw rounded rectangles
    function roundRect(ctx, x, y, width, height, radius) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    function getAverageColor(ctx, x, y, w, h) {
        try {
            if (w <= 0 || h <= 0) return { r: 0, g: 0, b: 0 };
            const imageData = ctx.getImageData(x, y, w, h);
            const data = imageData.data;
            let r = 0, g = 0, b = 0;
            let count = 0;

            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
                count++;
            }

            if (count > 0) {
                return {
                    r: Math.round(r / count),
                    g: Math.round(g / count),
                    b: Math.round(b / count)
                };
            }
        } catch (e) { }
        return { r: 0, g: 0, b: 0 };
    }

    function parseVisionResponse(fullTextAnnotation) {
        const lines = [];
        const pages = fullTextAnnotation.pages || [];

        for (const page of pages) {
            for (const block of page.blocks || []) {
                for (const paragraph of block.paragraphs || []) {
                    let paragraphText = "";
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

                    for (const word of paragraph.words || []) {
                        let wordText = "";
                        for (const symbol of word.symbols || []) {
                            wordText += symbol.text;
                            if (symbol.property && symbol.property.detectedBreak) {
                                const breakType = symbol.property.detectedBreak.type;
                                if (breakType === 'SPACE' || breakType === 'SURE_SPACE') {
                                    wordText += " ";
                                } else if (breakType === 'EOL_SURE_SPACE' || breakType === 'LINE_BREAK') {
                                    wordText += "\n";
                                }
                            }
                        }
                        paragraphText += wordText;

                        if (word.boundingBox && word.boundingBox.vertices) {
                            for (const v of word.boundingBox.vertices) {
                                const vx = v.x || 0;
                                const vy = v.y || 0;
                                minX = Math.min(minX, vx);
                                minY = Math.min(minY, vy);
                                maxX = Math.max(maxX, vx);
                                maxY = Math.max(maxY, vy);
                            }
                        }
                    }

                    if (paragraphText.trim()) {
                        lines.push({
                            text: paragraphText,
                            bbox: [
                                { x: minX, y: minY },
                                { x: maxX, y: minY },
                                { x: maxX, y: maxY },
                                { x: minX, y: maxY }
                            ]
                        });
                    }
                }
            }
        }
        return lines;
    }
});
