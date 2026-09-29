import pg from 'pg';
import Redis from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'db-connection' });

const { Pool } = pg;

// Connection pool for PostgreSQL
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ws_admin:ws_secure_pass_2026@localhost:5433/whatsapp_automation',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

// Redis client for cache and queues
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');

redis.on('connect', () => {
  logger.info('Connected to Redis');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis Connection Error');
});
