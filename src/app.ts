// src/app.ts
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

// Import routes
import locationRoutes from './routes/locations';
import authRoutes from './routes/auth';
import kycRoutes from './routes/kyc';
import adminKycRoutes from './routes/admin-kyc';
import flutterwaveRoutes from './routes/flutterwave.routes'; 
import productRoutes from './routes/products';
import productUploadRoutes from './routes/productUpload';
import productDraftRoutes from './routes/productDrafts'; 
import adminSellersRoutes from './routes/admin-sellers';
import messagesRouter from './routes/messages';
import adminCustomerRoutes from './routes/admin-customers';
import sellerRoutes from './routes/seller';
import sellerPublicRoutes from './routes/sellerPublicRoutes';
import buyerRoutes from "./routes/buyer";
import reviewsRouter from './routes/reviews';
import ordersRoutes from './routes/orders';
import requestsRoutes from './routes/requests';
import categoriesRoutes from './routes/categories';
import wishlistRoutes from './routes/wishlist';




const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(helmet());

// CORS - Allow all origins in development
app.use(cors({
  origin: true,  // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check route
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Bidoro Backend is running!',
    timestamp: new Date().toISOString()
  });
});

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to Bidoro API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      locations: '/api/locations'
    }
  });
});

// API Routes
app.use('/api/locations', locationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin/kyc', adminKycRoutes);
app.use('/api/flutterwave', flutterwaveRoutes);
app.use('/api/products', productRoutes);
app.use('/api/products', productUploadRoutes);
app.use('/api/products', productDraftRoutes); 
app.use('/api/admin/sellers', adminSellersRoutes);
app.use('/api/messages', messagesRouter);
app.use('/api/admin', adminCustomerRoutes);
app.use('/api/seller', sellerRoutes);
app.use("/api/buyer", buyerRoutes);
app.use('/api/sellers', sellerPublicRoutes);
app.use('/api/reviews', reviewsRouter);
app.use('/api/orders', ordersRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/wishlist', wishlistRoutes);


// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Route not found' 
  });
});

// Only listen in local development (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Bidoro Backend running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`🔐 Auth endpoints: http://localhost:${PORT}/api/auth`);
    console.log(`📍 Location endpoints: http://localhost:${PORT}/api/locations`);
  });
}

// Export for Vercel
export default app;