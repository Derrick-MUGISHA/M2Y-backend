// src/app.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { connectDB } = require('./config/db');
const { cleanupExpiredMedia } = require('./controllers/media.controller');

// Import routes
const authRoutes = require('./routes/auth.routes');
const messageRoutes = require('./routes/message.routes');
const groupRoutes = require('./routes/group.routes');
const mediaRoutes = require('./routes/media.routes');

// Initialize express app
const app = express();

// Connect to database
connectDB();

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // CORS
app.use(express.json()); // Parse JSON
app.use(morgan('dev')); // Logging

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later'
});

// Apply rate limiting to all routes
app.use(limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/media', mediaRoutes);

// Home route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to M2You Secure Messaging API',
    status: 'API is running'
  });
});

// 404 handler
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Schedule periodic cleanup of expired media
const CLEANUP_INTERVAL = process.env.CLEANUP_INTERVAL || 60 * 60 * 1000; // 1 hour by default
setInterval(async () => {
  try {
    await cleanupExpiredMedia();
  } catch (error) {
    console.error('Scheduled media cleanup error:', error);
  }
}, CLEANUP_INTERVAL);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;