"""Shared test steps."""


def decide(client, dispute_id: str, outcome: str = "SELLER_FAVOR", reason: str = "Decided on the evidence on file for this case.") -> dict:
    """A full decision the way the app does it: an investigator proposes it, then a manager confirms it (the AI reviewer is built elsewhere)."""
    r = client.post(f"/api/disputes/{dispute_id}/decision", json={"outcome": outcome, "reason": reason, "confirmed": True, "actor": "Abhinav Chitturi"})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/disputes/{dispute_id}/admin-review", json={"action": "APPROVE", "reviewer": "PayPal", "role": "MANAGER"})
    assert r.status_code == 200, r.text
    return r.json()
