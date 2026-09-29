# ReelSmith worker: faster-whisper transcription + ffmpeg renders.
# Build from the repo root:  docker build -f worker/Dockerfile .
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/requirements.txt worker/requirements.txt
RUN pip install --no-cache-dir -r worker/requirements.txt

COPY worker/ worker/
# Same TTFs the browser preview uses, so captions/text render identically.
COPY public/fonts public/fonts
COPY public/sample public/sample

ENV PYTHONUNBUFFERED=1 \
    FONTS_DIR=/app/public/fonts \
    PUBLIC_DIR=/app/public \
    FFMPEG_BIN=/usr/bin/ffmpeg \
    WHISPER_MODEL=base

# Optional: bake the whisper model into the image (faster cold starts):
#   docker build --build-arg PRELOAD_MODEL=1 -f worker/Dockerfile .
ARG PRELOAD_MODEL=0
RUN if [ "$PRELOAD_MODEL" = "1" ]; then HF_HUB_DISABLE_IMPLICIT_TOKEN=1 python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"; fi

CMD ["python", "worker/main.py"]
