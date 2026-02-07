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
        // clear recursion handled by stream check
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
            // Tesseract sometimes struggles with direct <video> elements in some browsers/contexts.
            // Drawing to a canvas first is more robust.
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

            ctx.font = 'bold 16px Arial';
            ctx.textBaseline = 'top';

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

                // Draw Background Box
                const { x0, y0, x1, y1 } = line.bbox;
                const sx = x0 * scaleX;
                const sy = y0 * scaleY;
                const sw = (x1 - x0) * scaleX;
                const sh = (y1 - y0) * scaleY;

                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(sx, sy, sw, sh);

                // Draw Text
                ctx.fillStyle = '#FFF';
                const fontSize = Math.min(24, Math.max(12, sh * 0.8));
                ctx.font = `bold ${fontSize}px Arial`;
                ctx.fillText(translatedText, sx, sy + (sh - fontSize) / 2);
            }

        } catch (err) {
            console.error("Processing error: ", err);
        } finally {
            isProcessing = false;
            // Schedule next frame ONLY after this one finishes
            // Check if stream is still active before rescheduling
            if (stream && stream.active) {
                setTimeout(processFrame, 100); // 100ms delay between frames
            }
        }
    }
});
