import os
import shutil
from typing import Optional, List
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session as DBSession

from database import engine, Base, get_db, SessionLocal
import models
import auth
from rag_core import process_and_add_document, get_answer_stream, clear_session_vectors, TEMP_UPLOADS_DIR

# Auto-create tables in database on startup
Base.metadata.create_all(bind=engine)

app = FastAPI(title="DocuQuery - RAG Q&A System")

# Allow CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure temp directory exists
os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)

# Pydantic Request Models
class UserRegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLoginRequest(BaseModel):
    username_or_email: str
    password: str

class ChatRequest(BaseModel):
    query: str
    session_id: str = "default_session"

class SessionCreateRequest(BaseModel):
    name: Optional[str] = "New Chat"

# ----------------------------------------------------
# AUTHENTICATION ENDPOINTS (Public)
# ----------------------------------------------------
@app.post("/auth/register")
async def register(req: UserRegisterRequest, db: DBSession = Depends(get_db)):
    # Check if username or email exists
    existing_user = db.query(models.User).filter(
        (models.User.username == req.username) | (models.User.email == req.email)
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or Email already registered")

    hashed_pw = auth.get_password_hash(req.password)
    new_user = models.User(
        username=req.username,
        email=req.email,
        hashed_password=hashed_pw
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    access_token = auth.create_access_token(data={"user_id": new_user.id, "sub": new_user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email
        }
    }

@app.post("/auth/login")
async def login(req: UserLoginRequest, db: DBSession = Depends(get_db)):
    user = db.query(models.User).filter(
        (models.User.username == req.username_or_email) | (models.User.email == req.username_or_email)
    ).first()

    if not user or not auth.verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username/email or password")

    access_token = auth.create_access_token(data={"user_id": user.id, "sub": user.username})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email
        }
    }

@app.get("/auth/me")
async def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email
    }

# ----------------------------------------------------
# PROTECTED SESSION & HISTORY ENDPOINTS (Requires Auth)
# ----------------------------------------------------
@app.get("/sessions")
async def get_sessions(
    current_user: models.User = Depends(auth.get_current_user),
    db: DBSession = Depends(get_db)
):
    sessions = db.query(models.Session).filter(
        models.Session.user_id == current_user.id
    ).order_by(models.Session.updated_at.desc()).all()
    
    return [
        {
            "id": s.id,
            "name": s.name,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat()
        }
        for s in sessions
    ]

@app.post("/sessions")
async def create_session(
    req: SessionCreateRequest,
    current_user: models.User = Depends(auth.get_current_user),
    db: DBSession = Depends(get_db)
):
    import uuid
    new_id = str(uuid.uuid4())
    new_session = models.Session(
        id=new_id,
        user_id=current_user.id,
        name=req.name or "New Chat",
        is_guest=False
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return {
        "id": new_session.id,
        "name": new_session.name,
        "created_at": new_session.created_at.isoformat()
    }

@app.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    current_user: models.User = Depends(auth.get_current_user),
    db: DBSession = Depends(get_db)
):
    # Verify session belongs to current user
    sess = db.query(models.Session).filter(
        models.Session.id == session_id,
        models.Session.user_id == current_user.id
    ).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = db.query(models.Message).filter(models.Message.session_id == session_id).order_by(models.Message.created_at.asc()).all()
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources or [],
            "created_at": m.created_at.isoformat()
        }
        for m in messages
    ]

@app.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    current_user: models.User = Depends(auth.get_current_user),
    db: DBSession = Depends(get_db)
):
    sess = db.query(models.Session).filter(
        models.Session.id == session_id,
        models.Session.user_id == current_user.id
    ).first()
    
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
        
    db.delete(sess)
    db.commit()
    clear_session_vectors(session_id)
    return {"message": "Session deleted successfully"}

# ----------------------------------------------------
# PROTECTED DOCUMENT UPLOAD & RAG CHAT (Requires Auth)
# ----------------------------------------------------
@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form("default_session"),
    current_user: models.User = Depends(auth.get_current_user),
    db: DBSession = Depends(get_db)
):
    filename = os.path.basename(file.filename)
    if not filename.endswith(('.pdf', '.txt')):
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported")
        
    file_location = os.path.join(TEMP_UPLOADS_DIR, filename)
    
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Ensure session exists in DB
    sess = db.query(models.Session).filter(
        models.Session.id == session_id,
        models.Session.user_id == current_user.id
    ).first()
    if not sess:
        sess = models.Session(id=session_id, user_id=current_user.id, name=filename[:30])
        db.add(sess)
        db.commit()

    try:
        result = process_and_add_document(file_location, session_id, str(current_user.id))
        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["message"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(file_location):
            os.remove(file_location)
            
    return JSONResponse(content={"message": f"Successfully indexed {file.filename}"})

@app.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: models.User = Depends(auth.get_current_user),
    db: DBSession = Depends(get_db)
):
    if not request.query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    owner_id = str(current_user.id)

    # Save the user query to database
    sess = db.query(models.Session).filter(
        models.Session.id == request.session_id,
        models.Session.user_id == current_user.id
    ).first()
    if not sess:
        sess = models.Session(id=request.session_id, user_id=current_user.id, name=request.query[:30])
        db.add(sess)
        db.commit()

    user_msg = models.Message(
        session_id=request.session_id,
        role="user",
        content=request.query
    )
    db.add(user_msg)
    db.commit()

    # Wrap get_answer_stream generator to collect full system response for DB saving
    async def db_saving_stream_wrapper():
        full_text = ""
        final_sources = []

        async for chunk_str in get_answer_stream(request.query, request.session_id, owner_id):
            yield chunk_str
            try:
                import json
                data = json.loads(chunk_str.strip())
                if "chunk" in data:
                    full_text += data["chunk"]
                if "sources" in data:
                    final_sources = data["sources"]
            except Exception:
                pass

        # Save assistant response to DB after stream finishes
        if full_text.strip():
            db_session = SessionLocal()
            try:
                sys_msg = models.Message(
                    session_id=request.session_id,
                    role="system",
                    content=full_text,
                    sources=final_sources
                )
                db_session.add(sys_msg)
                
                # Update session title if default
                sess = db_session.query(models.Session).filter(models.Session.id == request.session_id).first()
                if sess and sess.name == "New Chat":
                    sess.name = request.query[:30] + ("..." if len(request.query) > 30 else "")
                db_session.commit()
            except Exception as e:
                print("Error saving message to DB:", e)
            finally:
                db_session.close()

    return StreamingResponse(
        db_saving_stream_wrapper(),
        media_type="application/x-ndjson"
    )

@app.post("/clear")
async def clear(
    session_id: Optional[str] = None,
    current_user: models.User = Depends(auth.get_current_user)
):
    try:
        if session_id:
            clear_session_vectors(session_id)
        return {"message": "Vectors cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static frontend
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
