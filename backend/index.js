import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { q } from "./db.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }
});

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
app.use(express.json());

// --- Simple auth for admin endpoints ---
function requireKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!process.env.API_KEY || key === process.env.API_KEY) return next();
  return res.status(401).json({ error: "bad api key" });
}

// --- Helpers ---
async function getQueue(debateId) {
  const sp = await q(
    `SELECT * FROM speakers WHERE debate_id=$1 ORDER BY order_index ASC`,
    [debateId]
  );
  const speakers = sp.rows;

  const byId = Object.fromEntries(speakers.map(s => [s.id, { ...s, replikker:[null,null], svarReplikk:null }]));

  if (!speakers.length) return [];

  const ids = speakers.map(s => s.id);
  const r = await q(`SELECT * FROM replies WHERE speaker_id = ANY($1)`, [ids]);
  r.rows.forEach(x => { byId[x.speaker_id].replikker[x.slot] = { name:x.name, party:x.party }; });

  const sr = await q(`SELECT * FROM svar_replikk WHERE speaker_id = ANY($1)`, [ids]);
  sr.rows.forEach(x => { byId[x.speaker_id].svarReplikk = { name:x.name, party:x.party }; });

  return speakers.map(s => byId[s.id]);
}

function emitState(debateId) {
  io.to(`debate:${debateId}`).emit("state:update", { ts: Date.now() });
}

// --- Routes ---

// Create debate (admin)
app.post("/api/debate", requireKey, async (req, res) => {
  const { title } = req.body;
  const r = await q(`INSERT INTO debates(title) VALUES ($1) RETURNING id, title`, [title || "Debatt"]);
  const id = r.rows[0].id;
  await q(`INSERT INTO timer_state(debate_id, seconds_remaining) VALUES ($1,0) ON CONFLICT DO NOTHING`, [id]);
  res.json(r.rows[0]);
});

// Get queue
app.get("/api/debate/:id/queue", async (req, res) => {
  res.json(await getQueue(req.params.id));
});

// Add speaker (admin)
app.post("/api/debate/:id/speaker", requireKey, async (req, res) => {
  const { name, party, topic, durations } = req.body;
  const ord = await q(`SELECT COALESCE(MAX(order_index), -1)+1 AS idx FROM speakers WHERE debate_id=$1`, [req.params.id]);
  const order_index = ord.rows[0].idx;
  const r = await q(
    `INSERT INTO speakers(debate_id,name,party,topic,durations,order_index)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.id, name, party, topic, durations ?? { INNLEGG:180, REPLIKK:60, SVAR_REPLIKK:30 }, order_index]
  );
  emitState(req.params.id);
  res.json(r.rows[0]);
});

// Update speaker fields / durations (admin)
app.patch("/api/debate/:id/speaker/:sid", requireKey, async (req, res) => {
  const fields = [];
  const vals = [];
  let i = 1;
  for (const k of ["name","party","topic","durations","order_index"]) {
    if (k in req.body) { fields.push(`${k}=$${i++}`); vals.push(req.body[k]); }
  }
  if (!fields.length) return res.json({ ok:true });
  vals.push(req.params.sid);
  const r = await q(`UPDATE speakers SET ${fields.join(", ")} WHERE id=$${i} RETURNING *`, vals);
  emitState(req.params.id);
  res.json(r.rows[0]);
});

// Set replikk (admin)
app.post("/api/debate/:id/replikk", requireKey, async (req, res) => {
  const { speaker_id, slot, name, party } = req.body;
  await q(
    `INSERT INTO replies(speaker_id,slot,name,party)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (speaker_id,slot) DO UPDATE SET name=EXCLUDED.name, party=EXCLUDED.party`,
    [speaker_id, slot, name, party]
  );
  emitState(req.params.id);
  res.json({ ok: true });
});

// Set svar-replikk (admin)
app.post("/api/debate/:id/svar", requireKey, async (req, res) => {
  const { speaker_id, name, party } = req.body;
  await q(
    `INSERT INTO svar_replikk(speaker_id,name,party)
     VALUES ($1,$2,$3)
     ON CONFLICT (speaker_id) DO UPDATE SET name=EXCLUDED.name, party=EXCLUDED.party`,
    [speaker_id, name, party]
  );
  emitState(req.params.id);
  res.json({ ok: true });
});

// Advance to next speaker (admin)
app.post("/api/debate/:id/advance", requireKey, async (req, res) => {
  const { id } = req.params;
  // Take current state and move to next in order
  const q1 = await q(`SELECT active_speaker_id FROM timer_state WHERE debate_id=$1`, [id]);
  const currentId = q1.rows[0]?.active_speaker_id;
  const next = await q(
    `WITH cur AS (
       SELECT order_index FROM speakers WHERE id=$1
     )
     SELECT s.* FROM speakers s, cur
     WHERE s.debate_id=$2 AND s.order_index > cur.order_index
     ORDER BY s.order_index ASC LIMIT 1`,
    [currentId, id]
  );
  const target = next.rows[0] || (await q(`SELECT * FROM speakers WHERE debate_id=$1 ORDER BY order_index ASC LIMIT 1`, [id])).rows[0];

  await q(
    `UPDATE timer_state SET active_speaker_id=$1, active_slot='INNLEGG',
      selected_replikk_index=0, seconds_remaining=0, running=FALSE, updated_at=now()
     WHERE debate_id=$2`,
    [target?.id ?? null, id]
  );
  emitState(id);
  res.json({ ok: true, active_speaker_id: target?.id ?? null });
});

// Read timer state (public)
app.get("/api/debate/:id/state", async (req, res) => {
  const r = await q(`SELECT * FROM timer_state WHERE debate_id=$1`, [req.params.id]);
  res.json(r.rows[0] || null);
});

// Update timer state (admin)
app.post("/api/debate/:id/timer", requireKey, async (req, res) => {
  const { active_speaker_id, active_slot, selected_replikk_index, seconds_remaining, running } = req.body;
  await q(
    `INSERT INTO timer_state(debate_id, active_speaker_id, active_slot, selected_replikk_index, seconds_remaining, running, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (debate_id) DO UPDATE SET
       active_speaker_id=EXCLUDED.active_speaker_id,
       active_slot=EXCLUDED.active_slot,
       selected_replikk_index=EXCLUDED.selected_replikk_index,
       seconds_remaining=EXCLUDED.seconds_remaining,
       running=EXCLUDED.running,
       updated_at=now()`,
    [req.params.id, active_speaker_id, active_slot, selected_replikk_index ?? 0, seconds_remaining ?? 0, !!running]
  );
  emitState(req.params.id);
  res.json({ ok: true });
});

// --- WebSocket rooms per debate ---
io.on("connection", (socket) => {
  socket.on("join", (debateId) => {
    socket.join(`debate:${debateId}`);
  });
});

const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, () => console.log(`API on :${PORT}`));
