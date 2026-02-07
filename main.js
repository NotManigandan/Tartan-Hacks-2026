
// Game Configuration
const CONFIG = {
    laneWidth: 3,
    laneCount: 3, // -1 (left), 0 (center), 1 (right)
    speed: 0.5,
    obstacleSpeed: 0.2,
    spawnInterval: 1500, // ms
};

// State
let state = {
    isPlaying: false,
    score: 0,
    speed: CONFIG.speed,
    lastTime: 0,
    spawnTimer: 0,
    lane: 0, // -1, 0, 1
    targetX: 0,
};

// Elements
const dom = {
    score: document.getElementById('score-display'),
    startScreen: document.getElementById('start-screen'),
    gameOverScreen: document.getElementById('game-over-screen'),
    finalScore: document.getElementById('final-score'),
    startBtn: document.getElementById('start-btn'),
    retryBtn: document.getElementById('retry-btn'),
};

import * as THREE from 'three';

// setup Three.js
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.Fog(0x050510, 10, 50);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, 6);
camera.lookAt(0, 0, -5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xff00ff, 0.8);
dirLight.position.set(5, 10, 0);
scene.add(dirLight);

// Floor / Road
const roadGeo = new THREE.PlaneGeometry(20, 200);
const roadMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.8,
});
const road = new THREE.Mesh(roadGeo, roadMat);
road.rotation.x = -Math.PI / 2;
road.position.z = -80;
scene.add(road);

// Grid helper for "cyber" look
const gridHelper = new THREE.GridHelper(200, 100, 0x00ffcc, 0x222222);
gridHelper.position.z = -80;
scene.add(gridHelper);



// ... (previous config and state)

// Improved Car Creation
function createCarMesh(color) {
    const carGroup = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(1.5, 0.5, 3);
    const bodyMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.3,
        metalness: 0.7
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.5;
    carGroup.add(body);

    // Cabin
    const cabinGeo = new THREE.BoxGeometry(1.2, 0.4, 1.5);
    const cabinMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.1,
        metalness: 0.9
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.95, -0.2);
    carGroup.add(cabin);

    // Wheels
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });

    const positions = [
        [-0.8, 0.3, 1], [0.8, 0.3, 1],
        [-0.8, 0.3, -1], [0.8, 0.3, -1]
    ];

    positions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(...pos);
        carGroup.add(wheel);
    });

    // Glow / Headlights for player, Taillights for enemies?
    // Simple Box for light
    if (color === 0x00ffcc) { // Player
        const lightGeo = new THREE.BoxGeometry(0.2, 0.1, 0.1);
        const lightMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        const l1 = new THREE.Mesh(lightGeo, lightMat);
        l1.position.set(-0.5, 0.6, -1.5);
        const l2 = l1.clone();
        l2.position.set(0.5, 0.6, -1.5);
        carGroup.add(l1, l2);
    } else { // Enemy
        const lightGeo = new THREE.BoxGeometry(0.2, 0.1, 0.1);
        const lightMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const l1 = new THREE.Mesh(lightGeo, lightMat);
        l1.position.set(-0.5, 0.6, 1.5);
        const l2 = l1.clone();
        l2.position.set(0.5, 0.6, 1.5);
        carGroup.add(l1, l2);
    }

    // Shadow
    const shadowGeo = new THREE.PlaneGeometry(1.8, 3.2);
    const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.5,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    carGroup.add(shadow);

    return carGroup;
}


// Player Car
const player = createCarMesh(0x00ffcc);
player.position.y = 0; // Group handles internal offset
scene.add(player);

// Obstacles
let obstacles = [];

function createObstacle() {
    const lane = Math.floor(Math.random() * 3) - 1;
    const x = lane * CONFIG.laneWidth;

    const mesh = createCarMesh(0xff0055);

    mesh.position.set(x, 0, -100); // Spawn further away
    scene.add(mesh);

    obstacles.push({
        mesh: mesh,
        active: true,
        lane: lane
    });
}

// Particle System for Speed Effect
const particleCount = 200;
const particleGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount * 3; i++) {
    pPos[i] = (Math.random() - 0.5) * 100;
}
particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
const particleMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.2,
    transparent: true,
    opacity: 0.8
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// ... (Input Handling)

// ... (Loop)
// inside animate(time):
// Move Particles
const positions = particles.geometry.attributes.position.array;
for (let i = 1; i < particleCount * 3; i += 3) { // y is i, z is i+1? no x,y,z -> 0,1,2
    // z is at index i+2 if start at 0.
    // let's iterate by 3
}

// Better particle loop
for (let i = 0; i < particleCount; i++) {
    let z = positions[i * 3 + 2];
    z += 1.0; // speed
    if (z > 20) z = -80;
    positions[i * 3 + 2] = z;
}
particles.geometry.attributes.position.needsUpdate = true;

// ... (rest of collision logic)


// Input Handling
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

// Touch / Mouse Swipe
let startX = 0;
window.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
});

window.addEventListener('touchend', (e) => {
    const endX = e.changedTouches[0].clientX;
    const diff = endX - startX;
    if (Math.abs(diff) > 30) {
        if (diff > 0) handleInput(1);
        else handleInput(-1);
    }
});

// also mouse for testing
window.addEventListener('mousedown', (e) => {
    startX = e.clientX;
});
window.addEventListener('mouseup', (e) => {
    const endX = e.clientX;
    const diff = endX - startX;
    if (Math.abs(diff) > 30) {
        if (diff > 0) handleInput(1);
        else handleInput(-1);
    }
});


// Game Logic
function startGame() {
    state.isPlaying = true;
    state.score = 0;
    state.lane = 0;
    state.targetX = 0;
    state.spawnTimer = 0;

    // reset player
    player.position.x = 0;

    // clear obstacles
    obstacles.forEach(o => scene.remove(o.mesh));
    obstacles = [];

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

// Resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


// Loop
function animate(time) {
    requestAnimationFrame(animate);

    const delta = time - state.lastTime;
    state.lastTime = time;

    if (!state.isPlaying) {
        // Idle animation?
        return;
    }

    // Move Player smoothly
    player.position.x += (state.targetX - player.position.x) * 0.1;
    // Tilt effect
    player.rotation.z = (player.position.x - state.targetX) * 0.1;

    // Particle Animation
    if (particles) {
        const positions = particles.geometry.attributes.position.array;
        for (let i = 0; i < particleCount; i++) {
            let z = positions[i * 3 + 2];
            z += 0.8; // speed
            if (z > 20) z = -80;
            positions[i * 3 + 2] = z;
        }
        particles.geometry.attributes.position.needsUpdate = true;
    }

    // Spawn Obstacles
    if (time > state.spawnTimer) {
        createObstacle();
        state.spawnTimer = time + CONFIG.spawnInterval; // Decrease this over time for difficulty?
    }

    // Move Obstacles
    // Game speed determines how fast they come towards z=0
    // Actually, let's keep player at z=0 and move obstacles +z
    const moveSpeed = 0.5; // units per frame roughly, or use delta

    // Using delta for consistent speed
    // 60fps = 16ms. speed * delta/16
    const dt = delta / 16;

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const ob = obstacles[i];
        ob.mesh.position.z += moveSpeed * dt;

        // Collision
        // Simple AABB
        // Player is width 1.5, depth 3
        // Obstacle is same
        // Check if z overlaps and x overlaps

        const dz = Math.abs(ob.mesh.position.z - player.position.z);
        const dx = Math.abs(ob.mesh.position.x - player.position.x);

        if (dz < 2.5 && dx < 1.2) {
            gameOver();
        }

        // Remove if behind camera
        if (ob.mesh.position.z > 10) {
            scene.remove(ob.mesh);
            obstacles.splice(i, 1);
            state.score += 1;
            dom.score.textContent = `Score: ${state.score}`;

            // Ramp up difficulty?
            // CONFIG.spawnInterval = Math.max(500, CONFIG.spawnInterval - 10);
        }
    }

    // Moving Grid effect (simulate speed)
    // We can just move the grid texture or the grid object

    renderer.render(scene, camera);
}

animate(0);
