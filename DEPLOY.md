# Deployment Guide (MVP)

This repository contains the Guzi E-Commerce Proxy MVP.

## 1-Click Startup

Ensure you have Docker and Docker Compose installed.

1. Export your OpenAI key:
   ```bash
   export OPENAI_API_KEY="sk-xxxx"
   ```
2. Start the entire stack (Postgres, Redis, API):
   ```bash
   docker-compose up --build -d
   ```

## What Happens Automatically?
* **PostgreSQL** starts on port `5432`.
* **Redis** starts on port `6379`.
* The **FastAPI Backend** starts on port `8000` (http://localhost:8000).
* Prisma automatically syncs the database schema (`prisma db push`).
* The system boots an initial Admin account (`SuperAdmin` / `123456`).

## Frontend Dev
For the Next.js frontend, run locally against the dockerized backend:
```bash
npm install
npm run dev
```