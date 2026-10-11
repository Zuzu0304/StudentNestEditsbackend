import 'dotenv/config';
import readline from 'readline';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/db.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));

try {
  const fullName = (await ask('Admin full name: ')).trim();
  const email = (await ask('Admin email: ')).trim().toLowerCase();
  const password = await ask('Admin password (8+ characters): ');
  if (!fullName || !email || password.length < 8) throw new Error('Name, email and an 8+ character password are required.');
  const hash = await bcrypt.hash(password, 12);
  const [existing] = await pool.execute('SELECT id FROM users WHERE email=? LIMIT 1',[email]);
  if (existing.length) {
    await pool.execute('UPDATE users SET full_name=?, password_hash=?, role="admin", is_verified=1, is_active=1 WHERE id=?',[fullName,hash,existing[0].id]);
    console.log('Existing account promoted to admin successfully.');
  } else {
    await pool.execute('INSERT INTO users (full_name,email,password_hash,role,is_verified,is_active) VALUES (?,?,?,"admin",1,1)',[fullName,email,hash]);
    console.log('Admin account created successfully.');
  }
} catch (error) { console.error(`Failed: ${error.message}`); process.exitCode=1; }
finally { rl.close(); await pool.end(); }
