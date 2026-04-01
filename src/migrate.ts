import { sequelize } from "./db";
import { createMigrator } from "./migrations";

async function main() {
  const migrator = createMigrator(sequelize);
  const cmd = process.argv[2] ?? "up";

  if (cmd === "up") {
    await migrator.up();
    return;
  }
  if (cmd === "down") {
    await migrator.down();
    return;
  }
  if (cmd === "pending") {
    const pending = await migrator.pending();
    for (const m of pending) console.log(m.name);
    return;
  }
  if (cmd === "executed") {
    const executed = await migrator.executed();
    for (const m of executed) console.log(m.name);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

