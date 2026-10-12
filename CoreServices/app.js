import express from 'express';
import cors from 'cors';
import authRoutes from './backend/routes/authRoutes.js';
import profileRoutes from './backend/routes/profileRoutes.js';
import generatedCvRoutes from './backend/routes/generatedCvRoutes.js';
import adminRoutes from './backend/admin/routes/adminRoutes.js';
import internalRoutes from './backend/routes/internalRoutes.js';

// Express app without DB connection or listen(), so tests can import it.
const app = express();

// Middleware
app.use(express.json({ limit: '1mb' }));
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

// Public API (reached through the API Gateway)
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/generated-cvs', generatedCvRoutes);
app.use('/api/admin', adminRoutes);

// Service-to-service API (X-Internal-Key). Not proxied by the gateway.
app.use('/internal', internalRoutes);

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

export default app;
