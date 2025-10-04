# Weather Frontend

React + Next.js + Google Maps weather data visualization interface.

## Quick Start

### Option 1: Use startup script (recommended)
```bash
./start.sh  # Auto cleanup, check deps, start server
```

### Option 2: Manual start
```bash
npm install
cp env.example .env.local  # Configure environment
npm run dev  # http://localhost:3000
```

## Environment Variables

Create `.env.local`:

```bash
# Required
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_key
NEXT_PUBLIC_GPT_API_KEY=your_gpt_api_key

# Optional
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000  # Backend API
NEXT_PUBLIC_USE_MOCK=false  # Use mock data for testing
NEXT_PUBLIC_GPT_API_URL=https://api.chatanywhere.tech/v1/chat/completions
```

## Backend API Integration

### Endpoint: `/api/query-data`

**Request:**
```typescript
{
  start_time: string    // ISO 8601, e.g. "2025-10-02T00:00:00Z"
  end_time: string      // ISO 8601
  lat: number          // -90 to 90
  lon: number          // -180 to 180 (auto-converted to 0-360)
  variables: string[]  // e.g. ["TMP:2 m above ground", "PRATE:surface"]
}
```

**Response:**
```typescript
{
  data: Array<{
    lat: number
    lon: number
    time: string
    variables: Record<string, number>
  }>
  files: string[]
  count: number
}
```

### Coordinate Conversion

Frontend uses **-180 to 180** longitude.  
Backend expects **0 to 360** longitude.  
Auto-converted in `lib/api.ts`:

```typescript
const lonTo0_360 = (lon: number) => lon < 0 ? lon + 360 : lon
```

## Features

- **3 Ways to Select Location:**
  1. Manual coordinate input
  2. Click on map
  3. Address search (Google Geocoding API)

- **Time & Variable Selection:**
  - Start/End date-time picker
  - Multi-select variables (temperature, pressure, precipitation, etc.)

- **AI Chatbot (Ask GPT):**
  - Auto-summarizes weather data
  - Suggests activities based on weather
  - Continuous conversation support

- **Results Display:**
  - Modal window with all data points
  - Two-column layout
  - Re-openable results panel

## Project Structure

```
frontend/
├── pages/
│   └── index.tsx           # Main page
├── components/
│   ├── Map/
│   │   └── WeatherMap.tsx  # Google Maps integration
│   └── UI/
│       ├── CoordinateInput.tsx  # Location input
│       ├── QueryPanel.tsx       # Time & variable selection
│       ├── ResultsPanel.tsx     # Results display
│       └── AskGPT.tsx           # AI chatbot
├── lib/
│   ├── api.ts              # Backend API client
│   └── mockData.ts         # Mock data for testing
└── styles/
    └── globals.css         # Cyan theme (primary: #0891b2)
```

## Available Variables

- `TMP:2 m above ground` - Temperature (K)
- `PRATE:surface` - Precipitation rate (kg/m²/s)
- `PRES:surface` - Pressure (Pa)
- `RH:2 m above ground` - Relative humidity (%)
- `UGRD:10 m above ground` - U-wind component (m/s)
- `VGRD:10 m above ground` - V-wind component (m/s)

## Scripts

```bash
npm run dev    # Development (http://localhost:3000)
npm run build  # Production build
npm start      # Production server
```

## Notes

- Map uses `AdvancedMarker` for precise coordinate alignment
- All times in UTC (ISO 8601)
- Page scaled at 150% (left panel width increased to 480px)
- Mock data available for testing without backend
