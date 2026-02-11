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
import sellerBankAccountRoutes from './routes/sellerBankAccount';
import buyerRoutes from './routes/buyer';
import reviewsRouter from './routes/reviews';
import ordersRoutes from './routes/orders';
import requestsRoutes from './routes/requests';
import categoriesRoutes from './routes/categories';
import wishlistRoutes from './routes/wishlist';
import auctionRoutes from './routes/auctions';
import sellerFeedbacksRoutes from './routes/sellerFeedbacks';
import referralRoutes from './routes/referral.routes';
import cronRoutes from './routes/cron';
import deliveryAddressRoutes from './routes/deliveryAddress';
import cartRoutes from './routes/cart';
import checkoutRoutes from './routes/checkout';
import searchRoutes from "./routes/search";
import oauthRoutes from './routes/oauth';

import adminDashboardRoutes from './routes/admin-dashboard';
import adminBudgetBidsRoutes from './routes/admin-budgetBids';
import adminSettingsRoutes from './routes/admin-settings';
import adminDisputesRoutes from './routes/admin-disputes';


import walletRoutes from './routes/walletRoutes';
import adminProductsRoutes from './routes/admin/products';
import reportsRoutes from './routes/reports';

import notificationRoutes from './routes/notification.routes';

import adminRequestsRoutes from './routes/admin/requests';

import adminUsersRouter from './routes/admin/admin-users';
import rolesRouter from './routes/admin/roles';
import adminOrdersRouter from './routes/admin/orders';
import contactRoutes from './routes/contact';


import supportRoutes from './routes/support';


const app = express();
const PORT = process.env.PORT || 3003;

// ====================
// Middleware
// ====================
app.use(helmet());

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization',
      'Cache-Control',
      'Pragma',
      'Expires'
    ],
  })
);

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ====================
// ✅ REDIRECT MIDDLEWARE - MUST BE BEFORE ROUTES
// Catch calls missing /api prefix and redirect them
// ====================
app.use((req, res, next) => {
  // Only redirect paths that start with /admin but not /api/admin
  if (req.path.startsWith('/admin') && !req.path.startsWith('/api/admin')) {
    const newPath = `/api${req.path}`;
    console.log(`[REDIRECT] ${req.method} ${req.path} -> ${newPath}`);
    
    // Use 307 to preserve the HTTP method (GET stays GET, POST stays POST)
    return res.redirect(307, newPath);
  }
  next();
});

// ====================
// Health check
// ====================
app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    message: 'Bidoro Backend is running!',
    timestamp: new Date().toISOString(),
  });
});

// ====================
// Root
// ====================
app.get('/', (_req, res) => {
  res.json({
    message: 'Welcome to Bidoro API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      locations: '/api/locations',
    },
  });
});

// ====================
// API Routes
// ====================
app.use('/api/locations', locationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/oauth', oauthRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/admin/kyc', adminKycRoutes);
app.use('/api/flutterwave', flutterwaveRoutes);

app.use('/api/products', productRoutes);
app.use('/api/products', productUploadRoutes);
app.use('/api/products', productDraftRoutes);

app.use('/api/admin/sellers', adminSellersRoutes);
app.use('/api/messages', messagesRouter);
app.use('/api/admin', adminCustomerRoutes);
app.use('/api/admin/products', adminProductsRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/sellers', sellerPublicRoutes);
app.use('/api/seller', sellerBankAccountRoutes); 
app.use('/api/buyer', buyerRoutes);

app.use('/api/reviews', reviewsRouter);
app.use('/api/orders', ordersRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/wishlist', wishlistRoutes);

app.use('/api/auctions', auctionRoutes);

app.use('/api/feedbacks', sellerFeedbacksRoutes);

app.use('/api/referral', referralRoutes);

app.use('/api/notifications', notificationRoutes);
app.use('/api/cron', cronRoutes);

app.use('/api/user/addresses', deliveryAddressRoutes);

app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);

app.use("/api/search", searchRoutes);

app.use('/api/admin/dashboard', adminDashboardRoutes);

app.use('/api/admin/budget-bids', adminBudgetBidsRoutes);

app.use('/api/admin/settings', adminSettingsRoutes);

app.use('/api/admin/disputes', adminDisputesRoutes);

app.use('/api/wallet', walletRoutes);
app.use('/api/admin/reports', reportsRoutes);
app.use('/api/admin/requests', adminRequestsRoutes);
app.use('/api/admin/admin-users', adminUsersRouter);
app.use('/api/admin/roles', rolesRouter);
app.use('/api/admin/orders', adminOrdersRouter);
app.use('/api/contact', contactRoutes);


app.use('/api/support', supportRoutes);



// ====================
// Global error handler
// ====================
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err.stack);
    res.status(500).json({
      success: false,
      message: 'Something went wrong!',
      error:
        process.env.NODE_ENV === 'development'
          ? err.message
          : undefined,
    });
  }
);

// ====================
// 404 handler - MUST BE LAST
// ====================
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ====================
// Local server only
// ====================
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 Bidoro Backend running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
  });
}

// Export for Vercel
export default app;