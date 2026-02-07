
// Web Audio API Context
let audioCtx = null;
let bgmNodes = [];
let isMuted = false;
let currentSpeed = 1.0;

export function initAudio() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
}

export function playCrash() {
    if (!audioCtx || isMuted) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const t = audioCtx.currentTime;

    // 1. Distorted Noise (Impact) - Longer and deeper
    const bufferSize = audioCtx.sampleRate * 1.0;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2); // Decay curve
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(800, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(10, t + 0.8);

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(1.0, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.8);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noise.start(t);

    // 2. Sub-bass boom (Thud)
    const osc = audioCtx.createOscillator();
    osc.type = 'triangle'; // Smoother but heavy
    osc.frequency.setValueAtTime(60, t);
    osc.frequency.exponentialRampToValueAtTime(10, t + 0.5);

    const oscGain = audioCtx.createGain();
    oscGain.gain.setValueAtTime(0.8, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    osc.connect(oscGain);
    oscGain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.5);
}

export function startMusic() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (bgmNodes.length > 0) return;

    const bpm = 110;

    // Bass Sequence (E2 root - Driving)
    // E - E - G - A 
    const sequence = [82.41, 82.41, 98.00, 110.00];
    let noteIndex = 0;

    let nextNoteTime = audioCtx.currentTime;

    const scheduler = () => {
        while (nextNoteTime < audioCtx.currentTime + 0.1) {
            // Dynamic beat length based on speed
            const beatLen = (60 / bpm) / currentSpeed;

            // Bass line
            playNote(sequence[noteIndex], nextNoteTime, beatLen);

            // Kick Drum (Constant beat)
            playKick(nextNoteTime);

            // Hi-hat (Off-beat)
            playHiHat(nextNoteTime + beatLen / 2);

            nextNoteTime += beatLen;
            noteIndex = (noteIndex + 1) % sequence.length;
        }

        if (bgmNodes.length > 0) {
            const timerID = setTimeout(scheduler, 25);
            bgmNodes.push({ stop: () => clearTimeout(timerID) });
        }
    };

    bgmNodes.push({ dummy: true });
    scheduler();
}

export function setMusicSpeed(speed) {
    // Clamp speed to avoid audio breaking
    currentSpeed = Math.max(1.0, Math.min(speed, 2.0));
}

function playNote(freq, time, duration) {
    if (isMuted) return;

    // Adjust duration for faster tempo?
    // Actually, duration should probably scale too to keep distinct notes
    // But for now let's just keep duration fixed or slightly scaled
    const scaledDuration = duration / currentSpeed;

    const osc = audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, time); // Brighter bass
    filter.frequency.linearRampToValueAtTime(100, time + scaledDuration - 0.05);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.15, time); // Lower volume to mix with drums
    gain.gain.exponentialRampToValueAtTime(0.01, time + scaledDuration - 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(time);
    osc.stop(time + scaledDuration);
}

function playKick(time) {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.5);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.5);
}

function playHiHat(time) {
    if (isMuted) return;
    // Simple noise burst for hi-hat
    const bufferSize = audioCtx.sampleRate * 0.05;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5000;

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.1, time);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(time);
}

export function stopMusic() {
    bgmNodes.forEach(n => {
        if (n.stop) n.stop();
    });
    bgmNodes = [];
}
