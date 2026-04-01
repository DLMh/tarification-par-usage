import { VercelRequest, VercelResponse } from '@vercel/node';
import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { config } from "./config";
import { sequelize } from "./db";
import { createMigrator } from "./migrations";
import { Op } from "sequelize";
import {
  Device,
  Session,
  Tarif,
  Payment,
  Password,
  User,
  SessionStatus
} from "./models";
import { computePrice } from "./core/pricing";
import { generatePassword } from "./core/passwordGenerator";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*"
  }
});

app.use(cors());
app.use(express.json());

// Export pour Vercel
export default async (req: VercelRequest, res: VercelResponse) => {
  await app(req, res);
};
