#!/usr/bin/env node
/**
 * Leap Motion MCP Server
 * Connects to Leap WebSocket (ws://127.0.0.1:6437) and exposes hand data to Cursor.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";

const LEAP_WS = "ws://127.0.0.1:6437";
let ws = null;
let latestFrame = null;
let connected = false;

function connectLeap() {
  if (ws?.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(LEAP_WS);
    } catch (e) {
      reject(e);
      return;
    }
    ws.on("open", () => {
      connected = true;
      ws.send(JSON.stringify({ enableGestures: false }));
      resolve();
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.hands !== undefined) latestFrame = msg;
      } catch (_) {}
    });
    ws.on("close", () => {
      connected = false;
      ws = null;
    });
    ws.on("error", (err) => {
      connected = false;
      if (!ws) reject(err);
    });
  });
}

function getLatestFrame() {
  if (!latestFrame) return null;
  return JSON.parse(JSON.stringify(latestFrame));
}

const server = new McpServer({
  name: "leap-motion",
  version: "1.0.0",
}, {
  capabilities: { tools: {} },
});

server.tool(
  "get_leap_hands",
  "Returns the current Leap Motion hand tracking data (palm positions, fingertips, velocities). Requires Leap Motion controller + Ultraleap software running.",
  {},
  async () => {
    try {
      await connectLeap();
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `Leap Motion connection failed: ${e.message}. Ensure Ultraleap Control Panel is running and the device is plugged in.`,
        }],
      };
    }
    const frame = getLatestFrame();
    if (!frame) {
      return {
        content: [{
          type: "text",
          text: "Connected to Leap Motion but no frame data yet. Move your hands in view of the sensor.",
        }],
      };
    }
    const hands = frame.hands || [];
    const pointables = frame.pointables || [];
    const summary = {
      handCount: hands.length,
      hands: hands.map((h) => ({
        id: h.id,
        type: h.type,
        palmPosition: h.palmPosition,
        palmVelocity: h.palmVelocity,
        pinchStrength: h.pinchStrength,
        grabStrength: h.grabStrength,
      })),
      pointables: pointables.map((p) => ({
        id: p.id,
        handId: p.handId,
        tipPosition: p.tipPosition,
        tool: p.tool,
      })),
    };
    return {
      content: [{
        type: "text",
        text: JSON.stringify(summary, null, 2),
      }],
    };
  }
);

server.tool(
  "get_leap_frame_raw",
  "Returns the raw latest Leap Motion frame JSON (full frame data).",
  {},
  async () => {
    try {
      await connectLeap();
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `Leap Motion connection failed: ${e.message}`,
        }],
      };
    }
    const frame = getLatestFrame();
    return {
      content: [{
        type: "text",
        text: frame ? JSON.stringify(frame, null, 2) : "No frame data yet.",
      }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
