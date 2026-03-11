# Leap Motion MCP Server

Exposes Leap Motion hand tracking data to Cursor via the Model Context Protocol.

## Requirements

- **Leap Motion controller** connected
- **Ultraleap Control Panel** (or Leap service) running and tracking

## Tools

- **`get_leap_hands`** – Returns hand positions, palm velocity, pinch/grab strength, fingertip positions
- **`get_leap_frame_raw`** – Returns the raw latest Leap frame JSON

## Setup

The MCP server is configured in `.cursor/mcp.json`. **Restart Cursor** after adding or changing the config.

In Cursor, you can ask: *"What are my hands doing according to Leap Motion?"* and the AI will call `get_leap_hands` to fetch live tracking data.
