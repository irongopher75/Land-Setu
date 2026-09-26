"""Cross-department land transactions. The workflow itself lives in app/transactions.py.

Included BEFORE routes.parcels in main.py, next to the other /parcels/... routers.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import transactions as tx_engine
from app.db import get_db
from app.models import LandTransaction, Parcel
from app.routes.auth import get_current_payload, require_roles

router = APIRouter(tags=["Transactions"])


class OpenTransaction(BaseModel):
    ulpin: str = Field(max_length=64)
    transaction_type: str = Field(max_length=20)
    deed_reference: str = Field(max_length=64)
    land_use_change_to: Optional[str] = Field(None, max_length=60)  # set when the buyer plans a change of land use


class StageAction(BaseModel):
    action: str = Field(max_length=10)   # approve | object | reject. In a dispute hearing: approve dismisses, reject upholds.
    remarks: str = Field("", max_length=1000)


class Handoff(BaseModel):
    to_department: str = Field(max_length=20)
    reason: str = Field(min_length=5, max_length=500)


def _get(db: Session, tx_id: int) -> LandTransaction:
    tx = db.query(LandTransaction).filter(LandTransaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


@router.post("/transactions", status_code=201)
def open_transaction(body: OpenTransaction, actor: dict = Depends(get_current_payload),
                     role: str = Depends(require_roles("officer", "state_admin")), db: Session = Depends(get_db)):
    """The Sub-Registrar opens a transaction. The deed must be a registered deed of the parcel."""
    parcel = db.query(Parcel).filter(Parcel.ulpin == body.ulpin).first()
    if not parcel:
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{body.ulpin}' not found")
    tx = tx_engine.open_transaction(db, parcel, body.transaction_type, body.deed_reference, role, actor["sub"],
                                    body.land_use_change_to)
    db.commit()
    db.refresh(tx)
    return tx_engine.view(db, tx)


@router.patch("/transactions/{tx_id}/stage")
def act_on_stage(tx_id: int, body: StageAction, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Act on the stage that is waiting: approve, object (Revenue only) or reject."""
    tx = _get(db, tx_id)
    tx_engine.act_on_stage(db, tx, actor["role"], actor["sub"], body.action, body.remarks)
    db.commit()
    db.refresh(tx)
    return tx_engine.view(db, tx)


@router.post("/transactions/{tx_id}/handoff")
def handoff(tx_id: int, body: Handoff, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    """Move the transaction to the next department, or escalate an objection to the dispute authority."""
    tx = _get(db, tx_id)
    tx_engine.handoff(db, tx, actor["role"], actor["sub"], body.to_department.upper(), body.reason.strip())
    db.commit()
    db.refresh(tx)
    return tx_engine.view(db, tx)


@router.get("/transactions/{tx_id}")
def get_transaction(tx_id: int, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    return tx_engine.view(db, _get(db, tx_id))


@router.get("/parcels/{ulpin}/transactions")
def parcel_transactions(ulpin: str, actor: dict = Depends(get_current_payload), db: Session = Depends(get_db)):
    if not db.query(Parcel.id).filter(Parcel.ulpin == ulpin).first():
        raise HTTPException(status_code=404, detail=f"Parcel with ULPIN '{ulpin}' not found")
    rows = db.query(LandTransaction).filter(LandTransaction.ulpin == ulpin).order_by(LandTransaction.id.desc()).all()
    return [tx_engine.view(db, t) for t in rows]
