#!/bin/bash

# Frontend启动脚本
# 自动清理端口、检查依赖、启动开发服务器

set -e

echo "🚀 Weather Frontend Startup Script"
echo "=================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 默认端口
PORT=${PORT:-3000}

# 1. 检查Node.js
echo ""
echo "📦 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js $NODE_VERSION${NC}"

# 2. 检查npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm not found${NC}"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo -e "${GREEN}✓ npm $NPM_VERSION${NC}"

# 3. 检查并清理端口
echo ""
echo "🔍 Checking port $PORT..."
PID=$(lsof -ti:$PORT 2>/dev/null || echo "")

if [ ! -z "$PID" ]; then
    echo -e "${YELLOW}⚠️  Port $PORT is in use by PID: $PID${NC}"
    echo "   Killing process..."
    kill -9 $PID 2>/dev/null || true
    sleep 1
    echo -e "${GREEN}✓ Port $PORT cleared${NC}"
else
    echo -e "${GREEN}✓ Port $PORT is available${NC}"
fi

# 4. 检查环境变量文件
echo ""
echo "🔐 Checking environment variables..."
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠️  .env.local not found${NC}"
    if [ -f "env.example" ]; then
        echo "   Creating .env.local from env.example..."
        cp env.example .env.local
        echo -e "${YELLOW}⚠️  Please edit .env.local and add your API keys${NC}"
    elif [ -f "env" ]; then
        echo "   Using existing 'env' file..."
        cp env .env.local
    else
        echo -e "${RED}❌ No environment template found${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ .env.local exists${NC}"
fi

# 检查必需的环境变量
if ! grep -q "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY" .env.local || grep -q "your_google_maps_key" .env.local; then
    echo -e "${YELLOW}⚠️  Warning: Google Maps API key may not be configured${NC}"
fi

# 5. 检查node_modules
echo ""
echo "📚 Checking dependencies..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  node_modules not found, installing...${NC}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ node_modules exists${NC}"
fi

# 6. 清理Next.js缓存
echo ""
echo "🧹 Cleaning Next.js cache..."
rm -rf .next 2>/dev/null || true
echo -e "${GREEN}✓ Cache cleared${NC}"

# 7. 启动开发服务器
echo ""
echo "=================================="
echo -e "${GREEN}✅ All checks passed!${NC}"
echo ""
echo "🌐 Starting development server on port $PORT..."
echo "   Access at: http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop the server"
echo "=================================="
echo ""

# 启动开发服务器
npm run dev

# 如果脚本被中断
trap 'echo -e "\n${YELLOW}👋 Server stopped${NC}"; exit 0' INT TERM

