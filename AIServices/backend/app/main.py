"""
FastAPI Main Application
Module 2: Automated Skill Extraction (CV Parsing)
"""

import logging
import re
import uuid
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from app.config.settings import settings
from app.config.database import connect_to_mongo, close_mongo_connection
from app.routes.cv_routes import router as cv_router
from app.routes.internal_routes import router as internal_router
from app.middleware.auth import register_auth_error_handler
from app.middleware.validation import register_validation_error_handler
from app.routes.internal_logs_routes import router as internal_logs_router
from app.services.error_logger import is_db_connection_error, log_error, request_context

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# Lifespan context manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context manager
    Handles startup and shutdown events
    """
    # Startup
    logger.info("🚀 Starting up MUQAYYIM CV Parsing Module...")
    await connect_to_mongo()
    logger.info("✓ Application started successfully")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down application...")
    await close_mongo_connection()
    logger.info("✓ Application shut down successfully")


# Create FastAPI application
app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    description="Module 2: Automated Skill Extraction (CV Parsing) for MUQAYYIM",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add trusted host middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["localhost", "127.0.0.1", "*.example.com"]
)


# Request correlation id: the API Gateway sets X-Request-Id; a valid incoming
# id is kept, otherwise one is generated. Available as request.state.request_id
# and echoed on every response.
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{7,63}$")


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    incoming = request.headers.get("x-request-id")
    request_id = incoming if incoming and _VALID_REQUEST_ID.match(incoming) else str(uuid.uuid4())
    request.state.request_id = request_id
    # Context for error-log entries written while handling this request.
    request_context.set({"request_id": request_id, "method": request.method, "path": request.url.path})
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


# Auth failures → { success, code, message } (same codes as CoreServices)
register_auth_error_handler(app)

# Request validation → 422 { success, code: VALIDATION_ERROR, message, errors[] }
register_validation_error_handler(app)


# Global exception handler: log, then a clean 500 with a reference request ID.
# Never sends the exception text or a traceback to the client.
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    logger.error("Unhandled exception (%s) rid=%s", type(exc).__name__, request_id)
    task = log_error(
        level="critical" if is_db_connection_error(exc) else "error",
        module="unhandled",
        exc=exc,
        status_code=500,
        request_id=request_id,
        method=request.method,
        path=request.url.path,
    )
    del task  # fire-and-forget
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "code": "INTERNAL_ERROR",
            "message": f"Something went wrong. Reference: {request_id}",
            "requestId": request_id,
        },
        headers={"X-Request-Id": request_id},
    )


# Include routers
app.include_router(cv_router)
app.include_router(internal_router)  # service-to-service, X-Internal-Key
app.include_router(internal_logs_router)  # admin log view, via CoreServices


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Welcome to MUQAYYIM CV Parsing Module",
        "version": settings.API_VERSION,
        "docs": "/docs"
    }


# Health check
@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "CV Parsing Module",
        "version": settings.API_VERSION
    }


# Startup event
@app.on_event("startup")
async def startup():
    """Application startup"""
    logger.info("Application startup event triggered")


# Shutdown event
@app.on_event("shutdown")
async def shutdown():
    """Application shutdown"""
    logger.info("Application shutdown event triggered")


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    )
