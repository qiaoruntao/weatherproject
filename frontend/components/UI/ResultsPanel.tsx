import { useState } from 'react'

interface ResultsPanelProps {
  results: any
  onPointClick?: (point: any) => void
}

export default function ResultsPanel({ results, onPointClick }: ResultsPanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0)

  if (!results || !results.data) {
    return null
  }

  return (
    <div className="space-y-3 animate-fade-in">
      {/* 统计摘要 */}
      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold text-white mb-3 flex items-center">
          <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></span>
          Query Results
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{results.count}</div>
            <div className="text-xs text-gray-400">Data Points</div>
          </div>
          <div className="bg-white/5 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{results.files?.length || 0}</div>
            <div className="text-xs text-gray-400">GRIB Files</div>
          </div>
        </div>
      </div>


      {/* 数据点列表 */}
      <div className="glass rounded-xl p-5">
        <h4 className="text-sm font-semibold text-white mb-3">Data Points</h4>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {results.data.slice(0, 10).map((point: any, index: number) => (
            <div 
              key={index}
              className="bg-white/5 rounded-lg p-3 hover:bg-white/10 transition-all duration-200 cursor-pointer card-hover"
              onClick={() => onPointClick?.(point)}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="text-xs text-gray-400">Point #{index + 1}</div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation()
                    setExpandedIndex(expandedIndex === index ? null : index)
                  }}
                  className="text-white text-xs hover:text-blue-400 transition-colors"
                >
                  {expandedIndex === index ? '▼' : '▶'}
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-400">Lat:</span>
                  <span className="text-blue-400 ml-1 font-mono">{point.lat.toFixed(4)}</span>
                </div>
                <div>
                  <span className="text-gray-400">Lng:</span>
                  <span className="text-purple-400 ml-1 font-mono">{point.lng.toFixed(4)}</span>
                </div>
              </div>

              {expandedIndex === index && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-2 animate-fade-in">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">🌡️ Temperature</span>
                    <span className="text-white font-mono">{point.temperature.toFixed(1)}°C</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">💨 Wind Speed</span>
                    <span className="text-white font-mono">{point.windSpeed.toFixed(1)} m/s</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">🎚️ Pressure</span>
                    <span className="text-white font-mono">{point.pressure.toFixed(1)} hPa</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">💧 Humidity</span>
                    <span className="text-white font-mono">{point.humidity.toFixed(1)}%</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    {new Date(point.timestamp).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

