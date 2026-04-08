import io
import json
import os
from typing import Optional

import requests
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO

app = FastAPI()

DEFAULT_MODEL_CANDIDATES = [
    os.getenv("YOLO_MODEL_PATH", "").strip(),
    "models/civic-issues.pt",
    "civic-issues.pt",
    "yolo11n.pt",
]
CONF_THRESHOLD = float(os.getenv("YOLO_CONF", "0.25"))
CATEGORY_MAP_PATH = os.getenv("CATEGORY_MAP_PATH", "category_map.json")

HEURISTIC_LABEL_MAP = {
    "traffic light": "broken_streetlight",
    "parking meter": "broken_streetlight",
    "fire hydrant": "water_leak",
    "wine glass": "garbage",
    "cup": "garbage",
    "bottle": "garbage",
}


class DetectRequest(BaseModel):
    image_url: str


def _resolve_model_path() -> tuple[str, bool]:
    seen = set()
    for candidate in DEFAULT_MODEL_CANDIDATES:
        normalized = candidate.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        if os.path.exists(normalized):
            is_custom = os.path.basename(normalized) != "yolo11n.pt"
            return normalized, is_custom
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
            with open(CATEGORY_MAP_PATH, "r", encoding="utf-8") as file:
                parsed = json.load(file)
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items()}
        except (OSError, json.JSONDecodeError):
            pass

    return {}


CATEGORY_MAP = _load_category_map()
MODEL_PATH, USING_CUSTOM_MODEL = _resolve_model_path()
model = YOLO(MODEL_PATH)


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


def _suggest_category(detections):
    if not detections:
        return None, "none"

    mapped = [item for item in detections if item["mappedLabel"] and item["mappingSource"] == "direct"]
    if mapped:
        best = max(mapped, key=lambda item: item["confidence"])
        return best["mappedLabel"], "direct"

    heuristic = [item for item in detections if item["mappedLabel"] and item["mappingSource"] == "heuristic"]
    if heuristic:
        best = max(heuristic, key=lambda item: item["confidence"])
        return best["mappedLabel"], "heuristic"

    return "other", "fallback"


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
        normalized_label = label.lower()
        mapped_label = CATEGORY_MAP.get(label, CATEGORY_MAP.get(normalized_label))
        mapping_source = "direct" if mapped_label else None
        if not mapped_label:
            mapped_label = HEURISTIC_LABEL_MAP.get(normalized_label)
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
