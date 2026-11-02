"""The pages a buyer or seller reaches from a link in an email. They have no account, so each link carries a signed token."""
from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.models.dispute import Dispute
from backend.app.services import reopen_service

router = APIRouter(tags=["Public"])


def _page(title: str, text: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(f"<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{title}</title>"
                        f"<body style='font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;color:#1d1d1f'>"
                        f"<h1 style='font-size:24px'>{title}</h1><p style='font-size:16px;line-height:1.5'>{text}</p></body>", status_code=status)


@router.get("/public/new-case/{token}", response_class=HTMLResponse)
def new_case(token: str, db: Session = Depends(get_db)):
    did = reopen_service.dispute_id_from(token)
    original = db.query(Dispute).filter(Dispute.id == did).first() if did else None
    if not original:
        return _page("This link isn't valid", "Check that you used the whole link from the email.", 404)
    try:
        new = reopen_service.open_new_case(db, original)
    except reopen_service.ReopenError as e:
        return _page("No new case opened", str(e), 400)
    return _page("Your new case is open", f"Your new case is {new.id}. We will email you what we need next.")
