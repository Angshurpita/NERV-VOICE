import { getDatabase } from "../src/index.js";
import { ensureSeedData } from "../src/seed.js";

async function main() {
  const db = await getDatabase(process.env.DATABASE_URL);
  await ensureSeedData(db);
  console.log("Database seeded successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
