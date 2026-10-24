import json
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, or_

from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models.dispute import Dispute, Transaction, Order, Shipment
from backend.app.models.evidence import Evidence
from backend.app.models.audit import AuditEvent
from backend.app.schemas.dispute import (
    DisputeListItem,
    DisputeDetail,
    TimelineEvent,
    HistoricalCaseSchema,
    EvidenceSchema,
    PriorityFactor
)
from backend.app.schemas.integrations import DashboardSummaryResponse
from backend.app.services.similar_cases_service import SimilarCasesService

router = APIRouter(tags=["Disputes"])

@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(db: Session = Depends(get_db)):
    """Aggregates real database metrics for the overview dashboard."""
    now = datetime.utcnow()
    
    # 1. Total Open Disputes
    open_statuses = ["WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE", "UNDER_REVIEW"]
    total_open = db.query(Dispute).filter(Dispute.status.in_(open_statuses)).count()
    
    # 2. Approaching Response Deadlines (< 48 hrs)
    approaching = db.query(Dispute).filter(
        Dispute.status.in_(open_statuses),
        Dispute.response_due_date.isnot(None),
        Dispute.response_due_date <= (now + timedelta(hours=48))
    ).count()

    # 3. Missing Evidence
    missing_evidence = db.query(Dispute).filter(
        Dispute.status.in_(open_statuses),
        Dispute.evidence_status.in_(["MISSING", "CONFLICTING"])
    ).count()

    # 4. Awaiting Review
    awaiting_review = db.query(Dispute).filter(
        Dispute.status == "WAITING_FOR_SELLER_RESPONSE"
    ).count()

    # 5. Volume by Reason
    reason_counts = {}
    for dsp in db.query(Dispute.reason).all():
        r = dsp[0]
        reason_counts[r] = reason_counts.get(r, 0) + 1
    
    disputes_by_reason = [{"reason": k, "count": v} for k, v in reason_counts.items()]

    # 6. Priority Distribution
    p_high = db.query(Dispute).filter(Dispute.priority_score >= 70).count()
    p_med = db.query(Dispute).filter(Dispute.priority_score >= 40, Dispute.priority_score < 70).count()
    p_low = db.query(Dispute).filter(Dispute.priority_score < 40).count()

    # 7. Recent Activity (last 6 audit events)
    recent_events = (
        db.query(AuditEvent)
        .order_by(AuditEvent.created_at.desc())
        .limit(6)
        .all()
    )
    recent_activity = [
        {
            "id": e.id,
            "dispute_id": e.dispute_id,
            "actor": e.actor,
            "action": e.action,
            "status": e.status,
            "result_summary": e.result_summary,
            "created_at": e.created_at.isoformat()
        }
        for e in recent_events
    ]

    # 8. Action Outcomes
    successful_actions = db.query(AuditEvent).filter(AuditEvent.status == "SUCCESS").count()
    failed_actions = db.query(AuditEvent).filter(AuditEvent.status == "FAILED").count()
    pending_actions = db.query(AuditEvent).filter(AuditEvent.status == "PENDING_APPROVAL").count()

    return DashboardSummaryResponse(
        environment_mode=settings.RESOLVEIQ_MODE,
        total_open_disputes=total_open,
        approaching_deadline_count=approaching,
        missing_evidence_count=missing_evidence,
        awaiting_review_count=awaiting_review,
        disputes_by_reason=disputes_by_reason,
        priority_distribution={"high": p_high, "medium": p_med, "low": p_low},
        recent_activity=recent_activity,
        action_outcomes_summary={"success": successful_actions, "failed": failed_actions, "pending": pending_actions}
    )

@router.get("/disputes", response_model=List[DisputeListItem])
def list_disputes(
    search: Optional[str] = None,
    status: Optional[str] = None,
    reason: Optional[str] = None,
    source: Optional[str] = None,
    evidence_status: Optional[str] = None,
    priority_level: Optional[str] = None,  # high, medium, low
    sort_by: str = "priority_score",
    sort_order: str = "desc",
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Lists disputes with multi-attribute filtering, search, sorting, and pagination."""
    query = db.query(Dispute)

    if search:
        search_term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Dispute.id.ilike(search_term),
                Dispute.external_dispute_id.ilike(search_term),
                Dispute.buyer_reference.ilike(search_term),
                Dispute.merchant_reference.ilike(search_term),
                Dispute.transaction_id.ilike(search_term),
                Dispute.order_id.ilike(search_term)
            )
        )

    if status and status != "ALL":
        query = query.filter(Dispute.status == status)

    if reason and reason != "ALL":
        query = query.filter(Dispute.reason == reason)

    if source and source != "ALL":
        query = query.filter(Dispute.source == source)

    if evidence_status and evidence_status != "ALL":
        query = query.filter(Dispute.evidence_status == evidence_status)

    if priority_level and priority_level != "ALL":
        if priority_level == "high":
            query = query.filter(Dispute.priority_score >= 70.0)
        elif priority_level == "medium":
            query = query.filter(Dispute.priority_score >= 40.0, Dispute.priority_score < 70.0)
        elif priority_level == "low":
            query = query.filter(Dispute.priority_score < 40.0)

    # Sorting
    sort_col = getattr(Dispute, sort_by, Dispute.priority_score)
    if sort_order.lower() == "asc":
        query = query.order_by(asc(sort_col))
    else:
        query = query.order_by(desc(sort_col))

    disputes = query.offset(skip).limit(limit).all()
    results: List[DisputeListItem] = []

    for d in disputes:
        factors = []
        if d.priority_factors_json:
            try:
                raw_factors = json.loads(d.priority_factors_json)
                factors = [PriorityFactor(**rf) for rf in raw_factors]
            except Exception:
                factors = []

        item = DisputeListItem(
            id=d.id,
            external_dispute_id=d.external_dispute_id,
            source=d.source,
            transaction_id=d.transaction_id,
            order_id=d.order_id,
            buyer_reference=d.buyer_reference,
            merchant_reference=d.merchant_reference,
            reason=d.reason,
            status=d.status,
            amount=d.amount,
            currency=d.currency,
            response_due_date=d.response_due_date,
            created_at=d.created_at,
            updated_at=d.updated_at,
            priority_score=d.priority_score,
            priority_factors=factors,
            evidence_status=d.evidence_status,
            buyer_claim=d.buyer_claim
        )
        results.append(item)

    return results

@router.get("/disputes/{dispute_id}", response_model=DisputeDetail)
def get_dispute_detail(dispute_id: str, db: Session = Depends(get_db)):
    """Retrieves single dispute with complete transaction, order, shipment, and evidence context."""
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")

    factors = []
    if dispute.priority_factors_json:
        try:
            raw_factors = json.loads(dispute.priority_factors_json)
            factors = [PriorityFactor(**rf) for rf in raw_factors]
        except Exception:
            factors = []

    latest_brief_id = dispute.briefs[-1].id if dispute.briefs else None

    return DisputeDetail(
        id=dispute.id,
        external_dispute_id=dispute.external_dispute_id,
        source=dispute.source,
        transaction_id=dispute.transaction_id,
        order_id=dispute.order_id,
        buyer_reference=dispute.buyer_reference,
        merchant_reference=dispute.merchant_reference,
        reason=dispute.reason,
        status=dispute.status,
        amount=dispute.amount,
        currency=dispute.currency,
        response_due_date=dispute.response_due_date,
        created_at=dispute.created_at,
        updated_at=dispute.updated_at,
        priority_score=dispute.priority_score,
        priority_factors=factors,
        evidence_status=dispute.evidence_status,
        buyer_claim=dispute.buyer_claim,
        transaction=dispute.transaction,
        order=dispute.order,
        evidence_items=dispute.evidence_items,
        latest_brief_id=latest_brief_id
    )

@router.get("/disputes/{dispute_id}/timeline", response_model=List[TimelineEvent])
def get_dispute_timeline(dispute_id: str, db: Session = Depends(get_db)):
    """Builds an evidence-backed chronological event timeline."""
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")

    events: List[TimelineEvent] = []

    # 1. Order Event
    if dispute.order and dispute.order.order_date:
        events.append(TimelineEvent(
            id=f"EVT-ORD-{dispute.order.id}",
            timestamp=dispute.order.order_date,
            event_type="ORDER",
            title=f"Order Placed ({dispute.order.id})",
            description=f"Purchased: {dispute.order.item_summary} for {dispute.order.currency} {dispute.order.amount:.2f}",
            source=dispute.order.source,
            source_record_id=dispute.order.id,
            status="PLACED"
        ))

    # 2. Payment Event
    if dispute.transaction and dispute.transaction.transaction_date:
        events.append(TimelineEvent(
            id=f"EVT-TXN-{dispute.transaction.id}",
            timestamp=dispute.transaction.transaction_date,
            event_type="PAYMENT",
            title=f"Payment Processed ({dispute.transaction.id})",
            description=f"Payment status: {dispute.transaction.status} via {dispute.transaction.payment_method or 'Card'}",
            source=dispute.transaction.source,
            source_record_id=dispute.transaction.id,
            status=dispute.transaction.status
        ))

    # 3. Shipment Events
    if dispute.order and dispute.order.shipment:
        s = dispute.order.shipment
        if s.shipped_at:
            events.append(TimelineEvent(
                id=f"EVT-SHIP-DEPART-{s.id}",
                timestamp=s.shipped_at,
                event_type="SHIPMENT",
                title=f"Package Dispatched via {s.carrier or 'Carrier'}",
                description=f"Tracking ref: {s.tracking_reference or 'N/A'}",
                source=s.source,
                source_record_id=s.id,
                status="DISPATCHED"
            ))
        if s.delivered_at:
            events.append(TimelineEvent(
                id=f"EVT-SHIP-DELIV-{s.id}",
                timestamp=s.delivered_at,
                event_type="SHIPMENT",
                title=f"Carrier Reported {s.status}",
                description=f"Delivery confirmation to {s.destination_city or 'destination'}. Address match: {s.delivery_address_match}",
                source=s.source,
                source_record_id=s.id,
                status=s.status
            ))

    # 4. Dispute Intake Event
    if dispute.created_at:
        events.append(TimelineEvent(
            id=f"EVT-DSP-START-{dispute.id}",
            timestamp=dispute.created_at,
            event_type="DISPUTE",
            title=f"Dispute Filed: {dispute.reason}",
            description=f"Buyer assertion: \"{dispute.buyer_claim or 'No initial statement'}\"",
            source=dispute.source,
            source_record_id=dispute.id,
            status=dispute.status
        ))

    # 5. Evidence Submissions
    for ev in dispute.evidence_items:
        if ev.submitted_at:
            events.append(TimelineEvent(
                id=f"EVT-EVID-{ev.id}",
                timestamp=ev.submitted_at,
                event_type="EVIDENCE",
                title=f"Evidence Logged: {ev.evidence_type}",
                description=ev.description,
                source=ev.source,
                source_record_id=ev.id,
                status=ev.availability_status
            ))

    # 6. Investigator Audit Events
    for aud in dispute.audit_events:
        events.append(TimelineEvent(
            id=f"EVT-AUD-{aud.id}",
            timestamp=aud.created_at,
            event_type="INVESTIGATOR_ACTION",
            title=f"{aud.action.replace('_', ' ').title()}",
            description=f"Actor: {aud.actor} | Result: {aud.result_summary}",
            source=aud.source,
            source_record_id=aud.id,
            status=aud.status
        ))

    # Sort chronological
    events.sort(key=lambda x: x.timestamp)
    return events

@router.get("/disputes/{dispute_id}/evidence", response_model=List[EvidenceSchema])
def get_dispute_evidence(dispute_id: str, db: Session = Depends(get_db)):
    """Retrieves all evidence records with source references for a given dispute."""
    dispute = db.query(Dispute).filter(Dispute.id == dispute_id).first()
    if not dispute:
        raise HTTPException(status_code=404, detail=f"Dispute '{dispute_id}' not found.")
    return [EvidenceSchema.model_validate(e) for e in dispute.evidence_items]

@router.get("/disputes/{dispute_id}/similar-cases", response_model=List[HistoricalCaseSchema])
def get_similar_cases_for_dispute(dispute_id: str, db: Session = Depends(get_db)):
    """Finds top similar historical cases matching the specified dispute's pattern."""
    return SimilarCasesService.find_similar_cases(dispute_id=dispute_id, db=db, limit=5)

@router.get("/similar-cases", response_model=List[HistoricalCaseSchema])
def search_similar_cases(
    reason: Optional[str] = None,
    outcome: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Historical case dataset search."""
    return SimilarCasesService.search_historical_cases(
        db=db,
        reason=reason,
        outcome=outcome,
        search_query=search,
        limit=20
    )
