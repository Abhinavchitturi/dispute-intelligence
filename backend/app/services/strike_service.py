"""Strikes, manager alerts and account blocking.

An investigator earns a strike each time the AI reviewer overturns their decision. Every few strikes the managers are alerted,
and the alert stays on top (and pings again every hour) until a manager marks it sorted. Reach the limit and the account is blocked.
"""
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from backend.app.config import settings
from backend.app.models.team import INVESTIGATOR, MANAGER, ManagerAlert, Notification, Strike, User
from backend.app.services.audit_service import AuditService


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


class StrikeService:
    @staticmethod
    def notify_threshold() -> int:
        return max(1, settings.STRIKE_NOTIFY_THRESHOLD)

    @staticmethod
    def block_threshold() -> int:
        return max(1, settings.STRIKE_BLOCK_THRESHOLD)

    # ---------- reading ----------
    @classmethod
    def active_strikes(cls, db: Session, user_id: str) -> int:
        return db.query(Strike).filter(Strike.user_id == user_id, Strike.voided_at.is_(None)).count()

    @classmethod
    def managers(cls, db: Session) -> List[User]:
        return db.query(User).filter(User.role == MANAGER).all()

    @classmethod
    def investigator_named(cls, db: Session, name: Optional[str]) -> Optional[User]:
        return db.query(User).filter(User.role == INVESTIGATOR, User.display_name == name).first() if name else None

    # ---------- pings ----------
    @classmethod
    def notify(cls, db: Session, user_id: str, kind: str, title: str, body: str, dispute_id: Optional[str] = None, alert_id: Optional[str] = None) -> Notification:
        n = Notification(id=_id("NTF"), user_id=user_id, alert_id=alert_id, kind=kind, title=title, body=body, dispute_id=dispute_id)
        db.add(n)
        return n

    @classmethod
    def open_alert(cls, db: Session, kind: str, title: str, body: str, user_id: Optional[str] = None, dispute_id: Optional[str] = None,
                   strike_level: Optional[int] = None) -> ManagerAlert:
        alert = ManagerAlert(id=_id("ALT"), kind=kind, user_id=user_id, dispute_id=dispute_id, title=title, body=body, strike_level=strike_level)
        db.add(alert)
        db.flush()
        for m in cls.managers(db):
            cls.notify(db, m.id, kind, title, body, dispute_id, alert.id)
        return alert

    # ---------- strikes ----------
    @classmethod
    def add_strike(cls, db: Session, investigator: Optional[User], dispute_id: str, reason: str) -> Optional[Strike]:
        """Records the strike, then raises an alert at each threshold and blocks the account at the limit."""
        if investigator is None:
            return None
        db.add(Strike(id=_id("STK"), user_id=investigator.id, dispute_id=dispute_id, reason=reason))
        db.flush()
        count = cls.active_strikes(db, investigator.id)
        cls.notify(db, investigator.id, "STRIKE", f"Strike {count} of {cls.block_threshold()}",
                   f"The AI reviewer overturned your decision on {dispute_id}. At {cls.block_threshold()} strikes your account is blocked.", dispute_id)
        AuditService.record_event(db=db, dispute_id=dispute_id, actor="system", action="STRIKE_ADDED", status="SUCCESS", source="synthetic",
                                  result_summary=f"{investigator.display_name} now has {count} strike{'s' if count != 1 else ''}. {reason}")
        limit = cls.block_threshold()
        if count >= limit and not investigator.is_blocked:
            investigator.is_blocked, investigator.blocked_at = True, datetime.utcnow()
            investigator.blocked_reason = f"{count} strikes. The limit is {limit}."
            cls.open_alert(db, "BLOCKED", f"{investigator.display_name} is blocked",
                           f"{investigator.display_name} reached {count} strikes (limit {limit}) and can no longer open or approve cases. Unblock the account when it is sorted.",
                           user_id=investigator.id, strike_level=count)
            AuditService.record_event(db=db, actor="system", action="ACCOUNT_BLOCKED", status="SUCCESS", source="synthetic",
                                      result_summary=f"{investigator.display_name} was blocked at {count} strikes.")
        elif count % cls.notify_threshold() == 0:
            cls.open_alert(db, "STRIKES", f"{investigator.display_name} has {count} strikes",
                           f"The AI reviewer has overturned {count} of {investigator.display_name}'s decisions. Review their cases and mark this sorted once you have dealt with it.",
                           user_id=investigator.id, strike_level=count)
        return db.query(Strike).filter(Strike.user_id == investigator.id).order_by(Strike.created_at.desc()).first()

    @classmethod
    def void_strike(cls, db: Session, dispute_id: str, by: str, reason: str) -> int:
        """The investigator was right after all, so the strike comes off."""
        n = 0
        for s in db.query(Strike).filter(Strike.dispute_id == dispute_id, Strike.voided_at.is_(None)).all():
            s.voided_at, s.voided_by, s.void_reason = datetime.utcnow(), by, reason
            n += 1
        return n

    @classmethod
    def history(cls, db: Session, user_id: str) -> List[Strike]:
        return db.query(Strike).filter(Strike.user_id == user_id).order_by(Strike.created_at.desc()).all()

    # ---------- the manager's side ----------
    @classmethod
    def sort_alert(cls, db: Session, alert: ManagerAlert, manager: str, note: Optional[str]) -> ManagerAlert:
        if alert.status == "SORTED":
            return alert
        alert.status, alert.sorted_by, alert.sorted_at, alert.sorted_note = "SORTED", manager, datetime.utcnow(), (note or "").strip() or None
        AuditService.record_event(db=db, dispute_id=alert.dispute_id, actor=manager, action="ALERT_SORTED", status="SUCCESS", source="synthetic",
                                  result_summary=f"Marked sorted: {alert.title}.{' Note: ' + alert.sorted_note if alert.sorted_note else ''}")
        db.commit()
        return alert

    @classmethod
    def unblock(cls, db: Session, user: User, manager: str, note: Optional[str]) -> User:
        """Lets the investigator work again, with a clean slate: their strikes are cleared and the block alert is sorted."""
        if not user.is_blocked:
            return user
        user.is_blocked, user.blocked_at, user.blocked_reason = False, None, None
        for s in db.query(Strike).filter(Strike.user_id == user.id, Strike.voided_at.is_(None)).all():
            s.voided_at, s.voided_by, s.void_reason = datetime.utcnow(), manager, "Cleared when the account was unblocked"
        for a in db.query(ManagerAlert).filter(ManagerAlert.user_id == user.id, ManagerAlert.status == "OPEN").all():
            a.status, a.sorted_by, a.sorted_at, a.sorted_note = "SORTED", manager, datetime.utcnow(), "Account unblocked"
        cls.notify(db, user.id, "UNBLOCKED", "Your account is unblocked", f"{manager} unblocked your account and cleared your strikes.")
        AuditService.record_event(db=db, actor=manager, action="ACCOUNT_UNBLOCKED", status="SUCCESS", source="synthetic",
                                  result_summary=f"{user.display_name} was unblocked.{' Note: ' + note.strip() if note and note.strip() else ''}")
        db.commit()
        return user

    # ---------- the hourly ping ----------
    @classmethod
    def remind_due(cls, db: Session, now: Optional[datetime] = None) -> int:
        """Every open alert pings every manager again once the reminder interval has passed. Run on a timer."""
        now = now or datetime.utcnow()
        gap = timedelta(minutes=max(1, settings.ALERT_REMINDER_MINUTES))
        sent = 0
        for alert in db.query(ManagerAlert).filter(ManagerAlert.status == "OPEN").all():
            if now - (alert.last_notified_at or alert.created_at) < gap:
                continue
            alert.reminder_count = (alert.reminder_count or 0) + 1
            alert.last_notified_at = now
            for m in cls.managers(db):
                cls.notify(db, m.id, alert.kind, f"Reminder: {alert.title}", f"{alert.body} (Reminder {alert.reminder_count}. Still not marked sorted.)", alert.dispute_id, alert.id)
                sent += 1
        db.commit()
        return sent
