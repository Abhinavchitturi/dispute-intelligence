"""Everything above the investigator: manager alerts, the team, flags, the AI reviewer's hook, emails and appeals."""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.models.team import AIReview, Email, Flag, INVESTIGATOR, MANAGER, ManagerAlert, Notification, Strike, User
from backend.app.services import appeal_service, auth_service, evidence_summary
from backend.app.services.auth_service import actor_name, case_scope, case_user, current_user, manager_user, require_ai_agent
from backend.app.services.claim_service import extract as extract_claims
from backend.app.services.decision_service import DecisionError, DecisionService
from backend.app.services.draft_service import DraftService
from backend.app.services.message_service import PENDING_REVIEW
from backend.app.services.strike_service import StrikeService

router = APIRouter(tags=["Oversight"], dependencies=[Depends(case_scope)])


def _dispute(db: Session, dispute_id: str) -> Dispute:
    d = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not d:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    return d


def _sandbox(d: Dispute) -> bool:
    return settings.RESOLVEIQ_MODE == "sandbox" and d.source == "paypal_sandbox"


def _alert(a: ManagerAlert) -> dict:
    return {"id": a.id, "kind": a.kind, "user_id": a.user_id, "dispute_id": a.dispute_id, "title": a.title, "body": a.body, "strike_level": a.strike_level,
            "status": a.status, "created_at": a.created_at, "last_notified_at": a.last_notified_at, "reminder_count": a.reminder_count,
            "sorted_by": a.sorted_by, "sorted_at": a.sorted_at, "sorted_note": a.sorted_note}


# ---------- notifications and alerts ----------
@router.get("/notifications")
def notifications(user: Optional[User] = Depends(current_user), db: Session = Depends(get_db)):
    """The bell. Managers also get every open alert, which stays pinned on top until it is marked sorted."""
    if user is None:
        return {"unread": 0, "items": [], "open_alerts": []}
    items = db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(30).all()
    unread = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).count()
    alerts = []
    if user.role == MANAGER:
        alerts = [_alert(a) for a in db.query(ManagerAlert).filter(ManagerAlert.status == "OPEN").order_by(ManagerAlert.created_at.desc()).all()]
    return {"unread": unread, "open_alerts": alerts, "items": [
        {"id": n.id, "alert_id": n.alert_id, "kind": n.kind, "title": n.title, "body": n.body, "dispute_id": n.dispute_id, "created_at": n.created_at, "read": n.read_at is not None}
        for n in items]}


@router.post("/notifications/read")
def mark_read(user: Optional[User] = Depends(current_user), db: Session = Depends(get_db)):
    n = 0
    if user:
        n = db.query(Notification).filter(Notification.user_id == user.id, Notification.read_at.is_(None)).update({"read_at": datetime.utcnow()})
        db.commit()
    return {"marked_read": n}


class SortRequest(BaseModel):
    note: Optional[str] = None


@router.get("/alerts")
def alerts(status: Optional[str] = None, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    q = db.query(ManagerAlert)
    if status:
        q = q.filter(ManagerAlert.status == status.upper())
    return [_alert(a) for a in q.order_by(ManagerAlert.created_at.desc()).limit(100).all()]


@router.post("/alerts/{alert_id}/sorted")
def sort_alert(alert_id: str, request: SortRequest, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """The manager presses "Sorted". The pinned alert goes away and the hourly reminders stop."""
    alert = db.get(ManagerAlert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    return _alert(StrikeService.sort_alert(db, alert, actor_name(user, "manager"), request.note))


@router.post("/alerts/remind-now")
def remind_now(user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """Runs the hourly reminder check now. The server also runs it on a timer."""
    return {"reminders_sent": StrikeService.remind_due(db)}


# ---------- the team ----------
@router.get("/team")
def team(user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    people = db.query(User).filter(User.role == INVESTIGATOR).order_by(User.display_name).all()
    out = []
    for p in people:
        history = StrikeService.history(db, p.id)
        out.append({
            "id": p.id, "name": p.display_name, "username": p.username, "is_blocked": p.is_blocked, "blocked_reason": p.blocked_reason,
            "strikes": StrikeService.active_strikes(db, p.id), "notify_at": StrikeService.notify_threshold(), "block_at": StrikeService.block_threshold(),
            "open_cases": db.query(Dispute).filter(Dispute.assigned_to == p.display_name, Dispute.status.notin_(["RESOLVED", "CLOSED"])).count(),
            "history": [{"dispute_id": s.dispute_id, "reason": s.reason, "created_at": s.created_at, "voided": s.voided_at is not None, "void_reason": s.void_reason} for s in history],
        })
    return out


@router.post("/team/{user_id}/unblock")
def unblock(user_id: str, request: SortRequest, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target or target.role != INVESTIGATOR:
        raise HTTPException(status_code=404, detail="Investigator not found.")
    if not target.is_blocked:
        raise HTTPException(status_code=400, detail="This account isn't blocked.")
    StrikeService.unblock(db, target, actor_name(user, "manager"), request.note)
    return {"success": True, "user_id": target.id, "is_blocked": False}


# ---------- the AI reviewer's hook (the agent itself is built elsewhere) ----------
class VerdictRequest(BaseModel):
    verdict: str                      # APPROVE or OVERTURN
    outcome: Optional[str] = None     # required for OVERTURN: the opposite of the investigator's
    rationale: str
    model: Optional[str] = None


def _case_for_ai(db: Session, d: Dispute) -> dict:
    return {
        "dispute_id": d.id, "reason": d.reason, "amount": d.amount, "currency": d.currency, "buyer_claim": d.buyer_claim,
        "proposed_outcome": d.proposed_outcome, "proposed_reason": d.proposed_reason, "proposed_by": d.proposed_by, "proposed_at": d.proposed_at,
        "claim_points": [p.model_dump() for p in extract_claims(d)], "evidence": evidence_summary.build(d),
        "messages": [{"party": m.counterparty, "direction": m.direction, "subject": m.subject, "body": m.body, "created_at": m.created_at} for m in d.messages],
        "appeal_of": d.parent_dispute_id,
    }


async def _apply_verdict(db: Session, d: Dispute, request: VerdictRequest, model: Optional[str]):
    final = d.proposed_outcome if request.verdict.upper() == "APPROVE" else request.outcome
    action_type = "DECIDE_FOR_BUYER" if final == "BUYER_FAVOR" else "DECIDE_FOR_SELLER"
    draft = await DraftService.generate(d, action_type, None, None)
    body = f"{draft.body}\n\nREVIEW\n- {request.rationale.strip()}"
    try:
        return DecisionService.ai_verdict(db, d, request.verdict, request.outcome, request.rationale, model, draft.subject, body, _sandbox(d))
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/ai-agent/queue", dependencies=[Depends(require_ai_agent)])
def ai_queue(db: Session = Depends(get_db)):
    """Cases waiting for the AI reviewer, oldest first, with everything it needs to rule."""
    waiting = db.query(Dispute).filter(Dispute.status == PENDING_REVIEW).order_by(Dispute.proposed_at).all()
    return [_case_for_ai(db, d) for d in waiting]


def _owned_case(db: Session, dispute_id: str) -> Dispute:
    d = _dispute(db, dispute_id)
    if not d.ai_owned:
        raise HTTPException(status_code=400, detail="This case isn't with the AI Agent.")
    return d


@router.get("/ai-agent/owned", dependencies=[Depends(require_ai_agent)])
def ai_owned(db: Session = Depends(get_db)):
    """The cases nobody took before their deadline, which the AI Agent handles from start to finish. Each comes with the same context as a review."""
    from backend.app.services.message_service import OPEN_STATUSES
    cases = db.query(Dispute).filter(Dispute.ai_owned.is_(True), Dispute.status.in_(OPEN_STATUSES)).order_by(Dispute.response_due_date).all()
    return [{**_case_for_ai(db, d), "status": d.status, "response_due_date": d.response_due_date, "handed_over_at": d.ai_owned_at, "priority_score": d.priority_score} for d in cases]


class AIEvidenceRequest(BaseModel):
    party: str                        # SELLER or BUYER
    evidence_types: List[str]
    message: str
    subject: Optional[str] = None
    deadline_days: int = 3


@router.post("/ai-agent/cases/{dispute_id}/request-evidence", dependencies=[Depends(require_ai_agent)])
def ai_request_evidence(dispute_id: str, request: AIEvidenceRequest, db: Session = Depends(get_db)):
    """The AI Agent asks the seller or the buyer for evidence on a case it owns. The case then waits for their reply, as with an investigator."""
    from backend.app.services import evidence_catalog as cat
    from backend.app.services.audit_service import AuditService
    from backend.app.services.message_service import CLOSED, MessageService
    d = _owned_case(db, dispute_id)
    if d.status in CLOSED:
        raise HTTPException(status_code=400, detail=f"This dispute is already {d.status.lower()}.")
    party = request.party.upper()
    allowed = cat.SELLER_ITEMS if party == cat.SELLER else cat.BUYER_ITEMS if party == cat.BUYER else None
    if allowed is None:
        raise HTTPException(status_code=400, detail="Party must be SELLER or BUYER.")
    items = list(dict.fromkeys(request.evidence_types))
    unknown = [t for t in items if t not in allowed]
    if not items or unknown:
        raise HTTPException(status_code=400, detail=f"Ask for at least one item the {party.lower()} can be asked for. Not allowed: {', '.join(unknown) or 'none given'}.")
    action = "REQUEST_SELLER_EVIDENCE" if party == cat.SELLER else "REQUEST_BUYER_EVIDENCE"
    audit = AuditService.record_event(db=db, dispute_id=d.id, actor=settings.AI_AGENT_NAME, action=action, status="SUCCESS", source=d.source,
                                      request_reference=f"REQ-{d.id}", result_summary=f"Asked the {party.lower()} for: {', '.join(cat.label(t) for t in items)}.")
    msg = MessageService.record_request(db, d, action, request.message, request.subject, items, request.deadline_days, audit_event_id=audit.id, sandbox=_sandbox(d))
    return {"success": True, "message_id": msg.id, "status": d.status}


class AIDecision(BaseModel):
    outcome: str
    rationale: str
    model: Optional[str] = None


@router.post("/ai-agent/cases/{dispute_id}/decide", dependencies=[Depends(require_ai_agent)])
async def ai_decide(dispute_id: str, request: AIDecision, db: Session = Depends(get_db)):
    """The AI Agent decides a case it owns. It is final, tells the seller and the buyer, and a manager can overturn it."""
    d = _owned_case(db, dispute_id)
    action_type = "DECIDE_FOR_BUYER" if request.outcome == "BUYER_FAVOR" else "DECIDE_FOR_SELLER"
    draft = await DraftService.generate(d, action_type, None, None)
    body = f"{draft.body}\n\nREVIEW\n- {request.rationale.strip()}"
    try:
        review = DecisionService.ai_direct(db, d, request.outcome, request.rationale, request.model, draft.subject, body, _sandbox(d))
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "dispute_id": d.id, "status": d.status, "outcome": d.outcome, "review_id": review.id}


@router.get("/ai-agent/cases/{dispute_id}", dependencies=[Depends(require_ai_agent)])
def ai_case(dispute_id: str, db: Session = Depends(get_db)):
    return _case_for_ai(db, _dispute(db, dispute_id))


@router.post("/ai-agent/cases/{dispute_id}/verdict", dependencies=[Depends(require_ai_agent)])
async def ai_verdict(dispute_id: str, request: VerdictRequest, db: Session = Depends(get_db)):
    d = _dispute(db, dispute_id)
    review = await _apply_verdict(db, d, request, request.model)
    return {"success": True, "dispute_id": d.id, "status": d.status, "outcome": d.outcome, "review_id": review.id}


def _feedback(db: Session, only_new: bool) -> List[dict]:
    q = db.query(AIReview).filter(AIReview.correct_outcome.isnot(None))
    if only_new:
        q = q.filter(AIReview.exported_at.is_(None))
    rows = q.order_by(AIReview.corrected_at).all()
    out = [{"review_id": r.id, "dispute_id": r.dispute_id, "model": r.model, "investigator_decision": r.proposed_outcome, "ai_verdict": r.verdict,
            "ai_outcome": r.ai_outcome, "ai_rationale": r.rationale, "correct_outcome": r.correct_outcome, "correction_note": r.correction_note,
            "corrected_by": r.corrected_by, "corrected_at": r.corrected_at, "source": r.correction_source, "already_exported": r.exported_at is not None} for r in rows]
    return out


@router.get("/ai-agent/feedback", dependencies=[Depends(require_ai_agent)])
def ai_feedback(only_new: bool = True, db: Session = Depends(get_db)):
    """Every time a manager overturned the AI, with the right answer and why. The AI team trains on this. Rows are marked as pulled."""
    rows = _feedback(db, only_new)
    ids = [r["review_id"] for r in rows]
    if ids:
        db.query(AIReview).filter(AIReview.id.in_(ids)).update({"exported_at": datetime.utcnow()}, synchronize_session=False)
        db.commit()
    return rows


@router.get("/ai-training")
def ai_training(user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """The same feedback, for a manager to read. Reading it doesn't mark anything as pulled."""
    return _feedback(db, False)


@router.post("/disputes/{dispute_id}/ai-verdict/simulate")
async def simulate_ai_verdict(dispute_id: str, request: VerdictRequest, user: Optional[User] = Depends(current_user), db: Session = Depends(get_db)):
    """Demo only: stand in for the AI reviewer by hand, so the rest of the flow can be tried before the real agent is connected."""
    if settings.RESOLVEIQ_MODE != "demo":
        raise HTTPException(status_code=400, detail="Only available in demo mode. The real AI reviewer calls /api/ai-agent.")
    d = _dispute(db, dispute_id)
    review = await _apply_verdict(db, d, request, "demo-simulator")
    return {"success": True, "dispute_id": d.id, "status": d.status, "outcome": d.outcome, "review_id": review.id}


# ---------- overturning a decision, and flags ----------
class ReviseRequest(BaseModel):
    outcome: str
    note: str


@router.post("/disputes/{dispute_id}/revise")
def revise(dispute_id: str, request: ReviseRequest, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    """A manager changes the outcome of a decided case. If the AI was involved, the correction is saved for it to learn from."""
    d = _dispute(db, dispute_id)
    try:
        DecisionService.revise(db, d, actor_name(user, "manager"), request.outcome, request.note)
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "dispute_id": d.id, "outcome": d.outcome}


class FlagRequest(BaseModel):
    points: str


@router.post("/disputes/{dispute_id}/flag")
def flag(dispute_id: str, request: FlagRequest, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """An investigator says the AI reviewer got their case wrong, and why. A manager decides."""
    if user and user.role == MANAGER:
        raise HTTPException(status_code=403, detail="Investigators flag decisions. Managers resolve the flags.")
    d = _dispute(db, dispute_id)
    try:
        f = DecisionService.raise_flag(db, d, user, actor_name(user, "investigator"), request.points)
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "flag_id": f.id}


def _flag(db: Session, f: Flag) -> dict:
    d = db.query(Dispute).filter(Dispute.id == f.dispute_id).first()
    who = db.get(User, f.raised_by)
    return {"id": f.id, "dispute_id": f.dispute_id, "raised_by": who.display_name if who else f.raised_by, "points": f.points, "status": f.status,
            "created_at": f.created_at, "resolved_by": f.resolved_by, "resolved_at": f.resolved_at, "resolution_note": f.resolution_note,
            "investigator_outcome": d.proposed_outcome if d else None, "ai_outcome": d.outcome if d else None, "ai_rationale": d.ai_rationale if d else None,
            "ai_verdict": d.ai_verdict if d else None}


@router.get("/flags")
def flags(status: Optional[str] = None, dispute_id: Optional[str] = None, user: Optional[User] = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Flag)
    if status:
        q = q.filter(Flag.status == status.upper())
    if dispute_id:
        q = q.filter(Flag.dispute_id == dispute_id)
    if user and user.role == INVESTIGATOR:
        q = q.filter(Flag.raised_by == user.id)
    return [_flag(db, f) for f in q.order_by(Flag.created_at.desc()).all()]


class ResolveFlagRequest(BaseModel):
    action: str    # UPHOLD_AI or OVERTURN
    note: str


@router.post("/flags/{flag_id}/resolve")
def resolve_flag(flag_id: str, request: ResolveFlagRequest, user: Optional[User] = Depends(manager_user), db: Session = Depends(get_db)):
    f = db.get(Flag, flag_id)
    if not f:
        raise HTTPException(status_code=404, detail="Flag not found.")
    try:
        DecisionService.resolve_flag(db, f, _dispute(db, f.dispute_id), actor_name(user, "manager"), request.action, request.note)
    except DecisionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _flag(db, f)


# ---------- emails and appeals ----------
@router.get("/disputes/{dispute_id}/emails")
def case_emails(dispute_id: str, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    _dispute(db, dispute_id)
    rows = db.query(Email).filter(Email.dispute_id == dispute_id).order_by(Email.created_at).all()
    return [{"id": e.id, "direction": e.direction, "to": e.to_address, "from": e.from_address, "subject": e.subject, "body": e.body, "party": e.party,
             "status": e.status, "created_at": e.created_at} for e in rows]


@router.get("/disputes/{dispute_id}/appeals")
def case_appeals(dispute_id: str, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    d = _dispute(db, dispute_id)
    kids = db.query(Dispute).filter(Dispute.parent_dispute_id == d.id).order_by(Dispute.appeal_number).all()
    return {"parent": d.parent_dispute_id, "appeals": [{"id": k.id, "status": k.status, "assigned_to": k.assigned_to, "manager": k.manager_assigned} for k in kids]}


class InboundMail(BaseModel):
    from_address: str
    to_address: Optional[str] = None
    subject: str = ""
    body: str = ""
    attachments: List[str] = []   # names of the files that came with the email


@router.post("/inbound-mail")
def inbound_mail(request: InboundMail, x_inbound_secret: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    """The mail provider forwards every reply to the appeals address here. A valid appeal opens a new case."""
    import hmac
    if not settings.INBOUND_MAIL_SECRET or not x_inbound_secret or not hmac.compare_digest(x_inbound_secret, settings.INBOUND_MAIL_SECRET):
        raise HTTPException(status_code=401, detail="Missing or wrong inbound mail secret.")
    return appeal_service.handle_inbound(db, request.from_address, request.to_address or settings.APPEALS_EMAIL, request.subject, request.body, request.attachments)


class SimulatedAppeal(BaseModel):
    party: str = "BUYER"
    body: str = "I'm not happy with this decision. Please look into it again."


@router.post("/disputes/{dispute_id}/appeal/simulate")
def simulate_appeal(dispute_id: str, request: SimulatedAppeal, user: Optional[User] = Depends(case_user), db: Session = Depends(get_db)):
    """Demo only: the buyer (or seller) emails the appeals address asking for further investigation."""
    if settings.RESOLVEIQ_MODE != "demo":
        raise HTTPException(status_code=400, detail="Only available in demo mode. Real replies arrive at the appeals address.")
    d = _dispute(db, dispute_id)
    from backend.app.services import email_service
    sender = email_service.buyer_address(d) if request.party.upper() == "BUYER" else email_service.seller_address(d)
    return appeal_service.handle_inbound(db, sender, settings.APPEALS_EMAIL, f"Re: Decision on dispute {d.id}", request.body)
