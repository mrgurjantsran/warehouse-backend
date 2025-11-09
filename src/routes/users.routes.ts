import express, { Router } from 'express';
import { authMiddleware, adminOnly } from '../middleware/auth.middleware';
import * as usersController from '../controllers/users.controller';

const router: Router = express.Router();

router.get('/', authMiddleware, adminOnly, usersController.getUsers);
router.post('/', authMiddleware, adminOnly, usersController.createUser);
router.put('/:id', authMiddleware, adminOnly, usersController.updateUser);
router.delete('/:id', authMiddleware, adminOnly, usersController.deleteUser);

export default router;
