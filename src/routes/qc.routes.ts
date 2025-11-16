import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import * as qcController from '../controllers/qc.controller';

const router: Router = express.Router();

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 200 * 1024 * 1024 },
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

// Routes
router.post('/single', authMiddleware, qcController.createSingleQC);
router.post('/multi', authMiddleware, qcController.multiQCEntry);
router.post('/bulk', authMiddleware, upload.single('file'), qcController.bulkQCUpload);
router.get('/list', authMiddleware, qcController.getQCList);
router.get('/batches', authMiddleware, qcController.getQCBatches);
router.delete('/batch/:batchId', authMiddleware, qcController.deleteQCBatch);
router.get('/inbound/:wsn', authMiddleware, qcController.getInboundByWSN);
router.get('/brands', authMiddleware, qcController.getBrands);
router.get('/categories', authMiddleware, qcController.getCategories);
router.get('/existing-wsns', authMiddleware, qcController.getExistingWSNs);
router.get('/check-wsn', authMiddleware, qcController.checkWSNExists);
router.put('/:id', authMiddleware, qcController.updateSingleQC);
router.get('/existing-wsns', authMiddleware, qcController.getExistingWSNs);

export default router;