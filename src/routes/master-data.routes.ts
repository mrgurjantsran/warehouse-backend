import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middleware/auth.middleware';
import * as masterDataController from '../controllers/master-data.controller';

const router: Router = express.Router();

// Create uploads directory
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}_${timestamp}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024,
    fieldSize: 500 * 1024 * 1024,
    files: 1,
    parts: 2
  },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls', '.csv'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format'));
    }
  }
});

// Routes - KEEP OLD NAMES for compatibility
router.get('/', authMiddleware, masterDataController.getMasterData);

// ✅ Upload FIRST, then auth
router.post('/upload', upload.single('file'), authMiddleware, masterDataController.uploadMasterData);

// OLD route names (with /upload prefix)
router.get('/upload/progress/:jobId', authMiddleware, masterDataController.getUploadProgress);
router.get('/upload/active', authMiddleware, masterDataController.getActiveUploads);
router.delete('/upload/cancel/:jobId', authMiddleware, masterDataController.cancelUpload);

// Other routes
router.get('/batches', authMiddleware, masterDataController.getBatches);
router.delete('/:id', authMiddleware, masterDataController.deleteMasterData);
router.delete('/batch/:batchId', authMiddleware, masterDataController.deleteBatch);
router.get('/export', authMiddleware, masterDataController.exportMasterData);

export default router;
