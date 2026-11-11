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
    # In sandbox mode, how often to pull new disputes from PayPal (a buyer's report in the Resolution Center). 0 turns it off.
    PAYPAL_POLL_SECONDS: int = 10
    # PayPal case IDs the automatic sync leaves out (old test cases), comma-separated. Import case still brings one in.
    PAYPAL_HIDDEN_CASES: str = ""
    
    # AI Provider
    AI_PROVIDER: str = "gemini"  # "none", "gemini", "openai", "anthropic"
    AI_API_KEY: Optional[str] = None
    AI_MODEL: str = "gemini-3.5-flash-lite"
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: Optional[str] = "gemini-3.5-flash-lite"
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    
    # Seconds before a simulated seller/buyer reply arrives
    DEMO_REPLY_DELAY_SECONDS: int = 20
    # Sandbox cases too: the seller and buyer are test accounts that never really answer, so their replies are simulated.
    # Turn off to wait for real emailed replies instead.
    SIMULATE_REPLIES: bool = True

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
    AI_AUTO_REVIEW: bool = True                 # the AI reviewer rules by itself on every decision waiting for review
    AI_REVIEW_DELAY_SECONDS: int = 30           # the AI rules the moment a decision is sent. This is only how long the background sweep waits before catching one that was missed
    AUTO_ASSIGN_AFTER_DAYS: float = 1   # a new complaint waits this long for its manager to assign it, then it is given to an investigator at random
    AUTO_ASSIGN_WHEN_DAYS_LEFT: float = 3   # and it never waits once this few days are left, so the investigator isn't squeezed
    PUBLIC_URL: str = "http://localhost:8000"   # where the "open a new case" link in a dismissal email points
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
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://localhost:8001,http://127.0.0.1:8001"

    @property
    def effective_gemini_api_key(self) -> Optional[str]:
        return self.GEMINI_API_KEY or self.AI_API_KEY

    @property
    def effective_gemini_model(self) -> str:
        return self.GEMINI_MODEL or self.AI_MODEL or "gemini-3.5-flash-lite"

    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
