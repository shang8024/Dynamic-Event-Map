import test from "node:test";
import assert from "node:assert/strict";
import { apiBase, socketEndpoint } from "../src/services/endpoints.js";

test("API URLs retain exactly one /api prefix in production and development", () => {
  for (const [input, expected] of [
    [undefined, "/api"], ["/api", "/api"], ["/api/", "/api"], ["", "/api"],
    ["http://localhost:5000", "http://localhost:5000/api"],
    ["https://events.example/api/", "https://events.example/api"],
  ]) assert.equal(apiBase(input), expected);
});

test("Socket.IO connects at the server root for relative and absolute API URLs", () => {
  assert.deepEqual(socketEndpoint("/api", "https://events.example"), {
    url: "https://events.example", path: "/socket.io",
  });
  assert.deepEqual(socketEndpoint("http://localhost:5000/api", "http://localhost:3000"), {
    url: "http://localhost:5000", path: "/socket.io",
  });
});
