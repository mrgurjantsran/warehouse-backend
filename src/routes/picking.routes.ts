import express from 'express';
import multer from 'multer';

import {
  getSourceByWSN,  
  multiPickingEntry,  
  getPickingList,  
  getCustomers,
  checkWSNExists,
  getExistingWSNs
} from '../controllers/picking.controller';

const router = express.Router();

// Multer configuration
const upload = multer({ dest: 'uploads/' });

// GET Routes
router.get('/source-by-wsn', getSourceByWSN);
router.get('/list', getPickingList);
router.get('/customers', getCustomers);
router.get('/check-wsn', checkWSNExists);
router.get('/existing-wsns', getExistingWSNs);

// POST Routes
router.post('/multi', multiPickingEntry);

export default router;