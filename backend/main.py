import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import shutil

from rag_core import process_and_add_document, get_answer_stream, clear_database, TEMP_UPLOADS_DIR

app = FastAPI(title="RAG-QA System")

# Allow CORS for development if frontend is served separately
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure temp directory exists
os.makedirs(TEMP_UPLOADS_DIR, exist_ok=True)

class ChatRequest(BaseModel):
    query: str
    session_id: str = "default_session"

@app.post("/upload")
async def upload_file(file: UploadFile = File(...), session_id: str = Form("default_session")):
    if not file.filename.endswith(('.pdf', '.txt')):
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported")
        
    file_location = os.path.join(TEMP_UPLOADS_DIR, file.filename)
    
    # Save the file temporarily
    with open(file_location, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        # Process and index the document with the session_id
        result = process_and_add_document(file_location, session_id)
        if result["status"] == "error":
            raise HTTPException(status_code=500, detail=result["message"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Clean up temp file
        if os.path.exists(file_location):
            os.remove(file_location)
            
    return JSONResponse(content={"message": f"Successfully indexed {file.filename}"})

from fastapi.responses import JSONResponse, StreamingResponse

@app.post("/chat")
async def chat(request: ChatRequest):
    if not request.query:
        raise HTTPException(status_code=400, detail="Query cannot be empty")
        
    return StreamingResponse(
        get_answer_stream(request.query, request.session_id),
        media_type="application/x-ndjson"
    )

@app.post("/clear")
async def clear():
    try:
        clear_database()
        return {"message": "Database cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount the static frontend
# We mount it at / to serve the index.html and assets
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
