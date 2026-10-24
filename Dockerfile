# ResolveIQ Multi-Stage Production / Demo Dockerfile
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS final
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    RESOLVEIQ_MODE=demo

# Install backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy application files
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY .env.example .env

# Expose API and frontend port
EXPOSE 8000

# Seed initial database and start FastAPI server with Uvicorn
CMD ["sh", "-c", "python -m backend.app.seed.seed_data && uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"]
