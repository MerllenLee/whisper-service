from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.audio_processor import AudioProcessor
from app.config import (
    BACKEND_VAD_ENABLED,
    BACKEND_VAD_SILENCE_MS,
    BACKEND_VAD_SPEECH_PAD_MS,
    BACKEND_VAD_THRESHOLD,
    ASR_BACKEND,
    COMPUTE_TYPE,
    DEFAULT_LANGUAGE,
    DEVICE,
    STREAM_MODEL,
    WHISPER_CPP_URL,
)
from app.llm_client import generate_report
from app.whisper_client import transcribe as whisper_cpp_transcribe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# ──────────────────────────────────────────
# ASR 單例（僅未設定 WHISPER_CPP_URL 時使用）
# ──────────────────────────────────────────
_stream_model: Any = None
_model_lock = threading.Lock()


def _get_stream_model() -> Any:
    """Double-checked locking 取得 ASR backend 單例。"""
    global _stream_model
    if _stream_model is not None:
        return _stream_model
    with _model_lock:
        if _stream_model is not None:
            return _stream_model
        if ASR_BACKEND == "transformers":
            _stream_model = _load_transformers_model()
            return _stream_model

        from faster_whisper import WhisperModel  # 僅在需要時載入

        device = DEVICE
        compute_type = COMPUTE_TYPE
        if device == "auto":
            try:
                import ctranslate2

                device = "cuda" if "cuda" in ctranslate2.get_supported_compute_types("cuda") else "cpu"
            except Exception:
                device = "cpu"
        if device == "cuda" and compute_type == "int8":
            compute_type = "float16"
        logger.info("Loading model=%s device=%s compute_type=%s", STREAM_MODEL, device, compute_type)
        _stream_model = WhisperModel(STREAM_MODEL, device=device, compute_type=compute_type)
    return _stream_model


def _load_transformers_model() -> dict[str, Any]:
    """載入 PyTorch/Transformers Whisper 模型。"""
    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    device = DEVICE
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    logger.info("Loading transformers model=%s device=%s dtype=%s", STREAM_MODEL, device, dtype)
    processor = AutoProcessor.from_pretrained(STREAM_MODEL)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        STREAM_MODEL,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    ).to(device)
    model.eval()
    return {"backend": "transformers", "model": model, "processor": processor, "device": device, "dtype": dtype}


# ──────────────────────────────────────────
# HTTP endpoints
# ──────────────────────────────────────────


class ReportRequest(BaseModel):
    transcript: str
    indicator_code: str                  # 指標代碼，例如 A1、B12
    facility_type: str = "機構住宿式"    # 機構住宿式 / 綜合式
    facility_subtype: str | None = None  # 綜合式子類別：居家式 / 社區式-日間照顧 / ...


@router.post("/report", response_model=None)
async def report(req: ReportRequest) -> JSONResponse:
    """接收轉錄文字 + 指標代碼，呼叫 LLM 產生評鑑意見。"""
    if not req.transcript.strip():
        return JSONResponse({"error": "transcript 不可為空"}, status_code=400)
    if not req.indicator_code.strip():
        return JSONResponse({"error": "indicator_code 不可為空"}, status_code=400)
    try:
        result = await generate_report(
            req.transcript,
            indicator_code=req.indicator_code,
            facility_type=req.facility_type,
            facility_subtype=req.facility_subtype,
        )
        return JSONResponse(result)
    except Exception as e:
        logger.exception("LLM report error")
        return JSONResponse({"error": f"LLM 服務錯誤: {e}"}, status_code=502)


@router.get("/health", response_model=None)
async def health() -> JSONResponse:
    """健康檢查：確認 Whisper 後端已就緒。"""
    if not WHISPER_CPP_URL and _stream_model is None:
        return JSONResponse({"status": "loading"}, status_code=503)
    backend = "whisper.cpp" if WHISPER_CPP_URL else ASR_BACKEND
    return JSONResponse({"status": "ok", "backend": backend, "model": STREAM_MODEL})


# ──────────────────────────────────────────
# WebSocket /api/stream
#
# 前端協定：
#   送出：raw PCM16 LE, 16kHz, mono, 30ms/包（binary）
#   接收：
#     { "type": "connected" }
#     { "type": "processing" }
#     { "type": "transcription", "text": "..." }
#     { "type": "error", "message": "..." }
# ──────────────────────────────────────────

_WAV_MIN_BYTES = 1000


@router.websocket("/stream")
async def websocket_stream(ws: WebSocket) -> None:
    """即時語音串流轉錄 WebSocket 端點。"""
    await ws.accept()
    await ws.send_json({"type": "connected", "message": "WebSocket 已連接"})

    processor = AudioProcessor()

    async def _poll_and_transcribe() -> None:
        """每 200ms 輪詢一次，觸發轉錄並回傳結果。"""
        while True:
            await asyncio.sleep(0.2)
            if not processor.should_process():
                continue

            wav = processor.get_wav_bytes()
            processor.clear()

            if not wav or len(wav) < _WAV_MIN_BYTES:
                continue

            await ws.send_json({"type": "processing"})
            try:
                text = await _transcribe(wav)
                if text:
                    await ws.send_json({"type": "transcription", "text": text})
            except Exception:
                logger.exception("轉錄失敗")
                await ws.send_json({"type": "error", "message": "轉錄失敗，請重試"})

    poll_task = asyncio.create_task(_poll_and_transcribe())

    try:
        while True:
            msg = await ws.receive()
            if "bytes" in msg and msg["bytes"]:
                processor.add_frame(msg["bytes"])
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except asyncio.CancelledError:
        logger.info("WebSocket task cancelled")
    except Exception:
        logger.exception("WebSocket 非預期錯誤")
        try:
            await ws.send_json({"type": "error", "message": "伺服器內部錯誤"})
        except Exception:
            pass  # 連線已關閉時送訊息會再拋出，直接忽略
    finally:
        poll_task.cancel()
        try:
            await poll_task
        except asyncio.CancelledError:
            pass


# ──────────────────────────────────────────
# 轉錄策略：優先 whisper.cpp，否則依 ASR_BACKEND 選擇本機 backend
# ──────────────────────────────────────────


async def _transcribe(wav_bytes: bytes, language: str = DEFAULT_LANGUAGE) -> str:
    """依設定選擇 whisper.cpp 或 faster-whisper 進行轉錄。"""
    if WHISPER_CPP_URL:
        return await whisper_cpp_transcribe(wav_bytes, language)

    model = await asyncio.to_thread(_get_stream_model)
    if ASR_BACKEND == "transformers":
        return await asyncio.to_thread(_transcribe_transformers, model, wav_bytes, language)
    return await asyncio.to_thread(_transcribe_faster_whisper, model, wav_bytes, language)


def _transcribe_faster_whisper(model: Any, wav_bytes: bytes, language: str) -> str:
    """在 thread pool 中執行 faster-whisper 同步轉錄。"""
    import io

    wav_io = io.BytesIO(wav_bytes)
    transcribe_kwargs: dict[str, Any] = {
        "language": language if language != "auto" else None,
        "vad_filter": BACKEND_VAD_ENABLED,
        "condition_on_previous_text": True,
    }
    if BACKEND_VAD_ENABLED:
        transcribe_kwargs["vad_parameters"] = {
            "threshold": BACKEND_VAD_THRESHOLD,
            "min_silence_duration_ms": BACKEND_VAD_SILENCE_MS,
            "speech_pad_ms": BACKEND_VAD_SPEECH_PAD_MS,
        }
    segments, _ = model.transcribe(wav_io, **transcribe_kwargs)
    return "".join(seg.text for seg in segments)


def _transcribe_transformers(runtime: dict[str, Any], wav_bytes: bytes, language: str) -> str:
    """在 thread pool 中執行 PyTorch/Transformers Whisper 同步轉錄。"""
    import io

    import librosa
    import numpy as np
    import soundfile as sf
    import torch

    processor = runtime["processor"]
    model = runtime["model"]
    device = runtime["device"]
    dtype = runtime["dtype"]

    audio, sample_rate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)
    if sample_rate != 16000:
        audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
        sample_rate = 16000

    inputs = processor(audio, sampling_rate=sample_rate, return_tensors="pt")
    input_features = inputs.input_features.to(device=device, dtype=dtype)

    generate_kwargs: dict[str, Any] = {}
    if language and language != "auto":
        try:
            generate_kwargs["forced_decoder_ids"] = processor.get_decoder_prompt_ids(
                language=language,
                task="transcribe",
            )
        except Exception:
            logger.warning("Unsupported transformers language hint: %s", language)

    with torch.inference_mode():
        predicted_ids = model.generate(input_features, **generate_kwargs)
    return processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()
