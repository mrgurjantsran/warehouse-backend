import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth.middleware';
import * as ctrl from '../controllers/master-data.controller';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('Invalid file type'));
  }
});


router.get('/', authMiddleware, ctrl.getMasterData);
router.post('/upload', upload.single('file'), authMiddleware, ctrl.uploadMasterData);
router.get('/upload/progress/:jobId', authMiddleware, ctrl.getUploadProgress);
router.get('/upload/active', authMiddleware, ctrl.getActiveUploads);
router.delete('/upload/cancel/:jobId', authMiddleware, ctrl.cancelUpload);
router.get('/batches', authMiddleware, ctrl.getBatches);
router.delete('/:id', authMiddleware, ctrl.deleteMasterData);
router.delete('/batch/:batchId', authMiddleware, ctrl.deleteBatch);
router.get('/export', authMiddleware, ctrl.exportMasterData);

export default router;

