import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './backend/config/db.js';
import authRoutes from './backend/routes/authRoutes.js';
import profileRoutes from './backend/routes/profileRoutes.js';
import adminRoutes from './backend/admin/routes/adminRoutes.js';
import { seedAdmin } from './backend/admin/utils/adminSeed.js';

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      process.env.FRONTEND_URL || 'http://localhost:5174',
      process.env.API_GATEWAY_URL || 'http://localhost:8080',
      'http://localhost:5173',
      'http://localhost:5175',
      'http://localhost:8080',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080',
    ],
    credentials: true,
  })
);

// Connect to MongoDB
connectDB().then(() => seedAdmin());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Auth Service is running' });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to MUQAYYIM Auth Service',
    version: '1.0.0',
    docs: '/api-docs',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Service running on port ${PORT}`);
  console.log(`📊 MongoDB: ${process.env.MONGODB_URL}`);
});
