"""
Gemini LLM Client & Structured Output Generator
Interfaces with Google Generative AI with Pydantic validation and fallback factories.
Also provides Groq STT adapter for voice transcription.
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
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash-exp",
            "gemini-1.5-flash"
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


def transcribe_audio_groq(audio_bytes: bytes, language: str = "en") -> dict:
    """
    Transcribes audio using Groq's free STT API.
    
    Args:
        audio_bytes: Raw audio data (WAV format preferred)
        language: Language code for transcription
        
    Returns:
        dict with keys:
            - text: transcribed text
            - confidence: confidence score (0-1)
            - segments: optional list of word-level segments with timestamps
    """
    import time
    start_time = time.time()
    logger.info(f"[STT][Groq Whisper] Received audio payload: {len(audio_bytes)} bytes | language={language}")

    groq_api_key = settings.GROQ_API_KEY
    if not groq_api_key:
        logger.warning("[STT][Groq Whisper] GROQ_API_KEY is not set. STT will fail.")
        return {"text": "", "confidence": 0.0, "error": "GROQ_API_KEY not configured"}
    
    try:
        from groq import Groq
        
        client = Groq(api_key=groq_api_key)
        
        # Groq requires file-like object, so we use BytesIO
        import io
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = "audio.wav"  # Hint the file type
        
        logger.info("[STT][Groq Whisper] Dispatching transcription request to whisper-large-v3-turbo...")
        transcription = client.audio.transcriptions.create(
            file=audio_file,
            model="whisper-large-v3-turbo",  # Groq's free whisper model
            language=language,
            response_format="verbose_json"  # Gets confidence and segments
        )
        
        elapsed_ms = (time.time() - start_time) * 1000
        text = transcription.text.strip()
        confidence = getattr(transcription, 'confidence', 1.0)
        segments = getattr(transcription, 'segments', [])

        result = {
            "text": text,
            "confidence": confidence,
            "segments": segments
        }
        
        logger.info(
            f"[STT][Groq Whisper] SUCCESS in {elapsed_ms:.1f}ms | "
            f"Confidence: {confidence:.2f} | Segments: {len(segments)} | Text: '{text[:120]}...'"
        )
        return result
        
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(f"[STT][Groq Whisper] FAILED after {elapsed_ms:.1f}ms: {e}")
        return {"text": "", "confidence": 0.0, "error": str(e)}


def synthesize_speech_google(text: str, language_code: str = "en-US") -> dict:
    """
    Synthesizes speech using Google Cloud TTS (free tier standard voice).
    
    Args:
        text: Text to synthesize
        language_code: BCP-47 language code
        
    Returns:
        dict with keys:
            - audio_content: base64-encoded audio bytes (MP3)
            - audio_config: config used for synthesis
    """
    import time
    start_time = time.time()
    logger.info(f"[TTS][Google Cloud] Received synthesis request for {len(text)} chars | lang={language_code} | preview: '{text[:80]}...'")

    google_creds = settings.GOOGLE_CLOUD_CREDENTIALS
    if not google_creds:
        logger.warning("[TTS][Google Cloud] GOOGLE_CLOUD_CREDENTIALS is not set. TTS will fail.")
        return {"audio_content": b"", "error": "GOOGLE_CLOUD_CREDENTIALS not configured"}
    
    try:
        from google.cloud import texttospeech
        import json
        
        # Load credentials from JSON string
        creds_info = json.loads(google_creds)
        from google.oauth2 import service_account
        credentials = service_account.Credentials.from_service_account_info(creds_info)
        
        client = texttospeech.TextToSpeechClient(credentials=credentials)
        
        synthesis_input = texttospeech.SynthesisInput(text=text)
        
        # Standard voice (free tier) - en-US-Standard-A
        voice = texttospeech.VoiceSelectionParams(
            language_code=language_code,
            name="en-US-Standard-A",  # Free tier standard voice
            ssml_gender=texttospeech.SsmlVoiceGender.FEMALE
        )
        
        # MP3 output (smaller, good for streaming)
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=1.0,
            pitch=0.0
        )
        
        logger.info("[TTS][Google Cloud] Calling synthesize_speech API with en-US-Standard-A...")
        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config
        )
        
        elapsed_ms = (time.time() - start_time) * 1000
        audio_bytes = response.audio_content
        logger.info(
            f"[TTS][Google Cloud] SUCCESS in {elapsed_ms:.1f}ms | Generated {len(audio_bytes)} bytes of MP3 audio"
        )

        result = {
            "audio_content": audio_bytes,
            "audio_config": {
                "encoding": "MP3",
                "sample_rate_hertz": 24000,
                "voice": "en-US-Standard-A"
            }
        }
        return result
        
    except Exception as e:
        elapsed_ms = (time.time() - start_time) * 1000
        logger.error(f"[TTS][Google Cloud] FAILED after {elapsed_ms:.1f}ms: {e}")
        return {"audio_content": b"", "error": str(e)}


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
