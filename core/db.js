// core/db.js
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'sql-server.k8s-6xckitb8',
  user: process.env.DB_USER || 'wiseos',
  password: process.env.DB_PASS || 'Jesus@2025',
  database: process.env.DB_NAME || 'wiseos',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export async function dbQuery(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('[DB Direct] Error:', error.message);
    throw error;
  }
}

// ====================== FONCTIONS UTILITAIRES ======================

export async function saveOTP(tenantId, recipient, code, type = 'default') {
  const sql = `INSERT INTO otp_codes (tenant_id, recipient, code, type, expires_at, used)
               VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 0)
               ON DUPLICATE KEY UPDATE code=VALUES(code), expires_at=VALUES(expires_at), used=0`;
  await dbQuery(sql, [tenantId, recipient, code, type]);
  return true;
}

export async function validateOTP(tenantId, recipient, code, type = 'default') {
  const sql = `SELECT id FROM otp_codes 
               WHERE tenant_id = ? AND recipient = ? AND code = ? AND type = ? 
               AND used = 0 AND expires_at > NOW() LIMIT 1`;
  const rows = await dbQuery(sql, [tenantId, recipient, code, type]);
  
  if (rows.length > 0) {
    await dbQuery("UPDATE otp_codes SET used = 1 WHERE id = ?", [rows[0].id]);
    return { valid: true };
  }
  return { valid: false };
}

export async function loadSession(tenantId) {
  const rows = await dbQuery("SELECT session_data FROM whatsapp_sessions WHERE tenant_id = ? LIMIT 1", [tenantId]);
  return rows.length > 0 ? JSON.parse(rows[0].session_data) : null;
}

export async function saveSession(tenantId, sessionData) {
  const data = JSON.stringify(sessionData);
  await dbQuery(`INSERT INTO whatsapp_sessions (tenant_id, session_data) 
                 VALUES (?, ?) ON DUPLICATE KEY UPDATE session_data = VALUES(session_data)`, 
                [tenantId, data]);
}