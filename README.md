# Neon Racer (Tartan Hacks 2026)

A high-speed, procedural dodging game built with **Raw WebGL**. No engines, no libraries, just pure code.

## 🚀 Quick Start

### Install Dependencies
```bash
npm install
```

## 📦 Build & Deploy

To create a production build and run it using the startup script:

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Package the distribution** (Optional compression):
   ```bash
   tar -czvf dist.tar.gz dist/
   ```

3. **Run the application**:
   ```bash
   chmod +x start.sh
   ./start.sh dist.tar.gz
   ```

## 🛠 Tech Stack
- **Raw WebGL2**: Custom rendering engine (Shaders, Buffers).
- **Web Audio API**: Procedural music and SFX.
- **Vite**: Build tooling.
- **Zero Dependencies**: (Runtime) - The final build is `< 15kB`.

