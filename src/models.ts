import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
  NonAttribute,
  Association
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
  declare updatedAt: CreationOptional<Date>;
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
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  { sequelize, tableName: "devices" }
);

export class Tarif extends Model<
  InferAttributes<Tarif>,
  InferCreationAttributes<Tarif>
> {
  declare id: CreationOptional<number>;
  declare label: string;
  declare pricePer15min: number;
  declare minimumPrice: number;
}

Tarif.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    label: { type: DataTypes.STRING, allowNull: false },
    pricePer15min: { type: DataTypes.INTEGER, allowNull: false },
    minimumPrice: { type: DataTypes.INTEGER, allowNull: false }
  },
  { sequelize, tableName: "tarifs", timestamps: false }
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
}

Session.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    deviceId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "devices", key: "id" }
    },
    tarifId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "tarifs", key: "id" }
    },
    startTime: { type: DataTypes.DATE, allowNull: false },
    endTime: { type: DataTypes.DATE, allowNull: true },
    durationMinutes: { type: DataTypes.INTEGER, allowNull: true },
    amount: { type: DataTypes.INTEGER, allowNull: true },
    status: {
      type: DataTypes.ENUM("active", "paused", "finished"),
      allowNull: false
    },
    isPaid: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    accumulatedMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    lastResumedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  { sequelize, tableName: "sessions" }
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
      references: { model: "sessions", key: "id" }
    },
    password: { type: DataTypes.STRING, allowNull: false },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  { sequelize, tableName: "passwords", updatedAt: false }
);

export class Payment extends Model<
  InferAttributes<Payment>,
  InferCreationAttributes<Payment>
> {
  declare id: CreationOptional<number>;
  declare sessionId: number;
  declare amount: number;
  declare paidAt: Date;
}

Payment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sessionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "sessions", key: "id" }
    },
    amount: { type: DataTypes.INTEGER, allowNull: false },
    paidAt: { type: DataTypes.DATE, allowNull: false }
  },
  { sequelize, tableName: "payments", updatedAt: false, createdAt: false }
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
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  { sequelize, tableName: "users", updatedAt: false }
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

