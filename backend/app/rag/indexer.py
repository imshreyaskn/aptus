import os
import json
import re
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
import numpy as np
from pypdf import PdfReader
from backend.app.config import settings

logger = logging.getLogger(__name__)

# Lazy embedding model loader
_embedder = None


def get_embedding_model():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        logger.info(f"Loading SentenceTransformer embedding model: {settings.EMBEDDING_MODEL_NAME}")
        _embedder = SentenceTransformer(settings.EMBEDDING_MODEL_NAME)
    return _embedder


def role_to_slug(role: str) -> str:
    """Converts a role display name into a clean directory-safe slug."""
    slug = role.lower().replace("/", "_").replace(" ", "_").replace("-", "_")
    slug = re.sub(r"[^\w_]", "", slug)
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug



def chunk_text(
    text: str,
    doc_id: str,
    doc_title: str,
    chunk_size: int = 600,
    overlap: int = 90
) -> List[Dict[str, Any]]:
    """
    Recursively/semantically chunks text into word windows with metadata and section preservation.
    """
    # Split paragraphs by headers or blank lines
    paragraphs = re.split(r"\n\s*\n", text)
    chunks = []
    current_chunk_words = []
    current_section = "Overview"
    chunk_counter = 0

    for para in paragraphs:
        para_clean = para.strip()
        if not para_clean:
            continue

        # Header detection heuristic (e.g. # Title, Chapter X, Section Y, or UPPERCASE lines)
        first_line = para_clean.split("\n")[0].strip()
        if (first_line.startswith("#") or 
            first_line.lower().startswith("chapter") or 
            first_line.lower().startswith("section") or 
            (len(first_line) < 60 and first_line.isupper())):
            current_section = first_line.lstrip("#").strip()

        words = para_clean.split()
        if not words:
            continue

        if len(current_chunk_words) + len(words) > chunk_size and current_chunk_words:
            chunk_str = " ".join(current_chunk_words)
            chunk_id = f"{doc_id}_c{chunk_counter:04d}"
            chunks.append({
                "chunk_id": chunk_id,
                "doc_title": doc_title,
                "section": current_section,
                "text": chunk_str,
                "word_count": len(current_chunk_words)
            })
            chunk_counter += 1
            # Maintain overlap window
            current_chunk_words = current_chunk_words[-overlap:] if len(current_chunk_words) >= overlap else current_chunk_words

        current_chunk_words.extend(words)

    # Add final remaining chunk
    if current_chunk_words:
        chunk_str = " ".join(current_chunk_words)
        chunk_id = f"{doc_id}_c{chunk_counter:04d}"
        chunks.append({
            "chunk_id": chunk_id,
            "doc_title": doc_title,
            "section": current_section,
            "text": chunk_str,
            "word_count": len(current_chunk_words)
        })

    return chunks


def load_documents_from_dir(dir_path: Path) -> List[Dict[str, Any]]:
    """Loads all PDF, Markdown, and text files from a directory."""
    documents = []
    if not dir_path.exists():
        return documents

    for file_path in dir_path.glob("**/*"):
        if file_path.is_file():
            suffix = file_path.suffix.lower()
            doc_id = re.sub(r"[^\w]", "_", file_path.stem.lower())
            doc_title = file_path.stem.replace("_", " ").title()

            if suffix == ".pdf":
                try:
                    reader = PdfReader(str(file_path))
                    text_parts = []
                    for page in reader.pages:
                        t = page.extract_text()
                        if t:
                            text_parts.append(t)
                    full_text = "\n\n".join(text_parts)
                    documents.append({
                        "doc_id": doc_id,
                        "doc_title": doc_title,
                        "text": full_text
                    })
                except Exception as e:
                    logger.error(f"Error reading PDF {file_path}: {e}")
            elif suffix in [".txt", ".md"]:
                try:
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        full_text = f.read()
                    documents.append({
                        "doc_id": doc_id,
                        "doc_title": doc_title,
                        "text": full_text
                    })
                except Exception as e:
                    logger.error(f"Error reading text file {file_path}: {e}")

    return documents


def build_faiss_index_for_role(role: str, force_rebuild: bool = False) -> Dict[str, Any]:
    """
    Builds and persists a FAISS index and chunk metadata for a given role.
    """
    import faiss

    slug = role_to_slug(role)
    corpus_role_dir = settings.CORPUS_DIR / slug
    index_role_dir = settings.INDEX_DIR / slug
    index_role_dir.mkdir(parents=True, exist_ok=True)

    index_path = index_role_dir / "index.faiss"
    chunks_path = index_role_dir / "chunks.json"

    if index_path.exists() and chunks_path.exists() and not force_rebuild:
        logger.info(f"FAISS index already exists for {role} at {index_role_dir}")
        return {"status": "exists", "role": role, "slug": slug, "dir": str(index_role_dir)}

    docs = load_documents_from_dir(corpus_role_dir)
    if not docs:
        logger.warning(f"No corpus documents found in {corpus_role_dir} for role {role}")
        # Create minimal placeholder chunk to allow index initialization
        docs = [{
            "doc_id": f"{slug}_core_knowledge",
            "doc_title": f"{role} Core Knowledge Base",
            "text": f"Core technical foundation, design principles, algorithms, and best practices for {role}."
        }]

    all_chunks = []
    for doc in docs:
        doc_chunks = chunk_text(
            text=doc["text"],
            doc_id=doc["doc_id"],
            doc_title=doc["doc_title"],
            chunk_size=settings.CHUNK_SIZE,
            overlap=settings.CHUNK_OVERLAP
        )
        all_chunks.extend(doc_chunks)

    if not all_chunks:
        raise ValueError(f"No chunks generated for role {role}")

    # Compute embeddings
    embedder = get_embedding_model()
    texts = [c["text"] for c in all_chunks]
    embeddings = embedder.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
    embeddings = embeddings.astype(np.float32)

    # Build FAISS index (Inner Product on normalized vectors = Cosine Similarity)
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatIP(dimension)
    index.add(embeddings)

    # Save index and chunks metadata
    faiss.write_index(index, str(index_path))
    with open(chunks_path, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, indent=2)

    logger.info(f"Built FAISS index for {role}: {len(all_chunks)} chunks, dimension {dimension} -> {index_path}")
    return {
        "status": "built",
        "role": role,
        "slug": slug,
        "chunk_count": len(all_chunks),
        "dimension": dimension
    }
