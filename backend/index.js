import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }
});

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
app.use(express.json());

// In-memory rooms state (ephemeral per deployment)
const rooms = new Map(); // roomId -> { state, updatedAt }
const ROOM_TTL_MIN = Number(process.env.ROOM_TTL_MIN || 24 * 60); // 24h

// Create a room (controller action)
app.post("/api/room", (req, res) => {
  const roomId = (req.body?.roomId || "").trim() || crypto.randomUUID().slice(0, 6);
  if (!rooms.has(roomId)) rooms.set(roomId, { state: null, updatedAt: Date.now() });
  res.json({ roomId });
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now(), rooms: rooms.size }));

// Socket wiring
io.on("connection", (socket) => {
  socket.on("join", (roomId) => {
    socket.join(roomId);
    // Send last known state to late-joiners (display)
    const r = rooms.get(roomId);
    if (r?.state) socket.emit("state:sync", r.state);
  });

  // Controller pushes state; server fans out to the room
  socket.on("state:push", ({ roomId, state }) => {
    if (!roomId) return;
    const now = Date.now();
    rooms.set(roomId, { state, updatedAt: now });
    io.to(roomId).emit("state:update", state);
  });

  // Optional: ping / presence
  socket.on("ping", (roomId) => {
    io.to(roomId).emit("pong", Date.now());
  });
});

// Garbage-collect stale rooms
setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MIN * 60_000;
  for (const [k, v] of rooms.entries()) {
    if ((v.updatedAt || 0) < cutoff) rooms.delete(k);
  }
}, 10 * 60_000);

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => console.log(`Talestolen realtime running :${PORT}`));
