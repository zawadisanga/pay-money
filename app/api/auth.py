from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from app.utils.db import get_db
from app.schemas import UserCreate, UserLogin, Token, UserResponse
from app.models import User
from app.utils.security import get_password_hash, verify_password, create_access_token, create_refresh_token
from datetime import timedelta
from app.config import settings

router = APIRouter()

@router.post("/register", response_model=UserResponse)
def register(user: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed = get_password_hash(user.password)
    db_user = User(email=user.email, hashed_password=hashed, full_name=user.full_name)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.post("/login")
def login(user: UserLogin, response: Response, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": str(db_user.id)})
    refresh_token = create_refresh_token(data={"sub": str(db_user.id)})

    # Set cookies (HttpOnly, Secure)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True,  # ensure HTTPS
        samesite="lax",
        max_age=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES).total_seconds()
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS).total_seconds()
    )
    return {"message": "Logged in"}
