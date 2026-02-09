# Services

This folder contains the optional Python services used by the backend:

- `yolo`: YOLOv11n inference API (FastAPI)
- `pathway`: real-time aggregates/alerts API (FastAPI + Pathway)

## YOLO service

```bash
cd services/yolo
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
set YOLO_MODEL_PATH=yolo11n.pt
set CATEGORY_MAP={"pothole":"pothole","garbage":"garbage","broken_streetlight":"broken_streetlight","damaged_road":"damaged_road","water_leak":"water_leak"}
uvicorn app:app --host 0.0.0.0 --port 8001
```

## Pathway service

```bash
cd services/pathway
python -m venv .venv
. .venv/Scripts/Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8002
```
