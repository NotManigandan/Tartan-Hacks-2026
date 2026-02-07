document.addEventListener('DOMContentLoaded', () => {
    // Initialize Materialize Components
    M.AutoInit();

    const video = document.getElementById('screenVideo');
    const startBtn = document.getElementById('startShareBtn');
    const stopBtn = document.getElementById('stopShareBtn');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const ctx = overlayCanvas.getContext('2d');
    const statusText = document.getElementById('statusId');
    const progressBar = document.getElementById('progressBar');
    const targetLangSelect = document.getElementById('targetLang');
    const overlayToggle = document.getElementById('overlayToggle');

    let stream = null;
    let recognitionInterval = null;
    let translationCache = new Map(); // Simple cache: text -> translatedText
    let isProcessing = false;

    // Tesseract Worker
    let worker = null;

    async function initTesseract() {
        statusText.innerText = 'Initializing Tesseract...';
        worker = await Tesseract.createWorker('eng');
        statusText.innerText = 'Ready to share screen.';
    }

    initTesseract();

    startBtn.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: false
            });
            video.srcObject = stream;

            startBtn.disabled = true;
            stopBtn.disabled = false;
            statusText.innerText = 'Screen sharing active. Processing...';
            progressBar.classList.remove('hide');

            // Handle stream stop (e.g. via browser UI)
            stream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };

            // Wait for video to load metadata to set canvas size
            video.onloadedmetadata = () => {
                resizeCanvas();
                startProcessing();
            };

        } catch (err) {
            console.error("Error sharing screen: ", err);
            statusText.innerText = 'Error starting screen share.';
        }
    });

    stopBtn.addEventListener('click', stopScreenShare);

    function stopScreenShare() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }
        video.srcObject = null;
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        startBtn.disabled = false;
        stopBtn.disabled = true;
        statusText.innerText = 'Screen share stopped.';
        progressBar.classList.add('hide');
        isProcessing = false;
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
        if (!stream || !worker) return; // Stop if no stream

        // 0. Check if we should process
        if (!overlayToggle.checked) {
            // If overlay is off, check again in 1 second
            setTimeout(processFrame, 1000);
            return;
        }

        isProcessing = true;

        try {
            // 1. Capture Frame to Offscreen Canvas
            const captureCanvas = document.createElement('canvas');
            captureCanvas.width = video.videoWidth;
            captureCanvas.height = video.videoHeight;
            const captureCtx = captureCanvas.getContext('2d');
            captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

            // 2. OCR
            const ret = await worker.recognize(captureCanvas);
            const lines = ret.data.lines;

            // 3. Prepare for Translation
            const validLines = lines.filter(line => line.text.trim().length > 2 && line.confidence > 60);

            // 4. Clear and Draw Overlay
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

            const scaleX = overlayCanvas.width / video.videoWidth;
            const scaleY = overlayCanvas.height / video.videoHeight;

            // Common font settings for measurement/baseline
            ctx.textBaseline = 'middle';

            for (const line of validLines) {
                const originalText = line.text.trim();
                const targetLang = targetLangSelect.value;
                const cacheKey = `${originalText}_${targetLang}`;

                let translatedText = originalText;

                // Check Cache
                if (translationCache.has(cacheKey)) {
                    translatedText = translationCache.get(cacheKey);
                } else {
                    // Call API
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

                // Geometric Data
                const { x0, y0, x1, y1 } = line.bbox;

                // VISUAL POLISH: Padding
                const padding = 4;
                const sx = (x0 * scaleX) - padding;
                const sy = (y0 * scaleY) - padding;
                const sw = ((x1 - x0) * scaleX) + (padding * 2);
                const sh = ((y1 - y0) * scaleY) + (padding * 2);

                // Adaptive Background
                const bgColor = getAverageColor(captureCtx, x0, y0, x1 - x0, y1 - y0);

                // Draw Background
                ctx.fillStyle = `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`;
                ctx.fillRect(sx, sy, sw, sh);

                // Adaptive Text Color
                // YIQ brightness formula
                const brightness = (bgColor.r * 299 + bgColor.g * 587 + bgColor.b * 114) / 1000;
                ctx.fillStyle = brightness > 125 ? '#000' : '#FFF';

                // Font Sizing & Centering
                // Fit text within height with some margin
                const fontSize = Math.min(24, Math.max(12, (sh - 4) * 0.9));
                ctx.font = `bold ${fontSize}px Arial`;

                const textX = sx + padding;
                // Vertical center: box top + half height
                const textY = sy + (sh / 2);

                ctx.fillText(translatedText, textX, textY);
            }

        } catch (err) {
            console.error("Processing error: ", err);
        } finally {
            isProcessing = false;
            // Schedule next frame ONLY after this one finishes
            if (stream && stream.active) {
                setTimeout(processFrame, 100);
            }
        }
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
        } catch (e) {
            // console.warn(e);
        }
        // Default to black if something fails
        return { r: 0, g: 0, b: 0 };
    }
});
