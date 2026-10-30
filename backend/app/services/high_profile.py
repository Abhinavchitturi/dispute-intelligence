"""High-profile cases: the ones a manager takes on personally.

It goes by the price at stake, nothing else. A priority score keeps changing as a case moves along, so it would make cases
jump in and out of the manager's list. An amount doesn't change.
"""
from backend.app.config import settings
from backend.app.models.dispute import Dispute


def is_high_profile(d: Dispute) -> bool:
    return (d.amount or 0) >= settings.HIGH_PROFILE_AMOUNT


def high_profile_filter():
    """The same rule, as a database filter."""
    return Dispute.amount >= settings.HIGH_PROFILE_AMOUNT
