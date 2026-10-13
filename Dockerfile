# Backend image for the hosted demo (Hugging Face Spaces, Render, Fly.io, ...).
# The UI is also built in, so `docker run -p 7860:7860` gives a complete app;
# on Cloudflare Pages the UI is served from Pages instead and this serves /api.

# ---- web UI
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- API
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.cache/huggingface \
    CODECOPILOT_PUBLIC_MODE=1 \
    CODECOPILOT_REPOS_DIR=/tmp/codecopilot-repos \
    PORT=7860

RUN useradd -m -u 1000 app
WORKDIR /app

# CPU-only torch first, so sentence-transformers doesn't pull multi-GB CUDA wheels.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt

# Bake the embedding model into the image: no download (or HF Hub rate limit) at startup.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY *.py ./
COPY prompts/ prompts/
COPY --from=web /web/dist web/dist
RUN chown -R app:app /app
USER app

EXPOSE 7860
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
