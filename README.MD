# 🌍 NASA Weather Data Query System

> High-performance weather data management and visualization platform powered by NASA CFS GRIB2 data

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-green.svg)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6.svg)](https://www.typescriptlang.org/)

---

## ✨ Key Features

### 🔧 Backend (8 Core Modules)

1. **`cfs_fetch.py`** - Automated NASA CFS data downloader with retry mechanisms
2. **`grib_api.py`** - FastAPI REST API server for spatio-temporal queries
3. **`bunk_index.py`** - GRIB2 file indexer with SQLite for fast lookups
4. **`query_file_index.py`** - Command-line query tool with JSON/CSV export
5. **`grid_util.py`** - Geospatial coordinate transformation utilities
6. **`inspect_grib.py`** - GRIB2 file inspector and validator
7. **`performance_test.py`** - Performance benchmarking and load testing
8. **`main.py`** - Integrated launcher for one-command startup

### 🎨 Frontend Visualization

**Professional weather animations (20 FPS) on 1°×1° regional maps:**

- 🌡️ **Temperature** - Heatmap with thermal ripples & dynamic thermometer
- 💨 **Wind Speed** - Streamline flow with animated arrows & rotating windmill  
- ❄️ **Snow Coverage** - Falling snowflakes with accumulation & snowman
- 🌧️ **Precipitation** - Raindrop animation with splashes & umbrella
- ☁️ **Cloud Coverage** - Moving clouds with shadows & rotating sun

**All elements dynamically scale based on real-time data values.**

---

## 📸 Screenshots

### Statistical Results
![Main Interface](Screenshots/Screenshot%20from%202025-10-05%2020-39-42.png)

### Professional Visualization
![Statistical Results](Screenshots/Screenshot%20from%202025-10-05%2020-41-26.png)

### LLM Implementation
![Visualization](Screenshots/Screenshot%20from%202025-10-05%2020-43-34.png)

---

## 🛠️ Tech Stack

**Backend:** Python 3.8+ • FastAPI • cfgrib • SQLite • NumPy

**Frontend:** React 18 • TypeScript • Next.js • Tailwind CSS • Canvas API • Leaflet

**Architecture:** RESTful API • Frontend-Backend Separation • Real-time Data Processing

---

## 🌟 Highlights

✅ **8 Backend Modules** - Complete data pipeline from download to query  
✅ **Professional Visualizations** - 5 animated weather effects with dynamic scaling  
✅ **GPT Integration** - AI-powered weather analysis and insights  
✅ **Frontend-Backend Separation** - Modern microservices architecture  
✅ **High Performance** - <100ms queries, 100+ concurrent users, 60 FPS rendering  
✅ **One-Command Startup** - `./start.sh` launches everything  
✅ **NASA Data Integration** - Direct access to CFS GRIB2 archives  
✅ **Production-Ready** - Robust error handling, logging, and monitoring

---

## 🚀 Quick Start

```bash
# Install dependencies
pip install -r requirements.txt
cd frontend && npm install

# Configure environment
export GRIB_DATA_DIR=/path/to/data
cd frontend && cp env.example env

# Start system (one command!)
./start.sh
```

**Access:**
- Backend API: `http://localhost:8000`
- Frontend UI: `http://localhost:3000`

---

## 📡 API Example

```bash
curl -X POST http://localhost:8000/api/query-data \
  -H "Content-Type: application/json" \
  -d '{
    "start_iso": "2025-10-04T00:00:00",
    "end_iso": "2025-10-04T23:59:59",
    "lon_min_0_360": 280.8,
    "lon_max_0_360": 281.8,
    "lat_min": 43.68,
    "lat_max": 44.68,
    "variable": "t2m",
    "level": "heightAboveGround"
  }'
```

**Supported Variables:** `t2m` (Temperature) • `tcc` (Cloud Coverage) • `u10` (Wind Speed) • `snowc` (Snow Coverage) • `cpr` (Precipitation)

---

## 📊 Performance

- **Query Speed:** < 100ms
- **Concurrent Users:** 100+
- **Animation:** 60 FPS rendering, 20 FPS playback
- **Data Coverage:** Global 0.5° × 0.5° resolution

---

## 🗂️ Project Structure

```
weatherproject/
├── cfs_fetch.py              # Data downloader
├── grib_api.py               # FastAPI server
├── bunk_index.py             # GRIB indexer
├── query_file_index.py       # Query tool
├── grid_util.py              # Geospatial utils
├── inspect_grib.py           # File inspector
├── performance_test.py       # Benchmarking
├── main.py                   # Launcher
├── frontend/                 # React + TypeScript UI
│   ├── components/
│   ├── pages/
│   └── lib/api.ts
├── data/                     # GRIB2 files
├── start.sh                  # One-command startup
└── README.MD
```

---

## 🙏 Acknowledgments

**NASA/NOAA** - CFS GRIB2 data • **ECMWF** - cfgrib library • **FastAPI** - Web framework • **React & Next.js** - Frontend tools

---

**Built with ❤️ for the meteorological community**
