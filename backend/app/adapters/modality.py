"""
Voice and Text Adapters for Unified Turn Interface

Both adapters produce identical Turn objects. The graph never knows which modality produced a turn.
The only asymmetry is where physical interaction genuinely differs (recording/TTS vs typing/rendering).
"""

import logging
import uuid
from typing import Optional, Dict, Any
from backend.app.graph.state import Turn
from backend.app.core.gemini import transcribe_audio_groq, synthesize_speech_google

logger = logging.getLogger(__name__)


class TextAdapter:
    """
    Text modality adapter.
    
    Input: User types text and submits
    Output: Turn object with normalized_text
    
    STATELESS: Pure function, no instance state.
    """
    
    def submit_turn(self, text: str, session_id: str, current_state: Optional[Dict[str, Any]] = None) -> Turn:
        """
        Creates a Turn from typed text submission.
        
        Args:
            text: The typed text from the candidate
            session_id: Current session identifier
            current_state: Current graph state (optional, for future extensibility)
            
        Returns:
            Turn object with modality="text"
        """
        turn = Turn(
            modality="text",
            normalized_text=text.strip(),
            asr_confidence=1.0,  # Text has perfect confidence
            interruption_flag=False  # Text doesn't interrupt TTS
        )
        
        logger.info(f"TextAdapter: Created turn {turn.turn_id} with {len(text)} chars")
        return turn
    
    def render_response(self, text: str) -> Dict[str, Any]:
        """
        Renders agent response as text.
        
        Text rendering is near-instantaneous, so no interrupt mechanism needed.
        This is deliberately atomic - unlike TTS, there's no meaningful duration to interrupt.
        
        Args:
            text: Response text to render
            
        Returns:
            Dict with rendered text
        """
        return {
            "type": "text",
            "content": text,
            "rendered_at": True  # Instant render
        }


class VoiceAdapter:
    """
    Voice modality adapter.
    
    Implements push-to-talk interaction model:
    - Button press → record → button release → STT → Turn
    - Agent speaking + button press → stop TTS, start recording (manual interrupt)
    
    STATELESS DESIGN: All state is passed explicitly to avoid thread-safety issues
    and enable proper concurrency. No instance variables for recording/speaking state.
    
    No VAD or endpointing logic needed - the button solves that.
    """
    
    def start_recording(self, session_id: str, current_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Starts audio recording on button press.
        
        If agent is currently speaking (TTS playing), stops it immediately.
        This is the manual interrupt path - no VAD needed.
        
        Args:
            session_id: Current session identifier
            current_state: Current graph state containing agent_speaking_flag
            
        Returns:
            Updated state dict with is_recording=True and agent_speaking_flag=False if interrupted
        """
        was_speaking = current_state.get("agent_speaking_flag", False)
        
        if was_speaking:
            logger.info(f"VoiceAdapter: Interrupting TTS for session {session_id}")
            # Signal TTS cancellation (handled by frontend/player)
        
        # Return updated state instead of mutating instance variables
        updated_state = current_state.copy()
        updated_state["agent_speaking_flag"] = False
        updated_state["_recording_active"] = True
        updated_state["_audio_buffer"] = b""
        
        logger.info(f"VoiceAdapter: Started recording for session {session_id}")
        return updated_state
    
    def append_audio(self, audio_chunk: bytes, current_state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Appends audio data during recording.
        
        Args:
            audio_chunk: Raw audio bytes (WAV format preferred)
            current_state: Current graph state containing _audio_buffer
            
        Returns:
            Updated state dict with appended audio data
        """
        if not current_state.get("_recording_active", False):
            return current_state
        
        updated_state = current_state.copy()
        current_buffer = updated_state.get("_audio_buffer", b"")
        
        if audio_chunk:
            updated_state["_audio_buffer"] = current_buffer + audio_chunk
        
        return updated_state
    
    def stop_recording_and_transcribe(
        self, 
        session_id: str,
        current_state: Dict[str, Any],
        language: str = "en"
    ) -> tuple[Optional[Turn], Dict[str, Any]]:
        """
        Stops recording and transcribes via Groq STT.
        
        STATELESS: Takes current_state as parameter, returns (Turn, updated_state)
        
        Args:
            session_id: Current session identifier
            current_state: Current graph state containing _recording_active and _audio_buffer
            language: Language code for transcription
            
        Returns:
            Tuple of (Turn object or None, updated state dict)
        """
        if not current_state.get("_recording_active", False):
            logger.warning("VoiceAdapter: stop_recording called but not recording")
            return None, current_state
        
        # Clear recording state
        updated_state = current_state.copy()
        updated_state["_recording_active"] = False
        
        audio_buffer = updated_state.get("_audio_buffer", b"")
        
        if not audio_buffer or len(audio_buffer) == 0:
            logger.warning("VoiceAdapter: No audio data captured")
            # Clear buffer
            updated_state["_audio_buffer"] = None
            return None, updated_state
        
        # Transcribe via Groq
        stt_result = transcribe_audio_groq(
            audio_bytes=audio_buffer,
            language=language
        )
        
        # Clear buffer after capturing for STT call
        updated_state["_audio_buffer"] = None
        
        if stt_result.get("error"):
            logger.error(f"VoiceAdapter: STT failed - {stt_result['error']}")
            # Still create a Turn but with empty text and low confidence
            turn = Turn(
                modality="voice",
                normalized_text="",
                asr_confidence=0.0,
                interruption_flag=False
            )
        else:
            turn = Turn(
                modality="voice",
                normalized_text=stt_result.get("text", ""),
                asr_confidence=stt_result.get("confidence", 0.5),
                interruption_flag=False  # Will be set by graph if arrived during agent_speaking
            )
            
            logger.info(
                f"VoiceAdapter: Transcribed {len(turn.normalized_text)} chars "
                f"(confidence: {turn.asr_confidence:.2f})"
            )
        
        return turn, updated_state
    
    def speak_response(
        self, 
        text: str, 
        language_code: str = "en-US",
        current_state: Optional[Dict[str, Any]] = None
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Synthesizes speech via Google Cloud TTS (free tier standard voice).
        
        STATELESS: Takes current_state as parameter, returns (result, updated_state)
        
        Args:
            text: Text to synthesize
            language_code: BCP-47 language code
            current_state: Current graph state (optional)
            
        Returns:
            Tuple of (TTS result dict, updated state dict with agent_speaking_flag)
        """
        updated_state = current_state.copy() if current_state else {}
        updated_state["agent_speaking_flag"] = True
        
        tts_result = synthesize_speech_google(
            text=text,
            language_code=language_code
        )
        
        updated_state["agent_speaking_flag"] = False
        
        if tts_result.get("error"):
            logger.error(f"VoiceAdapter: TTS failed - {tts_result['error']}")
            error_result = {
                "type": "audio",
                "audio_content": b"",
                "error": tts_result["error"],
                "duration_ms": 0
            }
            return error_result, updated_state
        
        # Estimate duration from audio size (MP3 ~16KB/sec at typical quality)
        audio_size = len(tts_result.get("audio_content", b""))
        estimated_duration_ms = int((audio_size / 16000) * 1000)
        
        success_result = {
            "type": "audio",
            "audio_content": tts_result.get("audio_content", b""),
            "encoding": "mp3",
            "sample_rate_hertz": 24000,
            "duration_ms": estimated_duration_ms
        }
        
        return success_result, updated_state
    
    def cancel_speech(self, current_state: Dict[str, Any]) -> tuple[bool, Dict[str, Any]]:
        """
        Cancels ongoing TTS playback.
        
        Called when user presses push-to-talk button while agent is speaking.
        
        Args:
            current_state: Current graph state containing agent_speaking_flag
            
        Returns:
            Tuple of (was_speaking: bool, updated state dict)
        """
        was_speaking = current_state.get("agent_speaking_flag", False)
        
        updated_state = current_state.copy()
        
        if was_speaking:
            updated_state["agent_speaking_flag"] = False
            logger.info("VoiceAdapter: Speech cancelled by user interrupt")
            return True, updated_state
        
        return False, updated_state


def create_adapter(modality: str) -> TextAdapter | VoiceAdapter:
    """
    Factory function to create the appropriate adapter.
    
    Args:
        modality: "text" or "voice"
        
    Returns:
        Adapter instance for the specified modality
    """
    if modality == "voice":
        return VoiceAdapter()
    else:
        return TextAdapter()
