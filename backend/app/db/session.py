from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from backend.app.config import settings

connect_args = {"timeout": 30} if "sqlite" in settings.DATABASE_URL else {}

# Engine configuration supporting asyncpg (Postgres) and aiosqlite (SQLite)
engine = create_async_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    echo=False,
    future=True
)


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Safe column migration for existing SQLite databases
        try:
            await conn.execute(text("ALTER TABLE session_summaries ADD COLUMN recommendation VARCHAR(50)"))
        except Exception:
            pass
