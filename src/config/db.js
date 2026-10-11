import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

dotenv.config();

const DB_MODE = (process.env.DB_MODE || "local").toLowerCase();
const isOnline = DB_MODE === "online";

if (!["local", "online"].includes(DB_MODE)) {
  throw new Error('DB_MODE must be either "local" or "online".');
}

const caPath = fileURLToPath(new URL("../../certs/ca.pem", import.meta.url));

const sslOptions = isOnline
  ? {
      ca: fs.readFileSync(caPath, "utf8"),
      rejectUnauthorized: true,
    }
  : undefined;

export const pool = mysql.createPool({
  host: isOnline
    ? process.env.ONLINE_DB_HOST
    : process.env.LOCAL_DB_HOST || "127.0.0.1",

  port: Number(
    isOnline
      ? process.env.ONLINE_DB_PORT || 12606
      : process.env.LOCAL_DB_PORT || 3306,
  ),

  user: isOnline
    ? process.env.ONLINE_DB_USER
    : process.env.LOCAL_DB_USER || "root",

  password: isOnline
    ? process.env.ONLINE_DB_PASSWORD
    : process.env.LOCAL_DB_PASSWORD || "",

  database: isOnline
    ? process.env.ONLINE_DB_NAME || "defaultdb"
    : process.env.LOCAL_DB_NAME || "studentnest",

  ...(isOnline ? { ssl: sslOptions } : {}),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  enableKeepAlive: true,
});

export async function testDatabaseConnection() {
  const connection = await pool.getConnection();

  try {
    await connection.ping();
    console.log(
      `MySQL connected successfully (${isOnline ? "ONLINE - Aiven" : "LOCAL - XAMPP"}).`,
    );
    return true;
  } finally {
    connection.release();
  }
}
