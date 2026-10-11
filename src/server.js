import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';

import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import propertiesRouter from './routes/properties.js';
import inspectionsRouter from './routes/inspections.js';
import paymentsRouter from './routes/payments.js';
import paymentAdminRouter from './routes/paymentAdmin.js';
import bookingsRouter from './routes/bookings.js';
import notificationsRouter from './routes/notifications.js';
import messagesRouter from './routes/messages.js';
import reviewsRouter from './routes/reviews.js';
import reportsRouter from './routes/reports.js';
import moderationRouter from './routes/moderation.js';
import studentRouter from './routes/student.js';
import profileRouter, { uploadRoot } from './routes/profile.js';
import marketplaceRouter from './routes/marketplace.js';

import path from 'path';
import fs from 'fs';

import { testDatabaseConnection } from './config/db.js';

dotenv.config();

const app = express();

/* -------------------------------------------------------
   REQUEST ID
------------------------------------------------------- */

const requestId = (req, res, next) => {
  const id = crypto.randomUUID();

  req.requestId = id;

  res.setHeader('X-Request-Id', id);

  next();
};

/* -------------------------------------------------------
   BASIC APP SETTINGS
------------------------------------------------------- */

app.disable('x-powered-by');

app.use(requestId);

/* -------------------------------------------------------
   SECURITY HEADERS
------------------------------------------------------- */

/*
  IMPORTANT:
  The frontend runs on localhost:5173 while the backend
  serves uploaded images from localhost:5000.

  Helmet's default Cross-Origin-Resource-Policy can block
  those images from being displayed by the frontend.

  "cross-origin" allows resources such as property images
  and videos to be loaded by the React frontend.
*/

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: 'cross-origin',
    },
  })
);

/* -------------------------------------------------------
   ENVIRONMENT SETTINGS
------------------------------------------------------- */

const PORT = Number(process.env.PORT || 5000);

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN ||
  'http://localhost:5173';

const CLIENT_BUILD_DIR = path.resolve(
  process.env.CLIENT_BUILD_DIR || './dist'
);

/* -------------------------------------------------------
   CORS
------------------------------------------------------- */

app.use(
  cors({
    origin: (origin, callback) => {
      const isLocalDevelopmentOrigin = /^http:\/\/localhost:\d+$/.test(origin || '');
      if (!origin || CLIENT_ORIGIN === '*' || origin === CLIENT_ORIGIN || isLocalDevelopmentOrigin) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed by CORS.'));
    },

    methods: [
      'GET',
      'POST',
      'PATCH',
      'PUT',
      'DELETE',
      'OPTIONS',
    ],

    allowedHeaders: [
      'Content-Type',
      'Authorization',
    ],

    credentials: false,
  })
);

/* -------------------------------------------------------
   AUTH RATE LIMITER
------------------------------------------------------- */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,

  limit: 60,

  standardHeaders: 'draft-8',

  legacyHeaders: false,

  message: {
    success: false,
    message:
      'Too many authentication requests. Please try again later.',
  },
});

/* -------------------------------------------------------
   JSON BODY PARSER
------------------------------------------------------- */

app.use(
  express.json({
    limit: '1mb',

    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

/* -------------------------------------------------------
   ROOT API
------------------------------------------------------- */

app.get('/', (req, res) => {
  res.json({
    success: true,

    name: 'StudentNest API',

    stage:
      'Backend Stage 8 — Reviews, Reports & Platform Management',
  });
});

/* -------------------------------------------------------
   API ROUTES
------------------------------------------------------- */

app.use(
  '/api/health',
  healthRouter
);

app.use(
  '/api/auth',
  authLimiter,
  authRouter
);

app.use(
  '/api/admin',
  adminRouter
);

app.use(
  '/api/properties',
  propertiesRouter
);

app.use(
  '/api/inspections',
  inspectionsRouter
);

app.use(
  '/api/payments',
  paymentsRouter
);

app.use(
  '/api/admin/payments',
  paymentAdminRouter
);

app.use(
  '/api/bookings',
  bookingsRouter
);

app.use(
  '/api/notifications',
  notificationsRouter
);

app.use(
  '/api/messages',
  messagesRouter
);

app.use(
  '/api/reviews',
  reviewsRouter
);

app.use(
  '/api/reports',
  reportsRouter
);

app.use(
  '/api/moderation',
  moderationRouter
);

app.use(
  '/api/student',
  studentRouter
);

app.use(
  '/api/profile',
  profileRouter
);

app.use(
  '/api/marketplace',
  marketplaceRouter
);

/* -------------------------------------------------------
   UPLOADED MEDIA
------------------------------------------------------- */

/*
  Property images/videos are served from uploadRoot.

  Example:

  http://localhost:5000/uploads/property-image.jpg
*/

app.use(
  '/uploads',
  express.static(uploadRoot, {
    fallthrough: false,
    maxAge: '1h',
  })
);

/* -------------------------------------------------------
   FRONTEND BUILD
------------------------------------------------------- */

if (fs.existsSync(CLIENT_BUILD_DIR)) {
  app.use(
    express.static(CLIENT_BUILD_DIR)
  );

  app.get('*', (req, res, next) => {
    /*
      Never send the React index.html for API or upload
      requests. Those requests must continue to their
      respective handlers.
    */

    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/uploads/')
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        CLIENT_BUILD_DIR,
        'index.html'
      )
    );
  });
}

/* -------------------------------------------------------
   404 HANDLER
------------------------------------------------------- */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found.',
  });
});

/* -------------------------------------------------------
   ERROR HANDLER
------------------------------------------------------- */

app.use(
  (err, req, res, next) => {
    console.error(
      `[${req.requestId}]`,
      err
    );

    const payload = {
      success: false,
      message: 'Internal server error.',
      requestId: req.requestId,
    };

    if (
      process.env.NODE_ENV !== 'production'
    ) {
      payload.error = err.message;
    }

    res.status(500).json(payload);
  }
);

/* -------------------------------------------------------
   START SERVER
------------------------------------------------------- */

app.listen(
  PORT,
  async () => {
    console.log(
      `StudentNest API running at http://localhost:${PORT}`
    );

    console.log(
      `Uploads directory: ${uploadRoot}`
    );

    try {
      await testDatabaseConnection();

      console.log(
        'Database connection established.'
      );
    } catch (error) {
      console.error(
        'Database connection failed:',
        error.message
      );

      console.log(
        'Check XAMPP MySQL and your backend/.env settings.'
      );
    }
  }
);