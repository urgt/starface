FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    # Playwright Chromium runtime deps (Debian bookworm). `playwright install --with-deps`
    # targets Ubuntu package names (ttf-ubuntu-font-family, ttf-unifont) that don't exist on
    # Debian slim, so we install the equivalents explicitly.
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    fonts-liberation \
    fonts-unifont \
    ca-certificates \
    # Tesseract OCR — used to reject images with large text overlays
    # (news-banner thumbnails, video title cards, watermarked media).
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Chromium browser binaries (OS deps installed above).
RUN playwright install chromium

COPY app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
