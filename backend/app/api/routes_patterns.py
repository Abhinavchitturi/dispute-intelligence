from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Dict, Any

from backend.app.database import get_db
from backend.app.services.pattern_service import PatternService

router = APIRouter(tags=["Pattern Insights"])

@router.get("/patterns", response_model=List[Dict[str, Any]])
def get_patterns(db: Session = Depends(get_db)):
    """
    Returns automated pattern insights and evidentiary anomalies
    identified across the authorized dataset.
    """
    return PatternService.get_pattern_insights(db)
