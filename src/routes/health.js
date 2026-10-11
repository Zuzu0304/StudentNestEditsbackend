import { Router } from 'express';
import { testDatabaseConnection } from '../config/db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    await testDatabaseConnection();
    res.json({
      success: true,
      message: 'StudentNest API is running.',
      database: 'connected'
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    res.status(503).json({
      success: false,
      message: 'StudentNest API is running, but the database is not connected.',
      database: 'disconnected'
    });
  }
});

export default router;
