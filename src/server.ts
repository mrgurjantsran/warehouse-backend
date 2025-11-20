import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import cookieParser from "cookie-parser";

import { initializeDatabase } from './config/database';
import authRoutes from './routes/auth.routes';
import warehousesRoutes from './routes/warehouses.routes';
import inboundRoutes from './routes/inbound.routes';
import masterDataRoutes from './routes/master-data.routes';
import usersRoutes from './routes/users.routes';
import rackRoutes from './routes/rack.routes';
import qcRoutes from './routes/qc.routes';
import pickingRoutes from './routes/picking.routes';
import { errorHandler } from './middleware/errorHandler.middleware';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// CORS (MUST BE FIRST)
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://divinewms.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 🔥 COOKIE PARSER MUST COME BEFORE ROUTES
app.use(cookieParser());

app.use(express.urlencoded({ limit: '1000mb', extended: true }));
app.use(express.json({ limit: '1000mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/warehouses', warehousesRoutes);
app.use('/api/inbound', inboundRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/racks', rackRoutes);
app.use('/api/qc', qcRoutes);
app.use('/api/picking', pickingRoutes);

// Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 404
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error Handler
app.use(errorHandler);

// Start Server
(async () => {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
})();

export default app;

