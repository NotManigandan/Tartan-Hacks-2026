import os
from dotenv import load_dotenv

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

if not GOOGLE_API_KEY:
    print("WARNING: GOOGLE_API_KEY not set")

