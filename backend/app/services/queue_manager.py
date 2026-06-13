import logging
from typing import Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.models import (
    QueueItem, PrintJob, Device, PrintStatus, SlotStatus, 
    RackSlot, UploadedFile, PrinterType
)
from app.services.bambu_mqtt import BambuLabMQTT
from app.services.moonraker import MoonrakerAPI

logger = logging.getLogger(__name__)

class PrintQueueManager:
    def __init__(self, db: Session):
        self.db = db
        self.current_job: Optional[PrintJob] = None
        self.bambu_mqtt: Optional[BambuLabMQTT] = None
        self.moonraker: Optional[MoonrakerAPI] = None
    
    def initialize_connections(self) -> bool:
        """Initialize MQTT and Moonraker connections"""
        try:
            # Get Bambu Lab device
            bambu_device = self.db.query(Device).filter(
                Device.device_type == PrinterType.BAMBU_LAB
            ).first()
            
            if bambu_device and bambu_device.is_active:
                self.bambu_mqtt = BambuLabMQTT(bambu_device)
                if not self.bambu_mqtt.connect():
                    logger.warning("Failed to connect to Bambu Lab MQTT")
            
            # Get Klipper device
            klipper_device = self.db.query(Device).filter(
                Device.device_type == PrinterType.KLIPPER
            ).first()
            
            if klipper_device and klipper_device.is_active:
                self.moonraker = MoonrakerAPI(klipper_device)
            
            return True
        except Exception as e:
            logger.error(f"Error initializing connections: {str(e)}")
            return False
    
    def get_next_job(self) -> Optional[PrintJob]:
        """Get the next job from queue"""
        queue_item = self.db.query(QueueItem).filter(
            QueueItem.status == PrintStatus.PENDING
        ).order_by(QueueItem.position).first()
        
        if not queue_item:
            return None
        
        job = self.db.query(PrintJob).filter(PrintJob.id == queue_item.job_id).first()
        return job
    
    async def process_queue(self):
        """Process the print queue continuously"""
        logger.info("Starting queue processor")
        
        self.initialize_connections()
        
        while True:
            try:
                # Get next job
                job = self.get_next_job()
                if not job:
                    logger.debug("No pending jobs in queue")
                    await asyncio.sleep(5)
                    continue
                
                self.current_job = job
                await self._execute_workflow(job)
                
            except Exception as e:
                logger.error(f"Error processing queue: {str(e)}")
                await asyncio.sleep(5)
    
    async def _execute_workflow(self, job: PrintJob):
        """Execute the complete workflow for a print job"""
        try:
            logger.info(f"Starting workflow for job {job.id}")
            
            # Step 1: Send file to Bambu Lab via LAN
            await self._send_file_to_bambu(job)
            
            # Step 2: Start print on Bambu Lab
            await self._start_print(job)
            
            # Step 3: Monitor print progress
            await self._monitor_print(job)
            
            # Step 4: Handle print completion
            await self._handle_completion(job)
            
            logger.info(f"Workflow completed for job {job.id}")
        
        except Exception as e:
            logger.error(f"Workflow failed for job {job.id}: {str(e)}")
            job.error_message = str(e)
            job.status = PrintStatus.FAILED
            self.db.add(job)
            self.db.commit()
    
    async def _send_file_to_bambu(self, job: PrintJob):
        """Send file to Bambu Lab"""
        job.status = PrintStatus.UPLOADING
        self.db.add(job)
        self.db.commit()
        
        logger.info(f"Sending file to Bambu Lab for job {job.id}")
        # TODO: Implement FTP/LAN file transfer
    
    async def _start_print(self, job: PrintJob):
        """Start print on Bambu Lab"""
        job.status = PrintStatus.STARTING
        self.db.add(job)
        self.db.commit()
        
        logger.info(f"Starting print on Bambu Lab for job {job.id}")
        # TODO: Send start command via MQTT
    
    async def _monitor_print(self, job: PrintJob):
        """Monitor print progress"""
        job.status = PrintStatus.PRINTING
        self.db.add(job)
        self.db.commit()
        
        logger.info(f"Monitoring print progress for job {job.id}")
        # TODO: Monitor MQTT messages for progress
    
    async def _handle_completion(self, job: PrintJob):
        """Handle print completion and trigger post-print workflow"""
        if job.assigned_slot:
            # Trigger OTTOeject sequence
            await self._execute_ottoeject_sequence(job)
        
        job.status = PrintStatus.COMPLETED
        job.completed_at = datetime.utcnow()
        self.db.add(job)
        self.db.commit()
    
    async def _execute_ottoeject_sequence(self, job: PrintJob):
        """Execute the OTTOeject workflow"""
        try:
            logger.info(f"Executing OTTOeject sequence for job {job.id}")
            
            if not self.moonraker:
                raise Exception("Moonraker not initialized")
            
            # 1. Open door
            await self.moonraker.execute_macro("OPEN_DOOR_BAMBU_X_ONE_C")
            
            # 2. Eject plate
            await self.moonraker.execute_macro("EJECT_FROM_BAMBULAB_X_ONE_C")
            
            # 3. Store to slot
            await self.moonraker.execute_macro(f"STORE_TO_SLOT_{job.assigned_slot}")
            
            # 4. Close door
            await self.moonraker.execute_macro("CLOSE_DOOR_BAMBU_X_ONE_C")
            
            # Update rack slot status
            slot = self.db.query(RackSlot).filter(
                RackSlot.slot_number == job.assigned_slot
            ).first()
            if slot:
                slot.status = SlotStatus.OCCUPIED
                self.db.add(slot)
                self.db.commit()
            
            logger.info(f"OTTOeject sequence completed for job {job.id}")
        
        except Exception as e:
            logger.error(f"OTTOeject sequence failed: {str(e)}")
            raise
    
    def pause_queue(self):
        """Pause the queue"""
        logger.info("Pausing queue")
        if self.current_job:
            self.current_job.status = PrintStatus.PAUSED
            self.db.add(self.current_job)
            self.db.commit()
    
    def resume_queue(self):
        """Resume the queue"""
        logger.info("Resuming queue")
        if self.current_job:
            self.current_job.status = PrintStatus.PENDING
            self.db.add(self.current_job)
            self.db.commit()
    
    def shutdown(self):
        """Shutdown connections"""
        if self.bambu_mqtt:
            self.bambu_mqtt.disconnect()
