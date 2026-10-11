import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
const router=Router();
router.get('/readiness', requireAuth, requireRole('admin'), async(req,res,next)=>{try{await pool.query('SELECT 1'); const required=['studentnest_service_fee_percent','inspection_window_days']; const [rows]=await pool.query(`SELECT setting_key,setting_value FROM platform_settings WHERE setting_key IN (${required.map(()=>'?').join(',')})`,required); const settings=Object.fromEntries(rows.map(r=>[r.setting_key,r.setting_value])); const checks={database:true, jwtConfigured:Boolean(process.env.JWT_SECRET&&process.env.JWT_SECRET!=='replace-this-with-a-long-random-secret'), clientOriginConfigured:Boolean(process.env.CLIENT_ORIGIN), paymentModeConfigured:Boolean(process.env.PAYMENT_MODE), requiredSettings:required.every(k=>settings[k]!=null)}; res.json({success:Object.values(checks).every(Boolean),environment:process.env.NODE_ENV||'development',checks,settings});}catch(e){next(e)}});
router.post('/cleanup-sessions', requireAuth, requireRole('admin'), async(req,res,next)=>{try{const [r]=await pool.execute('DELETE FROM auth_sessions WHERE expires_at<=NOW() OR revoked_at IS NOT NULL');res.json({success:true,deletedSessions:r.affectedRows});}catch(e){next(e)}});
export default router;
