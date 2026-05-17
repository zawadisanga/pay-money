from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.utils.db import get_db
from app.models import User, Wallet
from app.utils.security import verify_access_token
from app.dependencies import get_current_user

router = APIRouter()

@router.get("/balance")
def get_balance(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    wallets = db.query(Wallet).filter(Wallet.user_id == current_user.id).all()
    return {w.currency: w.balance for w in wallets}

@router.post("/deposit/card")
def deposit_from_card(amount: float, currency: str, card_token: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Simulate card charge (replace with Stripe)
    # ... payment gateway call
    # On success, update wallet using optimistic concurrency
    # ... (detailed implementation)
    return {"status": "success"}
