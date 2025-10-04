import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps'
import { useState, useCallback } from 'react'

interface WeatherMapProps {
  apiKey: string
  center: { lat: number; lng: number }
  zoom: number
  selectedPoint?: { lat: number; lng: number } | null
  dataPoints?: any[]
  onMapClick?: (lat: number, lng: number) => void
}

export default function WeatherMap({ 
  apiKey, 
  center, 
  zoom, 
  selectedPoint: externalSelectedPoint, 
  dataPoints = [],
  onMapClick 
}: WeatherMapProps) {
  const [selectedPoint, setSelectedPoint] = useState<{ lat: number; lng: number } | null>(null)
  
  // 使用外部传入的选中点或内部状态
  const activePoint = externalSelectedPoint || selectedPoint

  const handleMapClick = useCallback((event: any) => {
    if (event.detail?.latLng) {
      // 关键修复：latLng.lat和latLng.lng可能是函数，需要调用
      const latLng = event.detail.latLng
      const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat
      const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng
      
      console.log(`📍 Exact click coordinates: ${lat.toFixed(8)}, ${lng.toFixed(8)}`)
      
      setSelectedPoint({ lat, lng })
      
      // 通知父组件
      if (onMapClick) {
        onMapClick(lat, lng)
      }
    }
  }, [onMapClick])

  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full bg-gradient-to-br from-red-50 to-pink-50">
        <div className="text-center p-8 glass-dark rounded-2xl shadow-2xl animate-fade-in max-w-md">
          <div className="w-16 h-16 bg-gradient-to-r from-red-500 to-pink-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">API Key Missing</h2>
          <p className="text-gray-300 text-sm">Please configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full group">
      <APIProvider apiKey={apiKey}>
        <Map
          defaultCenter={center}
          defaultZoom={zoom}
          mapId="weather-map"
          onClick={handleMapClick}
          style={{ width: '100%', height: '100%' }}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapTypeControl={true}
          styles={[
            {
              featureType: "all",
              elementType: "geometry",
              stylers: [{ saturation: -20 }]
            }
          ]}
        >
          {/* 显示数据点 */}
          {dataPoints.map((point, index) => (
            <AdvancedMarker
              key={index}
              position={{ lat: point.lat, lng: point.lng }}
              title={`Temp: ${point.temperature.toFixed(1)}°C`}
            >
              <div className="w-3 h-3 bg-cyan-500 rounded-full border-2 border-white shadow-lg"></div>
            </AdvancedMarker>
          ))}
          
       {/* 显示选中点 - 调整偏移修正 */}
       {activePoint && (
         <AdvancedMarker
           position={activePoint}
           title={`Selected Location\nLat: ${activePoint.lat.toFixed(6)}\nLng: ${activePoint.lng.toFixed(6)}`}
         >
           {/* 红色圆点 - 修正左上偏移 */}
           <div style={{
             width: '20px',
             height: '20px',
             backgroundColor: '#EF4444',
             border: '3px solid #FFFFFF',
             borderRadius: '50%',
             boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
             cursor: 'pointer',
             position: 'relative',
             left: '10px',  // 向右偏移10px补偿
             top: '10px',   // 向下偏移10px补偿
           }} />
         </AdvancedMarker>
       )}
        </Map>
      </APIProvider>

      {/* 坐标显示 - 下移避免与地图控件重叠 */}
      {selectedPoint && (
        <div className="absolute top-20 left-4 glass-dark rounded-xl px-4 py-3 shadow-lg animate-fade-in">
          <div className="text-white">
            <div className="text-xs text-gray-400 mb-1">Selected Coordinates</div>
            <div className="font-mono text-sm">
              <span className="text-cyan-400">Lat:</span> {activePoint.lat.toFixed(4)}
              <br />
              <span className="text-cyan-400">Lng:</span> {activePoint.lng.toFixed(4)}
            </div>
          </div>
        </div>
      )}

      {/* 数据点统计 - 下移避免与地图控件重叠 */}
      {dataPoints.length > 0 && (
        <div className="absolute top-20 right-4 glass-dark rounded-xl px-4 py-2 shadow-lg animate-fade-in">
          <div className="text-white text-xs">
            <span className="text-gray-400">Data Points:</span>
            <span className="ml-2 font-bold text-cyan-400">{dataPoints.length}</span>
          </div>
        </div>
      )}

      {/* 图例 */}
      <div className="absolute bottom-4 left-4 glass-dark rounded-xl px-4 py-3 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="text-white text-xs space-y-2">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-cyan-500 rounded-full mr-2"></div>
            <span>Data Points</span>
          </div>
          <div className="flex items-center">
            {/* 红色Pin图标 */}
            <div className="w-3 h-4 mr-2 flex items-center justify-center">
              <div style={{ 
                width: '8px', 
                height: '10px', 
                backgroundColor: '#EF4444',
                borderRadius: '50% 50% 50% 0',
                transform: 'rotate(-45deg)',
                border: '1px solid #991B1B'
              }}></div>
            </div>
            <span>Selected Location</span>
          </div>
        </div>
      </div>
    </div>
  )
}

