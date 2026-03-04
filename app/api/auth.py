import logging
from datetime import datetime, timedelta
from typing import Optional
import jwt
import bcrypt
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from app.core.db import db
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# --- Models ---
class LoginRequest(BaseModel):
    nickname: str
    pin: str # 6-digit PIN

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str

# --- Helper Functions ---
def verify_pin(plain_pin: str, hashed_pin: str) -> bool:
    return bcrypt.checkpw(plain_pin.encode('utf-8'), hashed_pin.encode('utf-8'))

def get_password_hash(pin: str) -> str:
    return bcrypt.hashpw(pin.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

# --- Dependencies ---
async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    try:
        user = await db.user.find_unique(where={"id": user_id})
        if user is None:
            raise credentials_exception
        return user
    except Exception as e:
        logger.error(f"DB Error fetching current user: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

async def get_current_admin(user = Depends(get_current_user)):
    if user.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions. Admin access required."
        )
    return user

# --- Routes ---
@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """
    Lightweight Login: Nickname + 6-digit PIN.
    If user doesn't exist, auto-create them as a BUYER.
    """
    if not req.pin.isdigit() or len(req.pin) != 6:
        raise HTTPException(status_code=400, detail="PIN must be exactly 6 digits.")

    try:
        user = await db.user.find_unique(where={"nickname": req.nickname})

        if not user:
            # Auto-register new user
            hashed_pin = get_password_hash(req.pin)
            user = await db.user.create(
                data={
                    "nickname": req.nickname,
                    "hashedPin": hashed_pin,
                    "role": "BUYER",
                    "trustScore": 0
                }
            )
            logger.info(f"New user registered: {user.nickname}")
        else:
            # Verify existing user
            if not verify_pin(req.pin, user.hashedPin):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Incorrect PIN",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        access_token_expires = timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": user.id, "role": user.role}, expires_delta=access_token_expires
        )

        return {"access_token": access_token, "token_type": "bearer", "role": user.role}

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"Login failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error during authentication.")