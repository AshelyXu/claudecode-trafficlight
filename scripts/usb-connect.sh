#!/bin/bash
# ────────────────────────────────────────────────────────────
# Claude Code Monitor — USB Connect
# 通过 ADB 将手机 localhost:3456 转发到 MacBook localhost:3456
# 手机浏览器打开 http://localhost:3456 即可看到仪表盘
# ────────────────────────────────────────────────────────────
set -e

ADB="${HOME}/platform-tools/adb"
PORT=3456

echo ""
echo "  🔌 Claude Code Monitor — USB 连接"
echo ""

# Check ADB
if [ ! -f "$ADB" ]; then
  echo "  ❌ ADB 未找到: $ADB"
  echo "  请安装 Android Platform Tools"
  exit 1
fi

# Check device connected
DEVICES=$("$ADB" devices 2>/dev/null | grep -v "List of devices" | grep -v "^$" | wc -l | tr -d ' ')
if [ "$DEVICES" -eq 0 ]; then
  echo "  ❌ 未检测到 Android 设备"
  echo ""
  echo "  请确保:"
  echo "  1. 手机已通过 USB 连接到电脑"
  echo "  2. 手机已开启 USB 调试 (开发者选项 → USB 调试)"
  echo "  3. 手机上已授权此电脑的调试连接"
  exit 1
fi

# Clear any existing reverse and re-establish
"$ADB" reverse --remove-all 2>/dev/null || true
"$ADB" reverse tcp:$PORT tcp:$PORT

echo "  ✅ USB 端口转发已建立"
echo ""
echo "  ┌─────────────────────────────────────┐"
echo "  │  手机浏览器打开:                      │"
echo "  │                                     │"
echo "  │  👉  http://localhost:3456          │"
echo "  │                                     │"
echo "  └─────────────────────────────────────┘"
echo ""
echo "  按 Ctrl+C 断开连接"

# Keep alive — show device info
"$ADB" devices -l 2>/dev/null | grep -v "List of devices" | grep -v "^$" | while read line; do
  echo "  已连接设备: $line"
done
echo ""

# Wait for interrupt
trap 'echo ""; echo "  已断开"; "$ADB" reverse --remove-all 2>/dev/null; exit 0' INT TERM
while true; do sleep 5; done
