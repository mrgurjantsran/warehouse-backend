import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { initializeDatabase } from './config/database';
import authRoutes from './routes/auth.routes';
import warehousesRoutes from './routes/warehouses.routes';
import { errorHandler } from './middleware/errorHandler.middleware';
import inboundRoutes from './routes/inbound.routes';
import masterDataRoutes from './routes/master-data.routes';
import usersRoutes from './routes/users.routes';
import rackRoutes from './routes/rack.routes';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 
           'http://localhost:3001',
           'https://divine-wms-ft.vercel.app',
           'https://divine-wms-g5tto378c-gurjant-srans-projects.vercel.app',
           'https://divine-wms-ft-git-main-gurjant-srans-projects.vercel.app'
          ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}));

app.use(express.urlencoded({ limit: '500mb', extended: true }));
app.use(express.json({ limit: '500mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/warehouses', warehousesRoutes);
app.use('/api/inbound', inboundRoutes);
app.use('/api/master-data', masterDataRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/racks', rackRoutes);


// Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error Handler (must be last)
app.use(errorHandler);

// Initialize and Start Server
(async () => {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log('');
      console.log('========================================');
      console.log('  WAREHOUSE MANAGEMENT SYSTEM');
      console.log('========================================');
      console.log(`✓ Server running on http://localhost:${PORT}`);
      console.log(`✓ Health check: http://localhost:${PORT}/api/health`);
      console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✓ Database: Connected`);
      console.log('========================================');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
})();
export default app;











