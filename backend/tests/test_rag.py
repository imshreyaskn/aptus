import pytest
from backend.app.rag.indexer import chunk_text, build_faiss_index_for_role, role_to_slug
from backend.app.rag.retriever import retrieve_chunks, format_chunks_for_prompt


def test_chunking_preserves_metadata():
    text = (
        "# Introduction to Neural Networks\n\n"
        "Neural networks learn representations through backpropagation and gradient descent. "
        "Each layer computes affine transformations followed by non-linear activations.\n\n"
        "# Optimization Algorithms\n\n"
        "Stochastic Gradient Descent updates parameters using mini-batches. "
        "Adam combines momentum with adaptive learning rates."
    )
    chunks = chunk_text(
        text=text,
        doc_id="test_doc",
        doc_title="Test ML Book",
        chunk_size=20,
        overlap=5
    )
    assert len(chunks) >= 2
    assert chunks[0]["doc_title"] == "Test ML Book"
    assert "chunk_id" in chunks[0]
    assert "section" in chunks[0]


def test_build_and_retrieve_faiss():
    role = "AI/ML Engineer"
    build_res = build_faiss_index_for_role(role, force_rebuild=True)
    assert build_res["status"] == "built"
    assert build_res["chunk_count"] > 0

    results = retrieve_chunks(role=role, query="backpropagation and gradient descent", top_k=2)
    assert len(results) > 0
    assert "text" in results[0]
    assert "chunk_id" in results[0]
    assert "score" in results[0]

    formatted = format_chunks_for_prompt(results)
    assert "CHUNK" in formatted
