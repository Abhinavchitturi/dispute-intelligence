import os

# Tests mutate disputes (actions, evidence), so they must never touch the developer's resolveiq.db.
# This has to be set before the app modules import settings.
TEST_DB = "test_resolveiq.db"
if os.path.exists(TEST_DB):
    os.remove(TEST_DB)
os.environ["DATABASE_URL"] = f"sqlite:///./{TEST_DB}"
os.environ["AI_AUTO_REVIEW"] = "false"  # tests that need a decision to wait for review would otherwise be ruled on at once. The ones about the AI turn it on.
os.environ["AUTH_REQUIRED"] = "false"   # most tests are about cases, not sign-in. test_auth.py turns it back on.
os.environ["RESOLVEIQ_MODE"] = "demo"   # tests run on the demo data whatever the developer's .env says. Sandbox tests set it themselves.
os.environ["PAYPAL_CLIENT_ID"] = ""      # and never reach the real PayPal sandbox with the developer's keys: PayPal tests use fakes
os.environ["PAYPAL_CLIENT_SECRET"] = ""
os.environ["AI_PROVIDER"] = "none"       # and use the built-in rules engine, not a live model: AI tests mock the model themselves

import pytest  # noqa: E402

from backend.app.database import Base, SessionLocal, engine  # noqa: E402
from backend.app.models.dispute import Dispute  # noqa: E402
from backend.app.seed.seed_data import seed_database  # noqa: E402
from backend.app.services.accounts import ensure_users  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def seeded_database():
    # Module-level TestClient(app) never runs the app lifespan, so build the schema here.
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_users(db)
        if db.query(Dispute).count() == 0:
            seed_database(db)
    finally:
        db.close()
    yield
    engine.dispose()
    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)


@pytest.fixture(scope="module")
def fresh_demo_data():
    """Modules that change case state start from freshly seeded demo data, so they can't affect each other."""
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
