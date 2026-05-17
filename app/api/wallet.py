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


    # app/api/wallet.py (au transactions.py)

from decimal import Decimal
from app.utils.fee import calculate_fee
from app.models import SystemConfig

@router.post("/transfer/internal")
def internal_transfer(
    *,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    receiver_email: str,
    amount: Decimal,
    currency: str
):
    # Pata asilimia ya ada kutoka system_config
    fee_config = db.query(SystemConfig).filter(SystemConfig.key == "transaction_fee_percent").first()
    fee_percent = Decimal(fee_config.value) if fee_config else Decimal('0')

    # Hesabu ada
    fee_amount = calculate_fee(amount, fee_percent)
    net_amount = amount - fee_amount

    # Hakikisha mtumiaji ana salio la kutosha (amount kamili, si net)
    sender_wallet = db.query(Wallet).filter(
        Wallet.user_id == current_user.id,
        Wallet.currency == currency
    ).first()
    if not sender_wallet or sender_wallet.balance < amount:
        raise HTTPException(status_code=400, detail="Salio haitoshi")

    # Pata au unda wallet ya mfumo kwa sarafu hiyo
    platform_wallet = db.query(Wallet).filter(
        Wallet.user_id == PLATFORM_USER_ID,  # unahitaji kuweka ID ya akaunti ya mfumo
        Wallet.currency == currency
    ).first()
    if not platform_wallet:
        # Tengeneza wallet kwa mfumo
        platform_wallet = Wallet(
            user_id=PLATFORM_USER_ID,
            currency=currency,
            balance=Decimal('0')
        )
        db.add(platform_wallet)

    # Tumia transaction ya database kuhakikisha usalama
    try:
        # Toa kiasi kamili kwa mtumaji
        sender_wallet.balance -= amount
        # Ongeza kiasi halisi (baada ya kukata ada) kwa mpokeaji
        receiver_wallet = db.query(Wallet).filter(
            Wallet.user_id == receiver_id,  # pata receiver_id kutoka email
            Wallet.currency == currency
        ).first()
        if not receiver_wallet:
            receiver_wallet = Wallet(
                user_id=receiver_id,
                currency=currency,
                balance=Decimal('0')
            )
            db.add(receiver_wallet)
        receiver_wallet.balance += net_amount

        # Ongeza ada kwa wallet ya mfumo
        platform_wallet.balance += fee_amount

        # Rekodi muamala kwa mtumaji na mpokeaji
        transaction = Transaction(
            sender_id=current_user.id,
            receiver_id=receiver_id,
            amount=amount,
            currency=currency,
            type="internal_transfer",
            status="completed",
            metadata=f'{{"fee": "{fee_amount}", "net": "{net_amount}"}}'
        )
        db.add(transaction)

        # Rekodi muamala wa ada (kwa ukaguzi)
        fee_transaction = Transaction(
            sender_id=current_user.id,
            receiver_id=PLATFORM_USER_ID,
            amount=fee_amount,
            currency=currency,
            type="fee",
            status="completed",
            metadata=f'{{"original_transaction": "{transaction.id}"}}'
        )
        db.add(fee_transaction)

        db.commit()
        return {"status": "success", "fee": str(fee_amount), "net_sent": str(net_amount)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail="Muamala umeshindwa")


@router.post("/transfer/external")
def external_transfer(
    ...,
    amount: Decimal,
    currency: str,
    provider: str,
    target: str
):
    # Pata asilimia ya ada
    fee_percent = ...  # kama hapo juu
    fee_amount = calculate_fee(amount, fee_percent)
    net_amount = amount - fee_amount

    # Hakikisha mtumaji ana salio la kutosha (amount kamili)
    # Toa amount kamili kwenye wallet ya mtumaji
    # Ongeza net_amount kwa platform wallet (au unaweza kutumia wallet ya mfumo)
    # Tuma net_amount kwa provider wa nje (kwa mfano PayPal)
    # Rekodi muamala

    # Kwa maelezo zaidi, unaweza kufuata muundo sawa na internal transfer
