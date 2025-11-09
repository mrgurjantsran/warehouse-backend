import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import * as masterDataController from '../controllers/master-data.controller';

const router: Router = express.Router();

// Multer config with large file support
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    fieldSize: 500 * 1024 * 1024
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


router.get('/', authMiddleware, masterDataController.getMasterData);
router.post('/upload', authMiddleware, upload.single('file'), masterDataController.uploadMasterData);
router.get('/batches', authMiddleware, masterDataController.getBatches);
router.delete('/:id', authMiddleware, masterDataController.deleteMasterData);
router.delete('/batch/:batchId', authMiddleware, masterDataController.deleteBatch);
router.get('/upload/progress/:jobId', authMiddleware, masterDataController.getUploadProgress);
router.delete('/upload/cancel/:jobId', authMiddleware, masterDataController.cancelUpload);
router.get('/upload/active', authMiddleware, masterDataController.getActiveUploads);
router.get('/export', authMiddleware, masterDataController.exportMasterData);


export default router;
