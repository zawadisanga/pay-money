from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.middlewares.rate_limit import RateLimitMiddleware
from app.middlewares.license_check import LicenseMiddleware
from app.api import auth, wallet, transactions, external, admin
from app.utils.db import engine, Base

app = FastAPI(title="Global Money System", version="1.0.0")

# CORS (strict)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend-domain.com"],  # change in production
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

# Rate limiting
app.add_middleware(RateLimitMiddleware)

# License enforcement
app.add_middleware(LicenseMiddleware)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(wallet.router, prefix="/api/wallet", tags=["wallet"])
app.include_router(transactions.router, prefix="/api/transactions", tags=["transactions"])
app.include_router(external.router, prefix="/api/external", tags=["external"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])

@app.on_event("startup")
async def startup():
    # Create tables (use Alembic in production)
    Base.metadata.create_all(bind=engine)


# app/main.py au alembic seed
def create_platform_user():
    db = SessionLocal()
    platform_user = db.query(User).filter(User.email == "platform@money.com").first()
    if not platform_user:
        platform_user = User(
            email="platform@money.com",
            hashed_password=get_password_hash("some_strong_password"),
            full_name="Platform Revenue",
            is_active=True
        )
        db.add(platform_user)
        db.commit()
        db.refresh(platform_user)
        # Hakikisha unahifadhi ID yake kwa kutumia variable ya mazingira au constant
        settings.PLATFORM_USER_ID = str(platform_user.id)
    db.close()
