from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.api.translate import router as translate_router

app = FastAPI(title="TartanHacks Python Backend")

# ---------------- CORS ----------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- PATH RESOLUTION ----------------
CURRENT_FILE = os.path.abspath(__file__)
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(CURRENT_FILE)))
PUBLIC_DIR = os.path.join(REPO_ROOT, "public")
INDEX_FILE = os.path.join(PUBLIC_DIR, "index.html")

print("Repo root:", REPO_ROOT)
print("Public dir:", PUBLIC_DIR)
print("Public exists:", os.path.isdir(PUBLIC_DIR))

# ---------------- API ROUTES ----------------
@app.get("/health")
def health():
    return {"status": "ok"}

# Register API routers
app.include_router(translate_router)

# ---------------- FRONTEND ROUTES ----------------
@app.get("/")
def serve_index():
    return FileResponse(INDEX_FILE)

# Serve static assets (JS, CSS)
if os.path.isdir(PUBLIC_DIR):
    app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")

