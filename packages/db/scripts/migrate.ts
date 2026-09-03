import { getDatabase, SCHEMA_SQL } from '../src/index.js';

async function main() {
  const db = await getDatabase(process.env.DATABASE_URL);
  if (db.store.supportsRaw()) {
    console.log('Applying database schema to Postgres...');
    await db.store.raw(SCHEMA_SQL);
    console.log('Schema applied successfully.');
  } else {
    console.log('In-memory store in use; no SQL schema migration needed.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
