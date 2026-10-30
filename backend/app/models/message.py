import json
from typing import List, Optional
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from backend.app.database import Base


class DisputeMessage(Base):
    """One message in a dispute's conversation: what the investigator sent, and what came back."""
    __tablename__ = "dispute_messages"

    id = Column(String(64), primary_key=True, index=True)
    dispute_id = Column(String(64), ForeignKey("disputes.id"), nullable=False, index=True)
    direction = Column(String(16), nullable=False)       # "OUTBOUND" (PayPal sent) or "INBOUND" (a reply)
    counterparty = Column(String(16), nullable=False)    # the other party: "SELLER" or "BUYER"
    action_type = Column(String(64), nullable=True)      # the action that produced an outbound message
    subject = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    source = Column(String(32), default="synthetic")     # "synthetic" (simulated) or "paypal_sandbox"
    awaiting_reply = Column(Boolean, default=False)      # outbound only: still waiting to hear back
    reply_due_at = Column(DateTime, nullable=True)       # demo only: when the simulated reply lands
    in_reply_to = Column(String(64), nullable=True)      # inbound only: the outbound message it answers
    is_read = Column(Boolean, default=True)              # inbound only: False until the investigator opens it
    audit_event_id = Column(String(64), nullable=True)
    # outbound request: {"requested_evidence": [...], "deadline": iso}; inbound reply: {"provided_evidence": [...], "unable_to_provide": [...]}
    meta_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    dispute = relationship("Dispute", back_populates="messages")

    def _meta(self) -> dict:
        try:
            return json.loads(self.meta_json) if self.meta_json else {}
        except ValueError:
            return {}

    @property
    def emailed_to(self) -> Optional[str]:        # outbound request: the address we emailed
        return self._meta().get("emailed_to")

    @property
    def email_status(self) -> Optional[str]:      # QUEUED (kept here, not sent), SENT or FAILED
        return self._meta().get("email_status")

    @property
    def needs_recording(self) -> bool:            # an emailed reply that nobody has gone through yet
        return bool(self._meta().get("needs_recording"))

    @property
    def attachments(self) -> List[str]:           # names of the files that came with an emailed reply
        return list(self._meta().get("attachments", []))

    @property
    def requested_evidence(self) -> List[str]:    # outbound request: what PayPal asked for
        return list(self._meta().get("requested_evidence", []))

    @property
    def provided_evidence(self) -> List[str]:     # inbound reply: what they sent
        return list(self._meta().get("provided_evidence", []))

    @property
    def unavailable_evidence(self) -> List[str]:  # inbound reply: what they couldn't provide
        return list(self._meta().get("unable_to_provide", []))

    @property
    def deadline(self) -> Optional[str]:          # outbound request: reply-by date
        return self._meta().get("deadline")
