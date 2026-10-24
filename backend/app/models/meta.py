from sqlalchemy import Column, String
from backend.app.database import Base


class AppMeta(Base):
    """Small key/value table for app-level facts, e.g. which version of the demo data is loaded."""
    __tablename__ = "app_meta"

    key = Column(String(64), primary_key=True)
    value = Column(String(255), nullable=False)
