import { DataTypes, Sequelize, type QueryInterface } from "sequelize";

export async function up({ context: qi }: { context: QueryInterface }) {
  await qi.sequelize.transaction(async (transaction) => {
    const now = Sequelize.literal("NOW()");

    // devices
    await qi.createTable(
      "devices",
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        name: { type: DataTypes.STRING, allowNull: false },
        type: { type: DataTypes.STRING, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: now }
      },
      { transaction }
    );

    // tarifs
    await qi.createTable(
      "tarifs",
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        label: { type: DataTypes.STRING, allowNull: false },
        pricePer15min: { type: DataTypes.INTEGER, allowNull: false },
        minimumPrice: { type: DataTypes.INTEGER, allowNull: false }
      },
      { transaction }
    );

    // sessions + enum
    await qi.sequelize.query(
      `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_sessions_status') THEN
    CREATE TYPE enum_sessions_status AS ENUM ('active', 'paused', 'finished');
  END IF;
END$$;`,
      { transaction }
    );

    await qi.createTable(
      "sessions",
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        deviceId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: "devices", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "RESTRICT"
        },
        tarifId: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: "tarifs", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "SET NULL"
        },
        startTime: { type: DataTypes.DATE, allowNull: false },
        endTime: { type: DataTypes.DATE, allowNull: true },
        durationMinutes: { type: DataTypes.INTEGER, allowNull: true },
        amount: { type: DataTypes.INTEGER, allowNull: true },
        status: { type: "enum_sessions_status" as any, allowNull: false },
        isPaid: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        accumulatedMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        lastResumedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: now },
        updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: now }
      },
      { transaction }
    );

    // passwords
    await qi.createTable(
      "passwords",
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        sessionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: "sessions", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        password: { type: DataTypes.STRING, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: now }
      },
      { transaction }
    );

    // payments
    await qi.createTable(
      "payments",
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        sessionId: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: { model: "sessions", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        amount: { type: DataTypes.INTEGER, allowNull: false },
        paidAt: { type: DataTypes.DATE, allowNull: false }
      },
      { transaction }
    );

    // users
    await qi.createTable(
      "users",
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true
        },
        name: { type: DataTypes.STRING, allowNull: false },
        email: { type: DataTypes.STRING, allowNull: false, unique: true },
        passwordHash: { type: DataTypes.STRING, allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: now }
      },
      { transaction }
    );
  });
}

export async function down({ context: qi }: { context: QueryInterface }) {
  await qi.sequelize.transaction(async (transaction) => {
    await qi.dropTable("users", { transaction });
    await qi.dropTable("payments", { transaction });
    await qi.dropTable("passwords", { transaction });
    await qi.dropTable("sessions", { transaction });
    await qi.dropTable("tarifs", { transaction });
    await qi.dropTable("devices", { transaction });
    await qi.sequelize.query("DROP TYPE IF EXISTS enum_sessions_status;", { transaction });
  });
}

