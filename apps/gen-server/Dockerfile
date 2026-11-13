# CPU image with the test engine only (no GPU, no model weights). For local stacks and CI.
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV GEN_ENGINE=test GEN_DATA_DIR=/tmp/gen
USER nobody
EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
