import os
import logging
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)

# Reads DATABASE_URL from .env file
POSTGRES_URL = os.environ.get("DATABASE_URL")
SQLITE_URL = "sqlite:///./docuquery.db"

engine = None
db_type = "sqlite"

if POSTGRES_URL:
    try:
        temp_engine = create_engine(POSTGRES_URL, pool_pre_ping=True)
        with temp_engine.connect() as conn:
            pass
        engine = temp_engine
        db_type = "postgresql"
        print("Connected to Supabase PostgreSQL database successfully!")
    except Exception as e:
        print(f"Could not connect to PostgreSQL ({e}). Falling back to local SQLite database.")
        engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    print("Using local database (docuquery.db).")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
