from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.db import connect_db, disconnect_db
from app.api import inventory, products, vision, parser

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect to the database on startup
    await connect_db()
    yield
    # Disconnect from the database on shutdown
    await disconnect_db()

app = FastAPI(title="Guzi E-Commerce MVP", lifespan=lifespan)

# Adding CORS for MVP frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(products.router, prefix="/api/products", tags=["products"])
app.include_router(vision.router, prefix="/api/vision", tags=["vision"])
app.include_router(parser.router, prefix="/api/parser", tags=["parser"])
app.include_router(inventory.router, prefix="/api/inventory", tags=["inventory"])

@app.get("/health")
async def health_check():
    return {"status": "ok"}
