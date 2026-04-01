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

type ActiveSessionRuntime = {
  id: number;
  deviceId: number;
  accumulatedMinutes: number;
  lastResumedAt: Date;
};

type HistoryRange = "day" | "week" | "month";

const activeSessions = new Map<number, ActiveSessionRuntime>();
let globalTarifId: number | null = null;

io.on("connection", (socket) => {
  socket.emit("connected");
});

function broadcastSessionUpdate(sessionId: number) {
  io.emit("session:updated", { sessionId });
}

function computeRuntimeMinutes(runtime: ActiveSessionRuntime): number {
  const now = new Date().getTime();
  const last = runtime.lastResumedAt.getTime();
  const diffMinutes = (now - last) / 60000;
  return runtime.accumulatedMinutes + diffMinutes;
}

function getHistoryWindow(range: HistoryRange, anchorDate: Date) {
  const start = new Date(anchorDate);
  start.setHours(0, 0, 0, 0);

  if (range === "week") {
    const day = start.getDay(); // 0=Sun, 1=Mon...
    const diffToMonday = (day + 6) % 7;
    start.setDate(start.getDate() - diffToMonday);
  } else if (range === "month") {
    start.setDate(1);
  }

  const end = new Date(start);
  if (range === "day") {
    end.setDate(end.getDate() + 1);
  } else if (range === "week") {
    end.setDate(end.getDate() + 7);
  } else {
    end.setMonth(end.getMonth() + 1);
  }

  return { start, end };
}

setInterval(async () => {
  for (const runtime of activeSessions.values()) {
    const session = await Session.findByPk(runtime.id, {
      include: [Tarif, Device]
    });
    if (!session) continue;
    const minutes = Math.floor(computeRuntimeMinutes(runtime));
    const tarif = (session as any).Tarif as Tarif | null;
    let amount: number | null = null;
    if (tarif) {
      amount = computePrice(minutes, {
        pricePer15min: tarif.pricePer15min,
        minimumPrice: tarif.minimumPrice
      });
    }
    io.emit("session:tick", {
      sessionId: session.id,
      deviceId: session.deviceId,
      minutes,
      amount
    });
  }
}, 5000);

async function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (req.path === "/auth/login") return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = auth.substring("Bearer ".length);
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: number };
    (req as any).userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
}

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const user = await User.findOne({ where: { email } });
  if (!user) return res.status(401).json({ message: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: "Invalid credentials" });
  const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
    expiresIn: "8h"
  });
  res.json({ token });
});

app.use(authMiddleware);

app.get("/devices", async (_req, res) => {
  const devices = await Device.findAll({ order: [["id", "ASC"]] });
  const sessions = await Session.findAll({
    where: { status: "active" as SessionStatus }
  });
  const occupiedIds = new Set(sessions.map((s) => s.deviceId));
  res.json(
    devices.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      status: occupiedIds.has(d.id) ? "busy" : "free"
    }))
  );
});

app.post("/devices", async (req, res) => {
  const { name, type } = req.body as { name: string; type: string };
  const device = await Device.create({ name, type });
  res.status(201).json(device);
});

app.get("/tarifs", async (_req, res) => {
  const tarifs = await Tarif.findAll({ order: [["id", "ASC"]] });
  res.json(
    tarifs.map((t) => ({
      id: t.id,
      label: t.label,
      pricePer15min: t.pricePer15min,
      minimumPrice: t.minimumPrice
    }))
  );
});

app.post("/tarifs", async (req, res) => {
  const { label, pricePer15min, minimumPrice } = req.body as {
    label: string;
    pricePer15min: number;
    minimumPrice: number;
  };

  if (!label || label.trim().length === 0) {
    return res.status(400).json({ message: "Label is required" });
  }
  if (!Number.isInteger(pricePer15min) || pricePer15min <= 0) {
    return res.status(400).json({ message: "pricePer15min must be a positive integer" });
  }
  if (!Number.isInteger(minimumPrice) || minimumPrice < 0) {
    return res.status(400).json({ message: "minimumPrice must be a non-negative integer" });
  }

  const tarif = await Tarif.create({
    label: label.trim(),
    pricePer15min,
    minimumPrice
  });
  res.status(201).json(tarif);
});

app.put("/devices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const device = await Device.findByPk(id);
  if (!device) return res.status(404).json({ message: "Device not found" });
  const { name, type } = req.body as { name?: string; type?: string };
  if (name) device.name = name;
  if (type) device.type = type;
  await device.save();
  res.json(device);
});

app.delete("/devices/:id", async (req, res) => {
  const id = Number(req.params.id);
  const active = await Session.findOne({
    where: { deviceId: id, status: "active" as SessionStatus }
  });
  if (active) {
    return res
      .status(400)
      .json({ message: "Device has active session and cannot be deleted" });
  }
  await Device.destroy({ where: { id } });
  res.status(204).send();
});

app.post("/sessions/start", async (req, res) => {
  const { deviceId } = req.body as {
    deviceId: number;
  };
  const active = await Session.findOne({
    where: { deviceId, status: "active" as SessionStatus }
  });
  if (active) {
    return res
      .status(400)
      .json({ message: "Device already has an active session" });
  }
  const startTime = new Date();
  const defaultTarif =
    globalTarifId != null
      ? await Tarif.findByPk(globalTarifId)
      : await Tarif.findOne({ order: [["id", "ASC"]] });
  if (globalTarifId == null && defaultTarif) {
    globalTarifId = defaultTarif.id;
  }
  const session = await Session.create({
    deviceId,
    tarifId: defaultTarif?.id ?? null,
    startTime,
    endTime: null,
    durationMinutes: null,
    amount: null,
    status: "active",
    accumulatedMinutes: 0,
    lastResumedAt: startTime
  });
  activeSessions.set(session.id, {
    id: session.id,
    deviceId,
    accumulatedMinutes: 0,
    lastResumedAt: startTime
  });
  io.emit("session:started", { sessionId: session.id, deviceId });
  res.status(201).json(session);
});

app.put("/sessions/tarif/global", async (req, res) => {
  const { tarifId, password } = req.body as { tarifId: number; password: string };

  if (!Number.isInteger(tarifId)) {
    return res.status(400).json({ message: "Invalid tarifId" });
  }
  if (!password || password.trim().length === 0) {
    return res.status(400).json({ message: "Password is required" });
  }

  const ok = password === "Dola2851";
  if (!ok) return res.status(403).json({ message: "Invalid password" });

  const tarif = await Tarif.findByPk(tarifId);
  if (!tarif) return res.status(404).json({ message: "Tarif not found" });
  globalTarifId = tarif.id;

  const openSessions = await Session.findAll({
    where: { status: ["active", "paused"] as any }
  });

  for (const session of openSessions) {
    session.tarifId = tarif.id;
    const runtime = activeSessions.get(session.id);
    const minutes = runtime
      ? Math.floor(computeRuntimeMinutes(runtime))
      : session.accumulatedMinutes ?? 0;
    session.amount = computePrice(minutes, {
      pricePer15min: tarif.pricePer15min,
      minimumPrice: tarif.minimumPrice
    });
    await session.save();
    io.emit("session:updated", { sessionId: session.id });
  }

  res.json({
    tarifId: tarif.id,
    updatedSessions: openSessions.length
  });
});

app.post("/sessions/:id/pause", async (req, res) => {
  const id = Number(req.params.id);
  const session = await Session.findByPk(id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status !== "active") {
    return res.status(400).json({ message: "Session not active" });
  }

  const runtime = activeSessions.get(id);

  let totalMinutes = session.accumulatedMinutes ?? 0;

  if (runtime) {
    totalMinutes = Math.floor(computeRuntimeMinutes(runtime));
    activeSessions.delete(id);
  } else if (session.lastResumedAt) {
    const nowMs = Date.now();
    const lastMs = session.lastResumedAt.getTime();
    const diffMinutes = (nowMs - lastMs) / 60000;
    totalMinutes = Math.floor((session.accumulatedMinutes ?? 0) + diffMinutes);
  }

  session.accumulatedMinutes = totalMinutes;
  session.lastResumedAt = null;
  session.status = "paused";

  await session.save();
  io.emit("session:paused", { sessionId: id });
  res.json(session);
});

app.post("/sessions/:id/resume", async (req, res) => {
  const id = Number(req.params.id);
  const session = await Session.findByPk(id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status !== "paused") {
    return res.status(400).json({ message: "Session not paused" });
  }
  const now = new Date();
  session.status = "active";
  session.lastResumedAt = now;
  await session.save();
  activeSessions.set(id, {
    id,
    deviceId: session.deviceId,
    accumulatedMinutes: session.accumulatedMinutes ?? 0,
    lastResumedAt: now
  });
  io.emit("session:resumed", { sessionId: id });
  res.json(session);
});

app.post("/sessions/:id/stop", async (req, res) => {
  const id = Number(req.params.id);
  const session = await Session.findByPk(id, { include: [Tarif] });
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status === "finished") {
    return res.status(400).json({ message: "Session already finished" });
  }
  const runtime = activeSessions.get(id);
  let totalMinutes = session.accumulatedMinutes ?? 0;
  if (runtime) {
    totalMinutes = Math.floor(computeRuntimeMinutes(runtime));
    activeSessions.delete(id);
  }
  const endTime = new Date();
  session.endTime = endTime;
  session.status = "finished";
  session.durationMinutes = totalMinutes;
  const tarif = (session as any).Tarif as Tarif | null;
  if (tarif) {
    session.amount = computePrice(totalMinutes, {
      pricePer15min: tarif.pricePer15min,
      minimumPrice: tarif.minimumPrice
    });
  }
  await session.save();
  io.emit("session:stopped", { sessionId: id });
  res.json(session);
});

app.get("/sessions/active", async (_req, res) => {
  const sessions = await Session.findAll({
    where: { status: "active" as SessionStatus },
    include: [Device, Tarif]
  });
  const result = sessions.map((s) => {
    const runtime = activeSessions.get(s.id);
    const minutes = runtime
      ? Math.floor(computeRuntimeMinutes(runtime))
      : s.accumulatedMinutes ?? 0;
    const tarif = (s as any).Tarif as Tarif | null;
    const amount =
      tarif != null
        ? computePrice(minutes, {
            pricePer15min: tarif.pricePer15min,
            minimumPrice: tarif.minimumPrice
          })
        : null;
    return {
      id: s.id,
      deviceId: s.deviceId,
      deviceName: (s as any).Device?.name,
      minutes,
      amount,
      status: s.status
    };
  });
  res.json(result);
});
app.get("/sessions/open", async (_req, res) => {
  const sessions = await Session.findAll({
    where: { status: ["active", "paused"] as any },
    include: [Device, Tarif]
  });

  const result = sessions.map((s) => {
    const isActive = s.status === "active";
    const runtime = isActive ? activeSessions.get(s.id) : undefined;

    const minutes = runtime
      ? Math.floor(computeRuntimeMinutes(runtime))
      : (s.accumulatedMinutes ?? 0);

    const tarif = (s as any).Tarif as Tarif | null;
    const amount =
      tarif != null
        ? computePrice(minutes, {
            pricePer15min: tarif.pricePer15min,
            minimumPrice: tarif.minimumPrice
          })
        : null;

    return {
      id: s.id,
      deviceId: s.deviceId,
      deviceName: (s as any).Device?.name,
      minutes,
      amount,
      status: s.status
    };
  });

  res.json(result);
});

app.get("/sessions/history", async (req, res) => {
  const rawRange = String(req.query.range ?? "day");
  const range: HistoryRange =
    rawRange === "week" || rawRange === "month" ? rawRange : "day";

  const rawDate = typeof req.query.date === "string" ? req.query.date : null;
  const anchor = rawDate != null ? new Date(rawDate) : new Date();
  const anchorDate = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  const { start, end } = getHistoryWindow(range, anchorDate);

  const sessions = await Session.findAll({
    where: {
      status: "finished" as SessionStatus,
      endTime: {
        [Op.gte]: start,
        [Op.lt]: end
      } as any
    },
    include: [Device],
    order: [["endTime", "DESC"]]
  });

  const rows = sessions.map((s) => ({
    id: s.id,
    deviceId: s.deviceId,
    deviceName: (s as any).Device?.name ?? null,
    startTime: s.startTime,
    endTime: s.endTime,
    minutes: s.durationMinutes ?? 0,
    amount: s.amount ?? 0
  }));

  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

  res.json({
    range,
    start,
    end,
    totalAmount,
    count: rows.length,
    rows
  });
});

app.post("/sessions/:id/password", async (req, res) => {
  const id = Number(req.params.id);
  const session = await Session.findByPk(id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  const pwd = generatePassword();
  let record = await Password.findOne({ where: { sessionId: id } });
  if (record) {
    record.password = pwd;
    await record.save();
  } else {
    record = await Password.create({ sessionId: id, password: pwd });
  }
  res.json({ password: record.password });
});

app.post("/sessions/:id/pay", async (req, res) => {
  const id = Number(req.params.id);
  const { amount } = req.body as { amount: number };
  const session = await Session.findByPk(id);
  if (!session) return res.status(404).json({ message: "Session not found" });
  const paidAt = new Date();
  const payment = await Payment.create({ sessionId: id, amount, paidAt });
  session.isPaid = true;
  await session.save();
  io.emit("payment:created", { sessionId: id, amount });
  res.status(201).json(payment);
});

app.get("/payments/daily", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const payments = await Payment.findAll({
    where: {
      paidAt: {
        [Op.gte]: today,
        [Op.lt]: tomorrow
      } as any
    }
  });
  const total = payments.reduce((sum, p) => sum + p.amount, 0);
  res.json({ total });
});

app.get("/payments/by-device", async (_req, res) => {
  const payments = await Payment.findAll({ include: [Session] });
  const byDevice = new Map<number, number>();
  for (const p of payments) {
    const s = (p as any).Session as Session | undefined;
    if (!s) continue;
    const current = byDevice.get(s.deviceId) ?? 0;
    byDevice.set(s.deviceId, current + p.amount);
  }
  res.json(
    Array.from(byDevice.entries()).map(([deviceId, total]) => ({
      deviceId,
      total
    }))
  );
});

async function bootstrap() {
  await createMigrator(sequelize).up();
    // Recharge les sessions actives en mémoire (utile après redémarrage serveur)
    const running = await Session.findAll({
      where: { status: "active" as SessionStatus }
    });
  
    for (const s of running) {
      const last = s.lastResumedAt ?? s.startTime;
      activeSessions.set(s.id, {
        id: s.id,
        deviceId: s.deviceId,
        accumulatedMinutes: s.accumulatedMinutes ?? 0,
        lastResumedAt: last
      });
    }
  const userCount = await User.count();
  if (userCount === 0) {
    const hash = await bcrypt.hash("admin", 10);
    await User.create({
      name: "Admin",
      email: "admin@example.com",
      passwordHash: hash
    });
  }

  const tarifCount = await Tarif.count();
  if (tarifCount === 0) {
    await Tarif.create({
      label: "standard",
      pricePer15min: 500,
      minimumPrice: 300
    });
  }
  const firstTarif = await Tarif.findOne({ order: [["id", "ASC"]] });
  globalTarifId = firstTarif?.id ?? null;

  server.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on port ${config.port}`);
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start server", err);
  process.exit(1);
});

