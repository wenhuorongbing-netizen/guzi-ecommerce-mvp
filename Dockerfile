# ==========================================
# Stage 1: Build Next.js Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
# We disable telemetry and build the Next.js static files
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ==========================================
# Stage 2: Python Backend & Final Image
# ==========================================
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies needed for Prisma & Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements
COPY requirements.txt .
# Install python dependencies, bcrypt may require build-essential
RUN pip install --no-cache-dir -r requirements.txt bcrypt pydantic-settings

# Copy backend source
COPY app/ ./app/
COPY schema.prisma .

# Generate Prisma Client (Ensure DATABASE_URL is available or ignore checks if strictly generating types)
RUN prisma generate

# Setup Static Frontend serving (In a pure monolithic setup, FastAPI can serve the out dir)
# Alternatively, deploy frontend to Vercel/CDN and keep this purely for backend.
# Here we simply demonstrate copying the Next.js build if you were using Next export.
# COPY --from=frontend-builder /app/frontend/.next /app/frontend_build

# Expose FastAPI port
EXPOSE 8000

# Start Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
