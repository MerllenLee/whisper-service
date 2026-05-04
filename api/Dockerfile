FROM python:3.11.9-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash appuser

WORKDIR /app

COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/app/ app/
COPY api/data/ data/

RUN mkdir -p /home/appuser/.cache/huggingface && chown -R appuser:appuser /home/appuser/.cache && chown -R appuser:appuser /app

USER appuser

ENV HF_HOME=/home/appuser/.cache/huggingface

# Build 時預載模型到 image，部署不需要網路、冷啟動秒開
# 使用 huggingface_hub.snapshot_download 僅下載檔案不載入到記憶體，避免 build OOM
ARG STREAM_MODEL=phate334/Breeze-ASR-25-ct2
ARG EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
ARG HF_TOKEN

RUN python -c "from huggingface_hub import snapshot_download; \
    snapshot_download('${STREAM_MODEL}', token='${HF_TOKEN}'); \
    snapshot_download('${EMBEDDING_MODEL}', token='${HF_TOKEN}')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
