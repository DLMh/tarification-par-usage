import path from "path";
import { Sequelize } from "sequelize";
import { Umzug, SequelizeStorage } from "umzug";

export function createMigrator(sequelize: Sequelize) {
  const glob = path.join(__dirname, "migrations", "*.js").replace(/\\/g, "/");
  return new Umzug({
    migrations: {
      glob
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console
  });
}

