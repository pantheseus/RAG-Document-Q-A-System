import os
import shutil
import json
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from agents import create_multi_agent_system

# Directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHROMA_PATH = os.path.join(BASE_DIR, "chroma_db")
TEMP_UPLOADS_DIR = os.path.join(BASE_DIR, "temp_uploads")

# Global variables
_embeddings = None
_vector_store = None

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    return _embeddings

def get_vector_store():
    global _vector_store
    if _vector_store is None:
        embeds = get_embeddings()
        _vector_store = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeds)
    return _vector_store

def process_and_add_document(file_path: str, session_id: str, owner_id: str = "guest"):
    """Phase 1 & 2: Ingest document, split, embed, and tag with session_id and owner_id."""
    vstore = get_vector_store()
    
    # 1. Load document
    if file_path.endswith('.pdf'):
        loader = PyPDFLoader(file_path)
    elif file_path.endswith('.txt'):
        loader = TextLoader(file_path, autodetect_encoding=True)
    else:
        raise ValueError("Unsupported file format")
        
    documents = loader.load()
    
    # 2. Split text
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        add_start_index=True
    )
    chunks = text_splitter.split_documents(documents)
    
    # 3. Add to Vector Store with Metadata tagging
    if not chunks:
        return {"status": "error", "message": "No text found in document."}
        
    for chunk in chunks:
        chunk.metadata["session_id"] = str(session_id)
        chunk.metadata["owner_id"] = str(owner_id)
        
    vstore.add_documents(chunks)
    
    return {"status": "success", "message": f"Successfully processed {len(chunks)} chunks for session {session_id}."}

def clear_session_vectors(session_id: str):
    """Clears the vectors for a specific session."""
    vstore = get_vector_store()
    if vstore:
        try:
            vstore._collection.delete(where={"session_id": str(session_id)})
        except Exception as e:
            print(f"Error dropping documents for session {session_id}: {e}")

async def get_answer_stream(query: str, session_id: str, owner_id: str = "guest"):
    """Phase 3 & 4: Retrieve context and stream answer tokens via astream_events."""
    vstore = get_vector_store()
    
    if not vstore:
        yield json.dumps({"error": "Please upload a document first."}) + "\n"
        return
        
    if not os.environ.get("GROQ_API_KEY"):
        yield json.dumps({"error": "Please set your GROQ_API_KEY environment variable (or in .env) to use the Multi-Agent system."}) + "\n"
        return
        
    # Phase 3: Setup Retriever WITH Session & Owner Filter
    filter_dict = {"$and": [{"session_id": str(session_id)}, {"owner_id": str(owner_id)}]}
    
    retriever = vstore.as_retriever(
        search_type="similarity", 
        search_kwargs={
            "k": 4,
            "filter": filter_dict
        }
    )
    
    # Phase 4: Create LangGraph Multi-Agent system
    multi_agent_app = create_multi_agent_system(retriever)
    
    initial_state = {"question": query, "context": "", "sources": [], "final_answer": ""}
    
    # Use astream_events to get real-time tokens from the underlying LLM in the Editor node
    async for event in multi_agent_app.astream_events(initial_state, version="v2"):
        kind = event["event"]
        
        # Stream tokens
        if kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"].content
            if chunk:
                yield json.dumps({"chunk": chunk}) + "\n"
                
        # Capture sources from the researcher node output
        elif kind == "on_chain_end" and event["name"] == "researcher":
            sources = event["data"].get("output", {}).get("sources", [])
            if sources:
                yield json.dumps({"sources": sources}) + "\n"
