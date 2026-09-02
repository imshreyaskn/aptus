import os
import sys
import argparse
import logging
from pathlib import Path

# Add project root to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.app.config import settings
from backend.app.rag.indexer import build_faiss_index_for_role

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("ingest_corpus")


def main():
    parser = argparse.ArgumentParser(description="Ingest role knowledge corpora and build FAISS vector indexes.")
    parser.add_argument("--role", type=str, help="Specific role to ingest (default: all roles)", default=None)
    parser.add_argument("--force", action="store_true", help="Force rebuild existing FAISS indexes")
    parser.add_argument("--auto-if-missing", action="store_true", help="Only build if indexes are not yet present")
    args = parser.parse_args()

    roles_to_ingest = [args.role] if args.role else settings.ROLES

    logger.info(f"Starting corpus ingestion pipeline for {len(roles_to_ingest)} roles...")
    logger.info(f"Corpus directory: {settings.CORPUS_DIR}")
    logger.info(f"Index directory: {settings.INDEX_DIR}")

    for role in roles_to_ingest:
        logger.info(f"\n==============================\nIngesting Role: {role}\n==============================")
        try:
            res = build_faiss_index_for_role(role, force_rebuild=args.force)
            logger.info(f"Result for '{role}': {res}")
        except Exception as e:
            logger.error(f"Failed to build index for role '{role}': {e}", exc_info=True)

    logger.info("\nIngestion pipeline completed successfully.")


if __name__ == "__main__":
    main()
