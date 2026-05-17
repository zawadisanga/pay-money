# app/utils/fee.py
from decimal import Decimal

def calculate_fee(amount: Decimal, fee_percent: Decimal) -> Decimal:
    """Rudisha kiasi cha ada kulingana na asilimia."""
    return (amount * fee_percent) / Decimal('100')
