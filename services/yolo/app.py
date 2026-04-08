import io
import json
import os
from pathlib import Path
from typing import Optional

import requests
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO

app = FastAPI()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
CONF_THRESHOLD = float(os.getenv("YOLO_CONF", "0.25"))
CATEGORY_MAP_PATH = os.getenv("CATEGORY_MAP_PATH", "category_map.json")
MODELS_DIR = Path("models")

# Open-source pothole segmentation model (keremberke/yolov8n-pothole-segmentation)
# Falls back to yolo11n.pt if download fails or user overrides via env.
HF_MODEL_REPO = os.getenv("HF_MODEL_REPO", "keremberke/yolov8n-pothole-segmentation")
HF_MODEL_FILE = os.getenv("HF_MODEL_FILE", "best.pt")
CUSTOM_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "").strip()

# keremberke/yolov8n-pothole-segmentation detects: pothole
# Additional COCO-based heuristics for other civic categories
HEURISTIC_LABEL_MAP = {
    "pothole": "pothole",
    # COCO fallbacks for when using yolo11n.pt
    "traffic light": "broken_streetlight",
    "parking meter": "broken_streetlight",
    "fire hydrant": "water_leak",
    "wine glass": "garbage",
    "cup": "garbage",
    "bottle": "garbage",
    "trash can": "garbage",
}


class DetectRequest(BaseModel):
    image_url: str


# ---------------------------------------------------------------------------
# Model resolution — try user override → HuggingFace download → local yolo11n
# ---------------------------------------------------------------------------
def _download_hf_model() -> Optional[str]:
    dest = MODELS_DIR / HF_MODEL_FILE
    if dest.exists():
        return str(dest)
    try:
        from huggingface_hub import hf_hub_download
        MODELS_DIR.mkdir(exist_ok=True)
        path = hf_hub_download(repo_id=HF_MODEL_REPO, filename=HF_MODEL_FILE, local_dir=str(MODELS_DIR))
        print(f"[yolo] Downloaded {HF_MODEL_REPO}/{HF_MODEL_FILE} → {path}")
        return path
    except Exception as exc:
        print(f"[yolo] HuggingFace download failed ({exc}), falling back to yolo11n.pt")
        return None


def _resolve_model() -> tuple[str, bool]:
    # 1. Explicit override
    if CUSTOM_MODEL_PATH and os.path.exists(CUSTOM_MODEL_PATH):
        return CUSTOM_MODEL_PATH, True
    # 2. Already-cached custom model
    cached = MODELS_DIR / HF_MODEL_FILE
    if cached.exists():
        return str(cached), True
    # 3. Try downloading from HuggingFace
    downloaded = _download_hf_model()
    if downloaded:
        return downloaded, True
    # 4. Ship with yolo11n.pt
    return "yolo11n.pt", False


def _load_category_map() -> dict[str, str]:
    raw_map = os.getenv("CATEGORY_MAP", "").strip()
    if raw_map:
        try:
            parsed = json.loads(raw_map)
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items()}
        except json.JSONDecodeError:
            pass
    if os.path.exists(CATEGORY_MAP_PATH):
        try:
            with open(CATEGORY_MAP_PATH, "r", encoding="utf-8") as f:
                parsed = json.load(f)
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items()}
        except (OSError, json.JSONDecodeError):
            pass
    return {}


CATEGORY_MAP = _load_category_map()
MODEL_PATH, USING_CUSTOM_MODEL = _resolve_model()
model = YOLO(MODEL_PATH)
print(f"[yolo] Loaded model: {MODEL_PATH} (custom={USING_CUSTOM_MODEL})")


# ---------------------------------------------------------------------------
# Image loading helpers
# ---------------------------------------------------------------------------
def _load_image_from_url(url: str) -> Image.Image:
    session = requests.Session()
    session.trust_env = False
    try:
        response = session.get(url, timeout=15)
    except requests.RequestException as exc:
        raise HTTPException(status_code=400, detail="Failed to fetch image.") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail="Failed to fetch image.")
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def _load_image_from_upload(file: UploadFile) -> Image.Image:
    content = file.file.read()
    return Image.open(io.BytesIO(content)).convert("RGB")


# ---------------------------------------------------------------------------
# Category suggestion
# ---------------------------------------------------------------------------
def _suggest_category(detections):
    if not detections:
        return None, "none"
    mapped = [d for d in detections if d["mappedLabel"] and d["mappingSource"] == "direct"]
    if mapped:
        best = max(mapped, key=lambda d: d["confidence"])
        return best["mappedLabel"], "direct"
    heuristic = [d for d in detections if d["mappedLabel"] and d["mappingSource"] == "heuristic"]
    if heuristic:
        best = max(heuristic, key=lambda d: d["confidence"])
        return best["mappedLabel"], "heuristic"
    return "other", "fallback"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.post("/detect")
async def detect(request: Request, file: Optional[UploadFile] = File(None)):
    if file is not None:
        image = _load_image_from_upload(file)
    else:
        try:
            payload_data = await request.json()
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Provide image_url or file.") from exc
        try:
            payload = DetectRequest.model_validate(payload_data)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Provide image_url or file.") from exc
        image = _load_image_from_url(payload.image_url)

    results = model.predict(image, conf=CONF_THRESHOLD, verbose=False)[0]
    detections = []

    for box in results.boxes:
        label = str(results.names[int(box.cls)])
        conf = float(box.conf)
        bbox = [float(v) for v in box.xyxy[0].tolist()]
        normalized = label.lower()
        mapped_label = CATEGORY_MAP.get(label, CATEGORY_MAP.get(normalized))
        mapping_source = "direct" if mapped_label else None
        if not mapped_label:
            mapped_label = HEURISTIC_LABEL_MAP.get(normalized)
            mapping_source = "heuristic" if mapped_label else None
        detections.append({
            "label": label,
            "mappedLabel": mapped_label,
            "mappingSource": mapping_source,
            "confidence": conf,
            "bbox": bbox,
        })

    suggested_category, suggestion_source = _suggest_category(detections)

    return {
        "model": os.path.basename(MODEL_PATH),
        "modelPath": MODEL_PATH,
        "usingCustomModel": USING_CUSTOM_MODEL,
        "detections": detections,
        "suggestedCategory": suggested_category,
        "suggestionSource": suggestion_source,
    }


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": os.path.basename(MODEL_PATH),
        "modelPath": MODEL_PATH,
        "usingCustomModel": USING_CUSTOM_MODEL,
        "categoryMapPath": CATEGORY_MAP_PATH,
    }
