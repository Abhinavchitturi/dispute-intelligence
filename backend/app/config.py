from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
import os

class Settings(BaseSettings):
    RESOLVEIQ_MODE: str = "demo"  # "demo" or "sandbox"
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = True
    DATABASE_URL: str = "sqlite:///./resolveiq.db"
    
    # PayPal Sandbox
    PAYPAL_ENV: str = "sandbox"
    PAYPAL_BASE_URL: str = "https://api-m.sandbox.paypal.com"
    PAYPAL_CLIENT_ID: Optional[str] = None
    PAYPAL_CLIENT_SECRET: Optional[str] = None
    PAYPAL_WEBHOOK_ID: Optional[str] = None
    
    # AI Provider
    AI_PROVIDER: str = "none"  # "none", "gemini", "openai", "anthropic"
    AI_API_KEY: Optional[str] = None
    AI_MODEL: str = "gemini-1.5-pro"
    
    # Demo mode: seconds before a simulated PayPal/buyer reply arrives
    DEMO_REPLY_DELAY_SECONDS: int = 20

    # Security
    SECRET_KEY: str = "resolveiq-hackathon-local-secret-key-38912"
    AUTH_REQUIRED: bool = True            # tests switch this off; everything else requires a signed-in user
    TOKEN_TTL_HOURS: int = 12
    # The AI reviewer is built elsewhere. It calls /api/ai-agent/* with this key. Unset means those endpoints refuse everyone.
    AI_AGENT_API_KEY: Optional[str] = None
    # Webhook secret for the mail provider that forwards replies to the appeals address.
    INBOUND_MAIL_SECRET: Optional[str] = None

    # Oversight rules
    STRIKE_NOTIFY_THRESHOLD: int = 3      # every this many strikes, the manager is alerted
    STRIKE_BLOCK_THRESHOLD: int = 10      # at this many strikes the account is blocked until a manager unblocks it
    ALERT_REMINDER_MINUTES: int = 60      # an open alert pings the manager again this often until it is sorted

    # Every case has this long to be dealt with. The priority score climbs as the deadline closes in, and a case nobody has taken
    # by its deadline is handed to the AI Agent to handle from start to finish.
    CASE_WINDOW_DAYS: int = 5
    AI_AGENT_NAME: str = "AI Agent"

    # High-profile cases go to the manager: any case for this much money or more. (Price only. A score keeps changing.)
    HIGH_PROFILE_AMOUNT: float = 1000.0

    # Email. With no SMTP host, emails are stored (and readable in the app) instead of being sent.
    APPEALS_EMAIL: str = "appeals@resolveiq.example"
    MAIL_FROM: str = "disputes@resolveiq.example"
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000"

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
