import fetch from "node-fetch";

const TARGET = process.env.KEEPALIVE_TARGET || "https://divine-wms.onrender.com/api/health";
const INTERVAL_MS = Number(process.env.KEEPALIVE_INTERVAL_MS) || 10 * 60 * 1000; // default 10 min

async function ping() {
  try {
    const res = await fetch(TARGET, { method: "GET", timeout: 15000 });
    console.log(new Date().toISOString(), "Ping OK", res.status);
  } catch (err) {
    console.warn(new Date().toISOString(), "Ping failed", err.message || err);
  }
}

console.log("Keepalive worker started. Pinging:", TARGET, "every", INTERVAL_MS / 60000, "minutes");

ping(); // initial
setInterval(ping, INTERVAL_MS);
