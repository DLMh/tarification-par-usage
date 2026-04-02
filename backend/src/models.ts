import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { sequelize } from "./db";

export class Device extends Model<
  InferAttributes<Device>,
  InferCreationAttributes<Device>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare type: string;
  declare createdAt: CreationOptional<Date>;
}

Device.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "created_at"
    }
  },
  { sequelize, tableName: "devices", underscored: true, timestamps: true, updatedAt: false }
);

export class Tarif extends Model<
  InferAttributes<Tarif>,
  InferCreationAttributes<Tarif>
> {
  declare id: CreationOptional<number>;
  declare label: string;
  declare pricePer15min: number;
  declare minimumPrice: number;
  declare createdAt: CreationOptional<Date>;
}

Tarif.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    label: { type: DataTypes.STRING, allowNull: false },
    pricePer15min: { type: DataTypes.INTEGER, allowNull: false, field: "price_per_15min" },
    minimumPrice: { type: DataTypes.INTEGER, allowNull: false, field: "minimum_price" },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
      defaultValue: DataTypes.NOW
    }
  },
  { sequelize, tableName: "tarifs", underscored: true, timestamps: true, updatedAt: false }
);

export type SessionStatus = "active" | "paused" | "finished";

export class Session extends Model<
  InferAttributes<Session>,
  InferCreationAttributes<Session>
> {
  declare id: CreationOptional<number>;
  declare deviceId: number;
  declare tarifId: number | null;
  declare startTime: Date;
  declare endTime: Date | null;
  declare durationMinutes: number | null;
  declare amount: number | null;
  declare status: SessionStatus;
  declare isPaid: CreationOptional<boolean>;
  declare accumulatedMinutes: CreationOptional<number>;
  declare lastResumedAt: CreationOptional<Date | null>;
  declare createdAt: CreationOptional<Date>;
}

Session.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    deviceId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "devices", key: "id" },
      field: "device_id"
    },
    tarifId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "tarifs", key: "id" },
      field: "tarif_id"
    },
    startTime: { type: DataTypes.DATE, allowNull: false, field: "start_time" },
    endTime: { type: DataTypes.DATE, allowNull: true, field: "end_time" },
    durationMinutes: { type: DataTypes.INTEGER, allowNull: true, field: "duration_minutes" },
    amount: { type: DataTypes.INTEGER, allowNull: true },
    status: {
      type: DataTypes.ENUM("active", "paused", "finished"),
      allowNull: false
    },
    isPaid: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_paid"
    },
    accumulatedMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: "accumulated_minutes"
    },
    lastResumedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "last_resumed_at"
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
      defaultValue: DataTypes.NOW
    }
  },
  { sequelize, tableName: "sessions", underscored: true, timestamps: true, updatedAt: false }
);

export class Password extends Model<
  InferAttributes<Password>,
  InferCreationAttributes<Password>
> {
  declare id: CreationOptional<number>;
  declare sessionId: number;
  declare password: string;
  declare createdAt: CreationOptional<Date>;
}

Password.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sessionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "sessions", key: "id" },
      field: "session_id"
    },
    password: { type: DataTypes.STRING, allowNull: false },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "created_at"
    }
  },
  { sequelize, tableName: "passwords", timestamps: true, updatedAt: false, underscored: true }
);

export class Payment extends Model<
  InferAttributes<Payment>,
  InferCreationAttributes<Payment>
> {
  declare id: CreationOptional<number>;
  declare sessionId: number;
  declare amount: number;
  declare paidAt: Date;
  declare createdAt: CreationOptional<Date>;
}

Payment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sessionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "sessions", key: "id" },
      field: "session_id"
    },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    paidAt: { type: DataTypes.DATE, allowNull: false, field: "paid_at" },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "created_at",
      defaultValue: DataTypes.NOW
    }
  },
  { sequelize, tableName: "payments", underscored: true, timestamps: true, updatedAt: false }
);

export class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare passwordHash: string;
  declare createdAt: CreationOptional<Date>;
}

User.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false, field: "password_hash" },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "created_at"
    }
  },
  { sequelize, tableName: "users", underscored: true, timestamps: true, updatedAt: false }
);

// Associations
Device.hasMany(Session, { foreignKey: "deviceId" });
Session.belongsTo(Device, { foreignKey: "deviceId" });

Tarif.hasMany(Session, { foreignKey: "tarifId" });
Session.belongsTo(Tarif, { foreignKey: "tarifId" });

Session.hasOne(Password, { foreignKey: "sessionId" });
Password.belongsTo(Session, { foreignKey: "sessionId" });

Session.hasOne(Payment, { foreignKey: "sessionId" });
Payment.belongsTo(Session, { foreignKey: "sessionId" });
