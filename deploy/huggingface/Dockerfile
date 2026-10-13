# Hugging Face Space wrapper: builds the backend straight from the GitHub repo,
# so the Space repo only needs this file and README.md (with the Space config).
FROM alpine/git AS src
ARG REPO=https://github.com/khushi0101/Codebase-Intelligent-Copilot.git
ARG REF=main
RUN git clone --depth 1 --branch ${REF} ${REPO} /src

FROM node:22-slim AS web
WORKDIR /web
COPY --from=src /src/web/package.json /src/web/package-lock.json ./
RUN npm ci
COPY --from=src /src/web/ ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.cache/huggingface \
    CODECOPILOT_PUBLIC_MODE=1 \
    CODECOPILOT_REPOS_DIR=/tmp/codecopilot-repos \
    PORT=7860
RUN useradd -m -u 1000 app
WORKDIR /app
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY --from=src /src/pyproject.toml ./
RUN python -c "import tomllib; print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
    && pip install -r /tmp/requirements.txt
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
COPY --from=src /src/*.py ./
COPY --from=src /src/prompts/ prompts/
COPY --from=web /web/dist web/dist
RUN chown -R app:app /app
USER app
EXPOSE 7860
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT} --proxy-headers"]
