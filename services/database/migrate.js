import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgres://ws_admin:ws_secure_pass_2026@localhost:5433/whatsapp_automation';

const pool = new Pool({ connectionString });

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 [DB Migration] Iniciando comprobación de migraciones de Base de Datos...');

    // 1. Crear tabla de control de migraciones si no existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Obtener lista de migraciones ya aplicadas
    const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC;');
    const appliedMigrations = new Set(rows.map(r => r.name));

    // 3. Leer archivos de migración disponibles
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log('⚠️ [DB Migration] No existe el directorio de migraciones. Omitiendo.');
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let executedCount = 0;

    // 4. Ejecutar cada migración pendiente dentro de una transacción segura
    for (const file of migrationFiles) {
      if (appliedMigrations.has(file)) {
        continue;
      }

      console.log(`⏳ [DB Migration] Aplicando migración: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sqlContent = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query('BEGIN;');
        await client.query(sqlContent);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [file]);
        await client.query('COMMIT;');
        console.log(`✅ [DB Migration] Migración ${file} aplicada con éxito.`);
        executedCount++;
      } catch (err) {
        await client.query('ROLLBACK;');
        console.error(`❌ [DB Migration ERROR] Falló la migración ${file}:`, err.message);
        throw err;
      }
    }

    if (executedCount === 0) {
      console.log('✅ [DB Migration] La Base de Datos está actualizada. No hay migraciones pendientes.');
    } else {
      console.log(`🎉 [DB Migration] Se ejecutaron ${executedCount} migración(es) correctamente.`);
    }

  } catch (error) {
    console.error('💥 [DB Migration FATAL] Proceso de migración abortado:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
