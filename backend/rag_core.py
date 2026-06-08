import os
import shutil
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_community.llms import Ollama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage

# Directories
CHROMA_PATH = "chroma_db"
TEMP_UPLOADS_DIR = "temp_uploads"

# Embeddings (Runs locally, completely free)
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# Global variables
vector_store = None
chat_history = []

def init_db():
    global vector_store
    if os.path.exists(CHROMA_PATH):
        vector_store = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)
    else:
        # Create an empty collection initially if it doesn't exist
        vector_store = Chroma(persist_directory=CHROMA_PATH, embedding_function=embeddings)

init_db()

def process_and_add_document(file_path: str, session_id: str):
    """Phase 1 & 2: Ingest document, split, embed, and tag with session_id."""
    global vector_store
    
    # 1. Load document
    if file_path.endswith('.pdf'):
        loader = PyPDFLoader(file_path)
    elif file_path.endswith('.txt'):
        loader = TextLoader(file_path)
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
        # Preserve existing metadata but inject the session_id
        chunk.metadata["session_id"] = session_id
        
    vector_store.add_documents(chunks)
    
    return {"status": "success", "message": f"Successfully processed {len(chunks)} chunks for session {session_id}."}

def clear_database():
    """Clears the existing vector database."""
    global vector_store, chat_history
    if vector_store:
        try:
            vector_store.delete_collection()
        except Exception as e:
            print(f"Error dropping collection: {e}")
            
    # Re-initialize to create a fresh collection
    init_db()
    chat_history = []
    
from agents import create_multi_agent_system

import json

async def get_answer_stream(query: str, session_id: str):
    """Phase 3 & 4: Retrieve context and stream answer tokens via astream_events."""
    global vector_store
    
    if not vector_store:
        yield json.dumps({"error": "Please upload a document first."}) + "\n"
        return
        
    if not os.environ.get("GROQ_API_KEY"):
        yield json.dumps({"error": "Please set your GROQ_API_KEY environment variable (or in .env) to use the Multi-Agent system."}) + "\n"
        return
        
    # Phase 3: Setup Retriever WITH Session Filter
    retriever = vector_store.as_retriever(
        search_type="similarity", 
        search_kwargs={
            "k": 4,
            "filter": {"session_id": session_id}
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
