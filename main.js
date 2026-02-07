
import { Mat4 } from './math.js';

// Configuration
const CONFIG = {
    laneWidth: 3,
    speed: 0.5,
    obstacleSpeed: 0.2,
    spawnInterval: 1400,
};

let state = {
    isPlaying: false,
    score: 0,
    speed: CONFIG.speed,
    lastTime: 0,
    spawnTimer: 0,
    lane: 0,
    targetX: 0,
};

// UI Elements
const dom = {
    score: document.getElementById('score-display'),
    startScreen: document.getElementById('start-screen'),
    gameOverScreen: document.getElementById('game-over-screen'),
    finalScore: document.getElementById('final-score'),
    startBtn: document.getElementById('start-btn'),
    retryBtn: document.getElementById('retry-btn'),
};

// WebGL Setup
const canvas = document.createElement('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
document.getElementById('canvas-container').appendChild(canvas);
const gl = canvas.getContext('webgl');

if (!gl) {
    alert('WebGL not supported');
    throw new Error('WebGL not supported');
}

// Explicit viewport setting
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();


// Shaders
const vsSource = `
  attribute vec4 aVertexPosition;
  attribute vec4 aVertexColor;
  
  uniform mat4 uModelViewMatrix;
  uniform mat4 uProjectionMatrix;
  
  varying lowp vec4 vColor;
  varying highp float vDepth;
  
  void main() {
    gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
    vColor = aVertexColor;
    // Map z to roughly 0-1 range for fog for debug
    // Use gl_Position.w which is -z_view
    vDepth = gl_Position.w; 
  }
`;

const fsSource = `
  varying lowp vec4 vColor;
  varying highp float vDepth;
  
  void main() {
    // Fog: Start at 20, End at 120 (Further visibility)
    highp float fogFactor = (vDepth - 20.0) / 100.0;
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    // Background Color match
    lowp vec4 fogColor = vec4(0.02, 0.02, 0.06, 1.0);
    
    gl_FragColor = mix(vColor, fogColor, fogFactor);
  }
`;

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    if (!vertexShader || !fragmentShader) return null;

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
        alert('Shader Link Error: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return shaderProgram;
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        alert('Shader Compile Error: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

const shaderProgram = initShaderProgram(gl, vsSource, fsSource);
if (!shaderProgram) {
    throw new Error('Shader init failed');
}

gl.useProgram(shaderProgram); // Explicitly use program

const programInfo = {
    program: shaderProgram,
    attribLocations: {
        vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
        vertexColor: gl.getAttribLocation(shaderProgram, 'aVertexColor'),
    },
    uniformLocations: {
        projectionMatrix: gl.getUniformLocation(shaderProgram, 'uProjectionMatrix'),
        modelViewMatrix: gl.getUniformLocation(shaderProgram, 'uModelViewMatrix'),
    },
};

// Geometry Helpers
function createBox(w, h, d, tx, ty, tz, r, g, b) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const verts = [
        // Front
        -hw, -hh, hd, hw, -hh, hd, hw, hh, hd, -hw, hh, hd,
        // Back
        -hw, -hh, -hd, -hw, hh, -hd, hw, hh, -hd, hw, -hh, -hd,
        // Top
        -hw, hh, -hd, -hw, hh, hd, hw, hh, hd, hw, hh, -hd,
        // Bottom
        -hw, -hh, -hd, hw, -hh, -hd, hw, -hh, hd, -hw, -hh, hd,
        // Right
        hw, -hh, -hd, hw, hh, -hd, hw, hh, hd, hw, -hh, hd,
        // Left
        -hw, -hh, -hd, -hw, -hh, hd, -hw, hh, hd, -hw, hh, -hd,
    ];

    // Apply translation
    for (let i = 0; i < verts.length; i += 3) {
        verts[i] += tx;
        verts[i + 1] += ty;
        verts[i + 2] += tz;
    }

    const indices = [
        0, 1, 2, 0, 2, 3,    // front
        4, 5, 6, 4, 6, 7,    // back
        8, 9, 10, 8, 10, 11,   // top
        12, 13, 14, 12, 14, 15,   // bottom
        16, 17, 18, 16, 18, 19,   // right
        20, 21, 22, 20, 22, 23,   // left
    ];

    const colors = [];
    for (let i = 0; i < 24; i++) {
        let shade = 1.0;
        if (i >= 8 && i < 12) shade = 1.2;
        if (i >= 12 && i < 16) shade = 0.6;
        colors.push(r * shade, g * shade, b * shade, 1.0);
    }

    return { verts, indices, colors };
}

function mergeGeometries(geoms) {
    let allVerts = [];
    let allIndices = [];
    let allColors = [];
    let indexOffset = 0;

    for (const g of geoms) {
        allVerts.push(...g.verts);
        allColors.push(...g.colors);
        for (const idx of g.indices) {
            allIndices.push(idx + indexOffset);
        }
        indexOffset += g.verts.length / 3;
    }
    return {
        verts: new Float32Array(allVerts),
        indices: new Uint16Array(allIndices),
        colors: new Float32Array(allColors)
    };
}

function createCarMesh(baseColorR, baseColorG, baseColorB) {
    const parts = [];
    // Chassis
    parts.push(createBox(1.5, 0.5, 3.0, 0, 0.25, 0, baseColorR, baseColorG, baseColorB));
    // Cabin
    parts.push(createBox(1.2, 0.4, 1.5, 0, 0.7, -0.2, 0.2, 0.2, 0.2)); // Dark gray cabin
    // Wheels
    const wColor = [0.1, 0.1, 0.1];
    parts.push(createBox(0.4, 0.4, 0.6, -0.85, 0.2, 1.0, ...wColor));
    parts.push(createBox(0.4, 0.4, 0.6, 0.85, 0.2, 1.0, ...wColor));
    parts.push(createBox(0.4, 0.4, 0.6, -0.85, 0.2, -1.0, ...wColor));
    parts.push(createBox(0.4, 0.4, 0.6, 0.85, 0.2, -1.0, ...wColor));

    return mergeGeometries(parts);
}

// Geometry Helpers
// ... (createBox, mergeGeometries, createCarMesh remain same)

function createRoadSegments(length, dashSize, gapSize) {
    const parts = [];

    // 1. Road Base
    // Width 12 (covers 3 lanes of width 3 + shoulders)
    // Centered at z = -length/2 to extend into distance
    parts.push(createBox(12, 0.1, length, 0, -1, -length / 2, 0.1, 0.1, 0.15)); // Dark Grey asphalt

    // 2. Side Rails (Neon)
    parts.push(createBox(0.5, 0.5, length, -5, -0.8, -length / 2, 0.0, 0.8, 1.0)); // Cyan Left
    parts.push(createBox(0.5, 0.5, length, 5, -0.8, -length / 2, 0.0, 0.8, 1.0)); // Cyan Right

    // 3. Lane Markers (Dashed)
    // Lanes at -3, 0, 3. Dividers at -1.5 and 1.5
    const numDashes = Math.floor(length / (dashSize + gapSize));

    for (let i = 0; i < numDashes; i++) {
        const z = - (i * (dashSize + gapSize));
        // Left Divider
        parts.push(createBox(0.3, 0.15, dashSize, -1.5, -0.9, z, 1.0, 1.0, 0.9));
        // Right Divider
        parts.push(createBox(0.3, 0.15, dashSize, 1.5, -0.9, z, 1.0, 1.0, 0.9));
    }

    return mergeGeometries(parts);
}

// Generate Meshes
const playerMesh = createCarMesh(0.0, 1.0, 0.8); // Teal
const enemyMesh = createCarMesh(1.0, 0.0, 0.33); // Red
// Road: 200 units long segment (short enough to loop, long enough to cover fog)
const roadSegmentLength = 200;
const roadMesh = createRoadSegments(roadSegmentLength, 5, 5);

const buffers = {
    player: {
        position: gl.createBuffer(),
        color: gl.createBuffer(),
        indices: gl.createBuffer(),
        count: playerMesh.indices.length
    },
    enemy: {
        position: gl.createBuffer(),
        color: gl.createBuffer(),
        indices: gl.createBuffer(),
        count: enemyMesh.indices.length
    },
    road: {
        position: gl.createBuffer(),
        color: gl.createBuffer(),
        indices: gl.createBuffer(),
        count: roadMesh.indices.length
    }
};

function uploadMesh(bufObj, meshData) {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufObj.position);
    gl.bufferData(gl.ARRAY_BUFFER, meshData.verts, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufObj.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, meshData.indices, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufObj.color);
    gl.bufferData(gl.ARRAY_BUFFER, meshData.colors, gl.STATIC_DRAW);
}

uploadMesh(buffers.player, playerMesh);
uploadMesh(buffers.enemy, enemyMesh);
uploadMesh(buffers.road, roadMesh);


// Entities
let player = { x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, rotZ: 0 };
let obstacles = [];
let roadOffset = 0; // For scrolling effect

function createObstacle() {
    const lane = Math.floor(Math.random() * 3) - 1;
    const x = lane * CONFIG.laneWidth;
    obstacles.push({
        x: x, y: 0, z: -100, // Spawn further out
        active: true
    });
}

// Input
function handleInput(xChange) {
    if (!state.isPlaying) return;
    state.lane += xChange;
    if (state.lane < -1) state.lane = -1;
    if (state.lane > 1) state.lane = 1;
    state.targetX = state.lane * CONFIG.laneWidth;
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') handleInput(-1);
    if (e.key === 'ArrowRight' || e.key === 'd') handleInput(1);
});

let startX = 0;
const getX = (e) => e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
window.addEventListener('touchstart', (e) => startX = getX(e), { passive: false });
window.addEventListener('mousedown', (e) => startX = getX(e));
const handleEnd = (e) => {
    const diff = getX(e) - startX;
    if (Math.abs(diff) > 30) handleInput(diff > 0 ? 1 : -1);
};
window.addEventListener('touchend', handleEnd);
window.addEventListener('mouseup', handleEnd);

// Game Funcs
function startGame() {
    state.isPlaying = true;
    state.score = 0;
    state.lane = 0;
    state.targetX = 0;
    state.spawnTimer = 0;
    player.x = 0;
    player.rotZ = 0;
    obstacles = [];
    roadOffset = 0;

    dom.score.textContent = 'Score: 0';
    dom.startScreen.classList.add('hidden');
    dom.gameOverScreen.classList.add('hidden');
}

function gameOver() {
    state.isPlaying = false;
    dom.finalScore.textContent = `Score: ${Math.floor(state.score)}`;
    dom.gameOverScreen.classList.remove('hidden');
}

dom.startBtn.addEventListener('click', startGame);
dom.retryBtn.addEventListener('click', startGame);

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
});


// Rendering Helper
const projectionMatrix = Mat4.create();
const modelViewMatrix = Mat4.create();

function drawMesh(x, y, z, bufferObj, rotZ = 0, drawMode = gl.TRIANGLES) {
    Mat4.identity(modelViewMatrix);

    // Camera Transform (View Matrix) - Adjusted for better view
    // Move Camera HIGHER (Y: -3 -> -5) and FURTHER BACK (Z: -10 -> -15)
    Mat4.translate(modelViewMatrix, modelViewMatrix, [0, -5, -15]);

    // Tilt World (Pitch)
    Mat4.rotateX(modelViewMatrix, modelViewMatrix, 0.4);

    // Model Transform
    Mat4.translate(modelViewMatrix, modelViewMatrix, [x, y, z]);
    if (rotZ !== 0) Mat4.rotateZ(modelViewMatrix, modelViewMatrix, rotZ);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.position);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufferObj.color);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexColor);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufferObj.indices);

    gl.uniformMatrix4fv(programInfo.uniformLocations.projectionMatrix, false, projectionMatrix);
    gl.uniformMatrix4fv(programInfo.uniformLocations.modelViewMatrix, false, modelViewMatrix);

    gl.drawElements(drawMode, bufferObj.count, gl.UNSIGNED_SHORT, 0);
}


function render(time) {
    const delta = time - state.lastTime;
    state.lastTime = time;

    gl.clearColor(0.05, 0.05, 0.1, 1.0); // Slightly lighter background
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const fov = 45 * Math.PI / 180;
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    Mat4.perspective(projectionMatrix, fov, aspect, 0.1, 150.0); // Increase Far plane

    // Update Road Scroll
    // Scroll Z from 0 to 10 (dash pattern length = 10)
    const patternLength = 10;
    if (state.isPlaying) {
        roadOffset = (roadOffset + 0.5) % patternLength;
    }

    // Draw Road - Draw two segments to cover the distance seamlessly
    // Segment 1
    drawMesh(0, 0, roadOffset, buffers.road);
    // Segment 2 (behind it, although our z is negative, so "in front" effectively)
    // Actually, we define road from 0 to -200.
    // We want to draw one at 0 and one at -200?
    // Fog covers up to 120. Segment is 200. One segment is enough if we wrap it correctly.
    // But moving it +10 means we see empty space at -200?
    // Easier: Draw 2 segments always.
    // Segment 1 at Z = offset
    // Segment 2 at Z = offset - 200
    drawMesh(0, 0, roadOffset - 200, buffers.road);

    if (state.isPlaying) {
        player.x += (state.targetX - player.x) * 0.1;
        player.rotZ = (player.x - state.targetX) * -0.05;

        if (time > state.spawnTimer) {
            createObstacle();
            state.spawnTimer = time + CONFIG.spawnInterval;
        }

        const moveSpeed = 0.5;
        const dt = delta / 16;

        for (let i = obstacles.length - 1; i >= 0; i--) {
            const ob = obstacles[i];
            ob.z += moveSpeed * dt;

            if (Math.abs(ob.z - player.z) < 2.5 && Math.abs(ob.x - player.x) < 1.2) {
                gameOver();
            }

            if (ob.z > 10) {
                obstacles.splice(i, 1);
                state.score++;
                dom.score.textContent = `Score: ${state.score}`;
            }

            drawMesh(ob.x, ob.y, ob.z, buffers.enemy);
        }
    }

    // Draw Player
    drawMesh(player.x, player.y, player.z, buffers.player, player.rotZ);

    requestAnimationFrame(render);
}


// Start loop
requestAnimationFrame(render);
