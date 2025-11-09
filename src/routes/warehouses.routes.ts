import express, { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.middleware';
import * as warehouseController from '../controllers/warehouses.controller';

const router: Router = express.Router();

router.get('/', authMiddleware, warehouseController.getWarehouses);
router.post('/', authMiddleware, adminOnly, warehouseController.createWarehouse);
router.put('/:id', authMiddleware, adminOnly, warehouseController.updateWarehouse);
router.delete('/:id', authMiddleware, adminOnly, warehouseController.deleteWarehouse);
router.patch('/:id/set-active', authMiddleware, warehouseController.setActiveWarehouse);

export default router;
