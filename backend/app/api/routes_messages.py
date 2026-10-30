from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.models.message import DisputeMessage
from backend.app.models.team import User
from backend.app.schemas.audit import DeclareRequest
from backend.app.schemas.messages import MessageSchema, ThreadSummary
from backend.app.services import appeal_service, email_service, reply_service
from backend.app.services.auth_service import actor_name, case_scope, case_user
from backend.app.services.decision_service import DecisionError, DecisionService
from backend.app.services.message_service import MessageService

router = APIRouter(tags=["Messages"], dependencies=[Depends(case_user), Depends(case_scope)])


@router.get("/message-threads", response_model=List[ThreadSummary])
def list_message_threads(user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """One row per dispute that has messages: who we're waiting on, or whether it's our turn."""
    return MessageService.list_threads(db, user)


@router.get("/disputes/{dispute_id}/messages", response_model=List[MessageSchema])
def get_dispute_messages(dispute_id: str, db: Session = Depends(get_db)):
    if not db.query(Dispute).filter(Dispute.id == dispute_id).first():
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    MessageService.deliver_due(db, dispute_id)
    return db.query(DisputeMessage).filter(DisputeMessage.dispute_id == dispute_id).order_by(DisputeMessage.created_at).all()


@router.post("/disputes/{dispute_id}/messages/read")
def mark_messages_read(dispute_id: str, db: Session = Depends(get_db)):
    n = (
        db.query(DisputeMessage)
        .filter(DisputeMessage.dispute_id == dispute_id, DisputeMessage.direction == "INBOUND", DisputeMessage.is_read.is_(False))
        .update({"is_read": True})
    )
    db.commit()
    return {"marked_read": n}


@router.post("/messages/{message_id}/simulate-reply", response_model=MessageSchema)
def simulate_reply_now(message_id: str, db: Session = Depends(get_db)):
    """Demo only: skip the wait and deliver the reply to a message right now."""
    msg = db.query(DisputeMessage).filter(DisputeMessage.id == message_id).first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found.")
    if settings.RESOLVEIQ_MODE != "demo" or msg.source != "synthetic":
        raise HTTPException(status_code=400, detail="Replies can only be simulated for demo messages. Real replies come from the seller or buyer through PayPal.")
    if not msg.awaiting_reply:
        raise HTTPException(status_code=400, detail="This message has already been answered.")
    reply = MessageService.deliver_reply(db, msg)
    return reply


@router.post("/disputes/{dispute_id}/parties/{party}/declare", response_model=MessageSchema)
def declare_from_party(dispute_id: str, party: str, request: DeclareRequest, db: Session = Depends(get_db)):
    """Demo only: the seller or buyer says the dispute is settled outside PayPal, or the buyer withdraws.

    Settled needs BOTH sides. Withdrawn (buyer only) dismisses the case."""
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    if settings.RESOLVEIQ_MODE != "demo" or dispute.source != "synthetic":
        raise HTTPException(status_code=400, detail="This can only be simulated on demo cases. Real parties tell PayPal themselves.")
    try:
        return DecisionService.declare(db, dispute, party.upper(), request.kind.upper())
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))


class SimulatedEmailReply(BaseModel):
    party: str                       # SELLER or BUYER
    body: str = "Hello, please find the documents attached."
    attachments: List[str] = []


@router.post("/disputes/{dispute_id}/inbound/simulate")
def simulate_email_reply(dispute_id: str, request: SimulatedEmailReply, db: Session = Depends(get_db)):
    """Demo only: the seller or buyer answers a request by email. It arrives on the case, and someone has to record what came with it."""
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    if settings.RESOLVEIQ_MODE != "demo":
        raise HTTPException(status_code=400, detail="Only available in demo mode. Real replies arrive at the disputes mailbox.")
    party = request.party.upper()
    if party not in ("SELLER", "BUYER"):
        raise HTTPException(status_code=400, detail="Party must be SELLER or BUYER.")
    sender = email_service.seller_address(d) if party == "SELLER" else email_service.buyer_address(d)
    return appeal_service.handle_inbound(db, sender, settings.MAIL_FROM, f"Re: [{d.id}] Evidence request", request.body, request.attachments)


class RecordedItem(BaseModel):
    evidence_type: str
    file_name: Optional[str] = None
    description: Optional[str] = None


class RecordReply(BaseModel):
    provided: List[RecordedItem] = []
    note: Optional[str] = None


@router.post("/disputes/{dispute_id}/replies/{message_id}/record", response_model=MessageSchema)
def record_reply(dispute_id: str, message_id: str, request: RecordReply, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """Someone at PayPal goes through an emailed reply and says which of the requested documents came with it."""
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    try:
        return reply_service.record_reply(db, d, message_id, [i.model_dump() for i in request.provided], request.note, actor_name(user, "investigator_user"))
    except reply_service.ReplyError as e:
        raise HTTPException(status_code=400, detail=str(e))
