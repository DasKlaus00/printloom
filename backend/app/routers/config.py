from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import RackConfiguration, RackSlot, SlotStatus
from app.schemas.schemas import RackConfigResponse, RackSlotResponse, RackConfigUpdate
from typing import List
from sqlalchemy import and_

router = APIRouter()

@router.get("/rack", response_model=RackConfigResponse)
async def get_rack_config(db: Session = Depends(get_db)):
    """Get current rack configuration"""
    rack = db.query(RackConfiguration).first()
    
    if not rack:
        # Create default rack configuration if doesn't exist
        rack = RackConfiguration(num_slots=6)
        db.add(rack)
        db.commit()
        db.refresh(rack)
        
        # Create slots
        for slot_num in range(1, 7):
            slot = RackSlot(rack_id=rack.id, slot_number=slot_num, status=SlotStatus.FREE)
            db.add(slot)
        db.commit()
    
    # Get all slots for this rack
    slots = db.query(RackSlot).filter(RackSlot.rack_id == rack.id).order_by(RackSlot.slot_number).all()
    
    return RackConfigResponse(
        id=rack.id,
        num_slots=rack.num_slots,
        slots=[RackSlotResponse.from_orm(slot) for slot in slots],
        created_at=rack.created_at,
        updated_at=rack.updated_at
    )

@router.put("/rack", response_model=RackConfigResponse)
async def update_rack_config(config: RackConfigUpdate, db: Session = Depends(get_db)):
    """Update rack configuration (number of slots)"""
    rack = db.query(RackConfiguration).first()
    
    if not rack:
        rack = RackConfiguration(num_slots=config.num_slots)
        db.add(rack)
        db.commit()
        db.refresh(rack)
    
    # Delete existing slots if number is reduced
    existing_slots = db.query(RackSlot).filter(RackSlot.rack_id == rack.id).count()
    if config.num_slots < existing_slots:
        slots_to_delete = db.query(RackSlot).filter(
            and_(RackSlot.rack_id == rack.id, RackSlot.slot_number > config.num_slots)
        ).all()
        for slot in slots_to_delete:
            db.delete(slot)
    
    # Add new slots if number is increased
    elif config.num_slots > existing_slots:
        for slot_num in range(existing_slots + 1, config.num_slots + 1):
            slot = RackSlot(rack_id=rack.id, slot_number=slot_num, status=SlotStatus.FREE)
            db.add(slot)
    
    rack.num_slots = config.num_slots
    db.add(rack)
    db.commit()
    db.refresh(rack)
    
    slots = db.query(RackSlot).filter(RackSlot.rack_id == rack.id).order_by(RackSlot.slot_number).all()
    
    return RackConfigResponse(
        id=rack.id,
        num_slots=rack.num_slots,
        slots=[RackSlotResponse.from_orm(slot) for slot in slots],
        created_at=rack.created_at,
        updated_at=rack.updated_at
    )

@router.get("/slot/{slot_id}", response_model=RackSlotResponse)
async def get_slot_status(slot_id: int, db: Session = Depends(get_db)):
    """Get status of a specific slot"""
    slot = db.query(RackSlot).filter(RackSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    return slot

@router.put("/slot/{slot_id}/status")
async def update_slot_status(slot_id: int, status: dict, db: Session = Depends(get_db)):
    """Update slot status manually"""
    slot = db.query(RackSlot).filter(RackSlot.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    
    if "status" in status:
        slot.status = status["status"]
    if "current_job_id" in status:
        slot.current_job_id = status["current_job_id"]
    
    db.add(slot)
    db.commit()
    db.refresh(slot)
    return RackSlotResponse.from_orm(slot)

@router.get("/")
async def get_all_config(db: Session = Depends(get_db)):
    """Get all system configuration"""
    return {
        "message": "Use /api/config/rack for rack configuration"
    }
