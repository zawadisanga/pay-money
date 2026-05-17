from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    # Database
    DATABASE_URL: str

    # Redis
    REDIS_URL: str

    # JWT
    JWT_SECRET_KEY: str
    JWT_REFRESH_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Encryption
    ENCRYPTION_KEY: bytes  # base64 decoded

    # License
    LICENSE_SERVER_URL: Optional[str] = None

    # External providers (stubs)
    STRIPE_SECRET_KEY: Optional[str] = None
    PAYPAL_CLIENT_ID: Optional[str] = None
    PAYPAL_SECRET: Optional[str] = None
    MPESA_CONSUMER_KEY: Optional[str] = None
    MPESA_CONSUMER_SECRET: Optional[str] = None

    # Exchange rate
    EXCHANGE_RATE_API_KEY: Optional[str] = None
    EXCHANGE_RATE_API_URL: str = "https://api.exchangerate.host/latest"

    class Config:
        env_file = ".env"

settings = Settings()
