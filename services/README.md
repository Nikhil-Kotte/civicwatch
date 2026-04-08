# Services

This folder contains the optional Python services used by the backend:

- `yolo`: YOLOv11n inference API (FastAPI)
- `pathway`: real-time aggregates/alerts API (FastAPI + Pathway)

## YOLO service

```bash
cd services/yolo
py -3.11 -m venv .venv311
. .venv311/Scripts/Activate.ps1
pip install -r requirements.txt
set YOLO_MODEL_PATH=models/civic-issues.pt
set CATEGORY_MAP_PATH=category_map.json
uvicorn app:app --host 0.0.0.0 --port 8001
```

Model loading order:

- `YOLO_MODEL_PATH` if it exists
- `models/civic-issues.pt`
- `civic-issues.pt`
- fallback `yolo11n.pt`

If you train a custom civic issue checkpoint, place it at `services/yolo/models/civic-issues.pt` and restart the service.

## Pathway service

```bash
cd services/pathway
py -3.11 -m venv .venv311
. .venv311/Scripts/Activate.ps1
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8002
```
