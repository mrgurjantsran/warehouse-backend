import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import * as inboundController from '../controllers/inbound.controller';

const router: Router = express.Router();

// Multer configuration
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
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format'));
    }
  }
});

// Routes - 
router.post('/', authMiddleware, inboundController.createInboundEntry);
router.get('/master-data/:wsn', authMiddleware, inboundController.getMasterDataByWSN);
router.post('/bulk-upload', authMiddleware, upload.single('file'), inboundController.bulkInboundUpload);
router.post('/multi-entry', authMiddleware, inboundController.multiInboundEntry);
router.get('/', authMiddleware, inboundController.getInboundList);
router.get('/batches', authMiddleware, inboundController.getInboundBatches);
router.delete('/batches/:batchId', authMiddleware, inboundController.deleteInboundBatch);
router.get('/racks/:warehouseId', authMiddleware, inboundController.getWarehouseRacks);
router.get('/brands', authMiddleware, inboundController.getUniqueBrands);
router.get('/categories', authMiddleware, inboundController.getUniqueCategories);
router.get('/brands', authMiddleware, inboundController.getBrands);
router.get('/categories', authMiddleware, inboundController.getCategories);
router.get('/brands', authMiddleware, inboundController.getBrands);
router.get('/categories', authMiddleware, inboundController.getCategories);


// router.post('/single', authMiddleware, inboundController.createInboundEntry);
// router.post('/bulk', authMiddleware, upload.single('file'), inboundController.bulkInboundUpload);
// router.post('/multi', authMiddleware, inboundController.multiInboundEntry);

export default router;



