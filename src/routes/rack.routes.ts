import express, { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { authMiddleware } from '../middleware/auth.middleware';
import * as rackController from '../controllers/rack.controller';

const router: Router = express.Router();

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
  limits: { fileSize: 10 * 1024 * 1024 },
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

router.get('/', authMiddleware, rackController.getRacks);
router.post('/', authMiddleware, rackController.createRack);
router.post('/bulk-upload', authMiddleware, upload.single('file'), rackController.bulkUploadRacks);
router.put('/:id', authMiddleware, rackController.updateRack);
router.delete('/:id', authMiddleware, rackController.deleteRack);
router.patch('/:id/toggle', authMiddleware, rackController.toggleRackStatus);
router.get('/by-warehouse', authMiddleware, rackController.getRacksByWarehouse);

export default router;
