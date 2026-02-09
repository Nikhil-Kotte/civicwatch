import io
import json
import os
from typing import Optional

import requests
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from PIL import Image
from ultralytics import YOLO

app = FastAPI()

MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolo11n.pt")
CONF_THRESHOLD = float(os.getenv("YOLO_CONF", "0.25"))

model = YOLO(MODEL_PATH)


class DetectRequest(BaseModel):
    image_url: str


def _load_image_from_url(url: str) -> Image.Image:
    response = requests.get(url, timeout=15)
    if response.status_code >= 400:
        raise HTTPException(status_code=400, detail="Failed to fetch image.")
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def _load_image_from_upload(file: UploadFile) -> Image.Image:
    content = file.file.read()
    return Image.open(io.BytesIO(content)).convert("RGB")


def _suggest_category(detections):
    if not detections:
        return None

    best = max(detections, key=lambda item: item["confidence"])
    return best["label"]


@app.post("/detect")
async def detect(payload: Optional[DetectRequest] = None, file: Optional[UploadFile] = File(None)):
    if not payload and not file:
        raise HTTPException(status_code=400, detail="Provide image_url or file.")

    if file is not None:
        image = _load_image_from_upload(file)
    else:
        image = _load_image_from_url(payload.image_url)

    results = model.predict(image, conf=CONF_THRESHOLD, verbose=False)[0]
    detections = []

    for box in results.boxes:
        label = results.names[int(box.cls)]
        conf = float(box.conf)
        bbox = [float(v) for v in box.xyxy[0].tolist()]
        detections.append({
            "label": label,
            "confidence": conf,
            "bbox": bbox,
        })

    return {
        "model": os.path.basename(MODEL_PATH),
        "detections": detections,
        "suggestedCategory": _suggest_category(detections),
    }
