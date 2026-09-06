FROM python:3.10-slim

WORKDIR /app

# System libraries OpenCV needs at runtime (headless build still needs these)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY src/ ./src/
COPY models/ ./models/

# Hugging Face Spaces (Docker SDK) expects the app to listen on 7860
ENV PORT=7860
EXPOSE 7860

CMD ["python", "app/server.py"]
