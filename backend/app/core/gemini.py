"""
Gemini LLM Client & Structured Output Generator
Interfaces with Google Generative AI with Pydantic validation and fallback factories.
"""

import json
import logging
import re
from typing import Type, TypeVar, Optional, Any, Callable, List
from pydantic import BaseModel
from backend.app.config import settings

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

# Lazy client singleton
_model_instance = None


def get_gemini_model():
    """
    Returns a configured GenerativeModel singleton instance.
    Falls back gracefully if API key is invalid or unavailable.
    """
    global _model_instance
    if _model_instance is not None:
        return _model_instance

    api_key = settings.GEMINI_API_KEY
    if not api_key:
        logger.warning("GEMINI_API_KEY is not set. Using local heuristic fallback for LLM generation.")
        return None

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        
        candidate_models = [
            settings.GEMINI_MODEL,
            "gemini-3.1-flash-lite",
            "gemini-3.6-flash",
            "gemini-2.5-flash-lite"
        ]
        
        for m_name in candidate_models:
            try:
                m = genai.GenerativeModel(
                    model_name=m_name,
                    generation_config={"temperature": 0.3}
                )
                _model_instance = m
                logger.info(f"Initialized Gemini model: {m_name}")
                return _model_instance
            except Exception as me:
                logger.warning(f"Failed to load model {m_name}: {me}")
                continue
                
        return _model_instance
    except Exception as e:
        logger.error(f"Failed to initialize google.generativeai model: {e}")
        return None


def _clean_json_markdown(raw_text: str) -> str:
    """Strips markdown code blocks, backticks, and extra whitespace from raw LLM output."""
    cleaned = raw_text.strip()
    # Match ```json ... ``` or ``` ... ```
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        cleaned = match.group(1).strip()
    elif cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).rstrip("`").strip()
    return cleaned


def generate_structured(
    prompt: Optional[str] = None,
    response_schema: Optional[Type[T]] = None,
    system_instruction: Optional[str] = None,
    fallback_factory: Optional[Callable[[], T]] = None,
    content_parts: Optional[List[Any]] = None
) -> T:
    """
    Generates structured output validated against a Pydantic schema using Gemini.
    Supports text prompts as well as multimodal content parts (e.g. PDF bytes).
    Falls back to intelligent mock heuristics if Gemini is unavailable or errors.
    """
    if response_schema is None:
        raise ValueError("response_schema must be provided for structured generation.")

    model = get_gemini_model()

    if model is not None:
        try:
            schema_json = json.dumps(response_schema.model_json_schema(), indent=2)
            formatting_instructions = (
                f"\n\nRespond ONLY with a valid JSON object strictly matching this JSON Schema:\n"
                f"{schema_json}\n"
                f"Do not include markdown code blocks, backticks, or any extraneous text. Just the raw JSON."
            )

            if content_parts:
                full_content = []
                if system_instruction:
                    full_content.append(f"System Instruction:\n{system_instruction}")
                full_content.extend(content_parts)
                if prompt:
                    full_content.append(f"User Request:\n{prompt}")
                full_content.append(formatting_instructions)
                response = model.generate_content(full_content)
            else:
                full_prompt = prompt or ""
                if system_instruction:
                    full_prompt = f"System Instruction:\n{system_instruction}\n\nUser Request:\n{prompt}"
                formatting_prompt = f"{full_prompt}{formatting_instructions}"
                response = model.generate_content(formatting_prompt)

            raw_text = response.text or ""
            cleaned_json_str = _clean_json_markdown(raw_text)
            parsed_data = json.loads(cleaned_json_str)
            return response_schema.model_validate(parsed_data)
        except Exception as e:
            logger.warning(f"Gemini structured generation failed: {e}. Attempting fallback.")

    if fallback_factory is not None:
        return fallback_factory()
    
    raise RuntimeError("LLM structured output generation failed and no fallback was provided.")
