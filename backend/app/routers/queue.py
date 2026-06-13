from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.database import get_db
from app.models.models import QueueItem, PrintJob, UploadedFile, PrintStatus
from app.schemas.schemas import QueueItemResponse, QueueResponse, PrintJobCreate, PrintJobResponse
from typing import List
from datetime import datetime

router = APIRouter()

@router.get("/", response_model=QueueResponse)
async def get_queue(db: Session = Depends(get_db)):
    """Get current print queue"""
    items = db.query(QueueItem).order_by(QueueItem.position).all()
    return QueueResponse(
        items=[QueueItemResponse.from_orm(item) for item in items],
        total=len(items)
    )

@router.post("/add", response_model=QueueItemResponse)
async def add_to_queue(job: PrintJobCreate, db: Session = Depends(get_db)):
    """Add a print job to the queue"""
    
    # Verify file exists
    file = db.query(UploadedFile).filter(UploadedFile.id == job.file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Create print job
    print_job = PrintJob(**job.dict())
    db.add(print_job)
    db.flush()
    db.refresh(print_job)
    
    # Get next position in queue
    max_position = db.query(func.max(QueueItem.position)).scalar() or 0
    
    # Add to queue
    queue_item = QueueItem(
        job_id=print_job.id,
        position=max_position + 1,
        status=PrintStatus.PENDING
    )
    db.add(queue_item)
    db.commit()
    db.refresh(queue_item)
    
    return queue_item

@router.put("/reorder")
async def reorder_queue(order: dict, db: Session = Depends(get_db)):
    """Reorder queue items"""
    positions = order.get("positions", [])  # List of job IDs in desired order
    
    for idx, job_id in enumerate(positions, 1):
        queue_item = db.query(QueueItem).filter(QueueItem.job_id == job_id).first()
        if queue_item:
            queue_item.position = idx
            db.add(queue_item)
    
    db.commit()
    
    items = db.query(QueueItem).order_by(QueueItem.position).all()
    return QueueResponse(
        items=[QueueItemResponse.from_orm(item) for item in items],
        total=len(items)
    )

@router.delete("/remove/{job_id}")
async def remove_from_queue(job_id: int, db: Session = Depends(get_db)):
    """Remove a job from queue"""
    queue_item = db.query(QueueItem).filter(QueueItem.job_id == job_id).first()
    if not queue_item:
        raise HTTPException(status_code=404, detail="Job not in queue")
    
    # Get position to reorder remaining items
    removed_position = queue_item.position
    
    db.delete(queue_item)
    db.commit()
    
    # Reorder remaining items
    items = db.query(QueueItem).filter(QueueItem.position > removed_position).all()
    for item in items:
        item.position -= 1
        db.add(item)
    db.commit()
    
    return {"message": "Job removed from queue"}

@router.get("/next")
async def get_next_job(db: Session = Depends(get_db)):
    """Get next job to process from queue"""
    queue_item = db.query(QueueItem).filter(
        QueueItem.status == PrintStatus.PENDING
    ).order_by(QueueItem.position).first()
    
    if not queue_item:
        return {"message": "No pending jobs in queue"}
    
    job = db.query(PrintJob).filter(PrintJob.id == queue_item.job_id).first()
    if not job:
        return {"message": "Job not found"}
    
    return {
        "queue_item": QueueItemResponse.from_orm(queue_item),
        "job": PrintJobResponse.from_orm(job)
    }

@router.put("/job/{job_id}/status")
async def update_job_status(job_id: int, status_update: dict, db: Session = Depends(get_db)):
    """Update print job status"""
    job = db.query(PrintJob).filter(PrintJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if "status" in status_update:
        job.status = status_update["status"]
    if "progress" in status_update:
        job.progress = status_update["progress"]
    if "current_layer" in status_update:
        job.current_layer = status_update["current_layer"]
    if "total_layers" in status_update:
        job.total_layers = status_update["total_layers"]
    if "estimated_time_remaining" in status_update:
        job.estimated_time_remaining = status_update["estimated_time_remaining"]
    if "error_message" in status_update:
        job.error_message = status_update["error_message"]
    
    if status_update.get("status") == PrintStatus.PRINTING and not job.started_at:
        job.started_at = datetime.utcnow()
    if status_update.get("status") == PrintStatus.COMPLETED and not job.completed_at:
        job.completed_at = datetime.utcnow()
    
    # Update queue item status
    queue_item = db.query(QueueItem).filter(QueueItem.job_id == job_id).first()
    if queue_item:
        queue_item.status = status_update.get("status", queue_item.status)
    
    db.add(job)
    if queue_item:
        db.add(queue_item)
    db.commit()
    db.refresh(job)
    
    return PrintJobResponse.from_orm(job)

@router.get("/job/{job_id}", response_model=PrintJobResponse)
async def get_job(job_id: int, db: Session = Depends(get_db)):
    """Get print job details"""
    job = db.query(PrintJob).filter(PrintJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
