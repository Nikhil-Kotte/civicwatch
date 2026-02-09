import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, List

import pathway as pw
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

# NOTE: This service keeps a lightweight in-memory view of recent reports and
# exposes aggregates. Replace the in-memory store with a Pathway streaming
# pipeline once your CDC or webhook ingestion is finalized.

RETENTION_MINUTES = int(os.getenv("PATHWAY_RETENTION_MINUTES", "120"))


class ReportEvent(BaseModel):
    id: str
    category: str
    status: str
    severity: str
    latitude: float
    longitude: float
    created_at: str


class Alert(BaseModel):
    type: str
    message: str
    report_id: str
    created_at: str


reports: Dict[str, ReportEvent] = {}
alerts: List[Alert] = []


def _prune_old_reports():
    cutoff = datetime.utcnow() - timedelta(minutes=RETENTION_MINUTES)
    remove_keys = []
    for report_id, report in reports.items():
        try:
            created = datetime.fromisoformat(report.created_at.replace("Z", "+00:00"))
        except ValueError:
            continue
        if created < cutoff:
            remove_keys.append(report_id)
    for key in remove_keys:
        reports.pop(key, None)


def _maybe_raise_alert(report: ReportEvent):
    if report.severity in {"urgent", "high"}:
        alerts.append(
            Alert(
                type="severity",
                message=f"High severity report: {report.category}",
                report_id=report.id,
                created_at=report.created_at,
            )
        )


@app.post("/ingest/report")
async def ingest_report(report: ReportEvent):
    reports[report.id] = report
    _maybe_raise_alert(report)
    _prune_old_reports()
    return {"status": "ok"}


@app.get("/summary")
async def summary():
    _prune_old_reports()
    total = len(reports)
    by_category = Counter(r.category for r in reports.values())
    by_status = Counter(r.status for r in reports.values())
    by_severity = Counter(r.severity for r in reports.values())

    return {
        "total": total,
        "byCategory": dict(by_category),
        "byStatus": dict(by_status),
        "bySeverity": dict(by_severity),
    }


@app.get("/heatmap")
async def heatmap(cell_size: float = 0.01):
    _prune_old_reports()
    if cell_size <= 0:
        raise HTTPException(status_code=400, detail="cell_size must be positive.")

    buckets = defaultdict(int)
    for report in reports.values():
        lat_bucket = round(report.latitude / cell_size) * cell_size
        lng_bucket = round(report.longitude / cell_size) * cell_size
        buckets[(lat_bucket, lng_bucket)] += 1

    return {
        "cellSize": cell_size,
        "cells": [
            {"lat": key[0], "lng": key[1], "count": count}
            for key, count in buckets.items()
        ],
    }


@app.get("/alerts")
async def get_alerts():
    return {"alerts": [alert.model_dump() for alert in alerts[-100:]]}
