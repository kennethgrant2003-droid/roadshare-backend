const { io } = require("socket.io-client");

const token = process.argv[2];
if (!token) {
  console.log("Usage: node tools/socket-test.js <JWT_TOKEN>");
  process.exit(1);
}

const socket = io("http://127.0.0.1:3000", {
  auth: { token: `Bearer ${token}` }
});

socket.on("connect", () => console.log("socket connected:", socket.id));
socket.on("connected", (msg) => console.log("connected msg:", msg));
socket.on("job:new", (payload) => console.log("JOB NEW:", payload));
socket.on("job:accepted", (payload) => console.log("JOB ACCEPTED:", payload));
socket.on("job:status", (payload) => console.log("JOB STATUS:", payload));
socket.on("disconnect", () => console.log("socket disconnected"));