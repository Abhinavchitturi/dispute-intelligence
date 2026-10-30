"""People and the oversight records around them: accounts, strikes, manager alerts, flags and the AI review log."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from backend.app.database import Base

INVESTIGATOR, MANAGER, AI_AGENT = "INVESTIGATOR", "MANAGER", "AI_AGENT"


class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True)
    username = Column(String(64), unique=True, nullable=False, index=True)
    display_name = Column(String(128), nullable=False)
    email = Column(String(255), nullable=True)
    role = Column(String(16), nullable=False)                 # INVESTIGATOR or MANAGER
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)                 # a deactivated account can't sign in, but its history stays
    is_blocked = Column(Boolean, default=False)
    blocked_at = Column(DateTime, nullable=True)
    blocked_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Strike(Base):
    """One mark against an investigator, each time the AI reviewer overturns their decision."""
    __tablename__ = "strikes"

    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    dispute_id = Column(String(64), nullable=True, index=True)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    voided_at = Column(DateTime, nullable=True)               # set when a manager finds the investigator was right
    voided_by = Column(String(128), nullable=True)
    void_reason = Column(Text, nullable=True)


class ManagerAlert(Base):
    """Something a manager has to deal with. It stays on top of the screen, and keeps pinging hourly, until it is marked sorted."""
    __tablename__ = "manager_alerts"

    id = Column(String(64), primary_key=True)
    kind = Column(String(24), nullable=False)                 # STRIKES, BLOCKED, FLAG, APPEAL
    user_id = Column(String(64), nullable=True, index=True)   # the investigator it is about
    dispute_id = Column(String(64), nullable=True)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    strike_level = Column(Integer, nullable=True)             # the strike count that opened it
    status = Column(String(12), default="OPEN", index=True)   # OPEN or SORTED
    created_at = Column(DateTime, default=datetime.utcnow)
    last_notified_at = Column(DateTime, default=datetime.utcnow)
    reminder_count = Column(Integer, default=0)
    sorted_by = Column(String(128), nullable=True)
    sorted_at = Column(DateTime, nullable=True)
    sorted_note = Column(Text, nullable=True)


class Notification(Base):
    """A ping for one person. Open alerts add a new one every reminder interval."""
    __tablename__ = "notifications"

    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    alert_id = Column(String(64), nullable=True, index=True)
    kind = Column(String(24), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    dispute_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    read_at = Column(DateTime, nullable=True)


class AIReview(Base):
    """The AI reviewer's verdict on an investigator's decision. Also what a manager's correction is recorded against, as training feedback."""
    __tablename__ = "ai_reviews"

    id = Column(String(64), primary_key=True)
    dispute_id = Column(String(64), nullable=False, index=True)
    investigator_id = Column(String(64), nullable=True)
    proposed_outcome = Column(String(32), nullable=False)     # what the investigator decided
    verdict = Column(String(12), nullable=False)              # APPROVE or OVERTURN
    ai_outcome = Column(String(32), nullable=False)           # the outcome the AI stands behind
    rationale = Column(Text, nullable=False)
    model = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Filled in when a manager overturns the AI. This is the label the AI team trains on.
    correct_outcome = Column(String(32), nullable=True)
    correction_note = Column(Text, nullable=True)
    corrected_by = Column(String(128), nullable=True)
    corrected_at = Column(DateTime, nullable=True)
    correction_source = Column(String(16), nullable=True)     # MANAGER_REVIEW or INVESTIGATOR_FLAG
    exported_at = Column(DateTime, nullable=True)             # when the AI team pulled it


class Flag(Base):
    """An investigator saying the AI got a case wrong, with their reasons."""
    __tablename__ = "case_flags"

    id = Column(String(64), primary_key=True)
    dispute_id = Column(String(64), nullable=False, index=True)
    raised_by = Column(String(64), ForeignKey("users.id"), nullable=False)
    points = Column(Text, nullable=False)
    status = Column(String(12), default="OPEN", index=True)   # OPEN, UPHELD (the AI stands) or OVERTURNED
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_by = Column(String(128), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolution_note = Column(Text, nullable=True)


class Email(Base):
    """Every email the app sends or receives. Sent through SMTP when it is configured, otherwise kept here for the team to read."""
    __tablename__ = "emails"

    id = Column(String(64), primary_key=True)
    dispute_id = Column(String(64), nullable=True, index=True)
    direction = Column(String(8), nullable=False)             # OUT or IN
    to_address = Column(String(255), nullable=False)
    from_address = Column(String(255), nullable=False)
    subject = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    party = Column(String(8), nullable=True)                  # SELLER or BUYER
    status = Column(String(12), default="QUEUED")             # QUEUED (stored only), SENT, FAILED, RECEIVED
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class CaseRequest(Base):
    """An investigator with no cases asking their manager for more."""
    __tablename__ = "case_requests"

    id = Column(String(64), primary_key=True)
    user_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    note = Column(Text, nullable=True)
    status = Column(String(12), default="OPEN", index=True)   # OPEN, FULFILLED or DECLINED
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_by = Column(String(128), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    resolution_note = Column(Text, nullable=True)
    cases_given = Column(Integer, nullable=True)


class CaseCollaborator(Base):
    """A case can be worked by more than one investigator. The owner is `Dispute.assigned_to`; everyone else on it is a row here."""
    __tablename__ = "case_collaborators"

    id = Column(String(64), primary_key=True)
    dispute_id = Column(String(64), ForeignKey("disputes.id"), nullable=False, index=True)
    user_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    added_by = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
