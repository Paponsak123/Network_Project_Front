#!/bin/bash
# Auto-detects your Mac's LAN IP and builds the frontend with the correct
# backend URL baked in — no hardcoding needed.

MAC_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

if [ -z "$MAC_IP" ]; then
  echo "❌ Could not detect Mac IP. Are you connected to WiFi?"
  exit 1
fi

export BACKEND_URL="http://${MAC_IP}:8000"
echo "✅ Detected Mac IP: $MAC_IP"
echo "🔧 Building frontend with BACKEND_URL=$BACKEND_URL"

docker compose up -d --build frontend redis

echo ""
echo "🚀 Frontend running at: http://${MAC_IP}:3000"
echo "   Other devices on your network can open that URL."
echo ""
echo "▶️  Start the backend in a separate terminal:"
echo "   cd backend && source venv/bin/activate"
echo "   sudo -E venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000"
