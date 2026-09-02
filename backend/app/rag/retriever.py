import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
import numpy as np
from backend.app.config import settings
from backend.app.rag.indexer import role_to_slug, get_embedding_model
from backend.app.schemas.interview import SourceChunkReference

logger = logging.getLogger(__name__)

# Cache of loaded indexes and chunk metadata
_loaded_indexes = {}


def get_role_index_and_chunks(role: str):
    import faiss

    slug = role_to_slug(role)
    if slug in _loaded_indexes:
        return _loaded_indexes[slug]

    index_role_dir = settings.INDEX_DIR / slug
    index_path = index_role_dir / "index.faiss"
    chunks_path = index_role_dir / "chunks.json"

    if not index_path.exists() or not chunks_path.exists():
        logger.warning(f"Index or chunks not found at {index_role_dir}. Attempting to build.")
        from backend.app.rag.indexer import build_faiss_index_for_role
        build_faiss_index_for_role(role)

    if not index_path.exists() or not chunks_path.exists():
        raise FileNotFoundError(f"FAISS index for role '{role}' ({slug}) not found at {index_role_dir}")

    index = faiss.read_index(str(index_path))
    with open(chunks_path, "r", encoding="utf-8") as f:
        chunks = json.load(f)

    _loaded_indexes[slug] = (index, chunks)
    return index, chunks


def retrieve_chunks(
    role: str,
    query: str,
    top_k: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Retrieves the top-k most relevant knowledge chunks for a query from the role's FAISS index.
    """
    k = top_k or settings.TOP_K_CHUNKS

    try:
        index, chunks = get_role_index_and_chunks(role)
    except Exception as e:
        logger.error(f"Error retrieving index for role {role}: {e}")
        return [{
            "chunk_id": "fallback_001",
            "book": f"{role} Core Knowledge",
            "section": "Core Concepts",
            "text": f"Foundational concepts, trade-offs, algorithms, and architectures relevant to {role}.",
            "score": 1.0
        }]

    embedder = get_embedding_model()
    query_vector = embedder.encode([query], convert_to_numpy=True, normalize_embeddings=True)
    query_vector = query_vector.astype(np.float32)

    actual_k = min(k, len(chunks))
    if actual_k == 0:
        return []

    distances, indices = index.search(query_vector, actual_k)

    results = []
    for rank, idx in enumerate(indices[0]):
        if idx >= 0 and idx < len(chunks):
            chunk = chunks[idx].copy()
            chunk["score"] = float(distances[0][rank])
            results.append(chunk)

    return results


def format_chunks_for_prompt(chunks: List[Dict[str, Any]]) -> str:
    """Formats retrieved chunks into a prompt-friendly grounded context block."""
    if not chunks:
        return "No specific book chunks retrieved."

    formatted_blocks = []
    for i, c in enumerate(chunks):
        chunk_id = c.get("chunk_id", f"chunk_{i}")
        doc_title = c.get("doc_title", "Knowledge Base")
        section = c.get("section", "General")
        text = c.get("text", "")
        formatted_blocks.append(
            f"--- [CHUNK {chunk_id}] (Source: {doc_title} | Section: {section}) ---\n{text}\n"
        )
    return "\n".join(formatted_blocks)
