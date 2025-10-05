import { useState } from 'react'
import dynamic from 'next/dynamic'
import QueryPanel from '../components/UI/QueryPanel'
import ResultsPanel from '../components/UI/ResultsPanel'
import CoordinateInput from '../components/UI/CoordinateInput'
import AskGPT from '../components/UI/AskGPT'
import VisualizationPanel from '../components/UI/VisualizationPanel'

const WeatherMap = dynamic(() => import('../components/Map/WeatherMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gradient-to-br from-cyan-50 to-blue-100">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-cyan-700 font-medium">Loading map...</p>
      </div>
    </div>
  )
})

export default function Home() {
  const [queryResults, setQueryResults] = useState<any>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedMapPoint, setSelectedMapPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [dataPoints, setDataPoints] = useState<any[]>([])
  const [mapClickCoordinate, setMapClickCoordinate] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedCoordinate, setSelectedCoordinate] = useState<{ lat: number; lng: number; source: string } | null>(null)
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 43.65, lng: -79.38 })
  const [isGPTOpen, setIsGPTOpen] = useState(true) // 始终显示
  const [isGPTExpanded, setIsGPTExpanded] = useState(false)
  const [shouldFlash, setShouldFlash] = useState(false)
  const [showResultsModal, setShowResultsModal] = useState(false)
  const [showVisualization, setShowVisualization] = useState(false)

  const handlePointClick = (point: any) => {
    setSelectedMapPoint({ lat: point.lat, lng: point.lng })
  }

  const handleMapClick = (lat: number, lng: number) => {
    // 关键修复：点击地图时，立即更新标记位置，但不移动地图
    setMapClickCoordinate({ lat, lng })
    setSelectedMapPoint({ lat, lng })  // 立即显示标记
    setSelectedCoordinate({ lat, lng, source: 'map' })  // 更新选中坐标
    // 注意：不移动地图中心，让用户保持当前视角
    console.log(`🗺️ Map clicked: ${lat.toFixed(6)}, ${lng.toFixed(6)}`)
  }

  const handleCoordinateSelect = (lat: number, lng: number, source: 'manual' | 'map' | 'search') => {
    setSelectedCoordinate({ lat, lng, source })
    setMapCenter({ lat, lng })
    setSelectedMapPoint({ lat, lng })
    
    // Show notification
    const sourceText = source === 'manual' ? 'Manual Input' : source === 'map' ? 'Map Click' : 'Address Search'
    console.log(`✅ Coordinate selected (${sourceText}): ${lat.toFixed(4)}, ${lng.toFixed(4)}`)
  }

  return (
    <div className="flex h-screen bg-gradient-to-br from-cyan-950 via-cyan-900 to-slate-900 overflow-hidden">
      {/* 左侧面板 - 增大宽度和字体4倍 */}
      <div 
        className={`${
          isExpanded ? 'w-[600px]' : 'w-16'
        } transition-all duration-500 ease-in-out flex flex-col relative animate-slide-in-left`}
        style={{ 
          fontSize: '2rem'
        }}
      >
        {/* 展开/收起按钮 */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="absolute -right-3 top-6 z-20 w-6 h-6 bg-white rounded-full shadow-lg flex items-center justify-center hover:scale-110 transition-transform duration-200"
        >
          <span className="text-gray-700 text-xs">{isExpanded ? '←' : '→'}</span>
        </button>

        {/* 面板内容 */}
        <div className={`glass-dark h-full overflow-y-auto p-6 ${isExpanded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}>
          {/* 顶部标题 */}
          <div className="mb-8 animate-fade-in">
            <div className="flex items-center mb-2">
              <div className="w-10 h-10 bg-gradient-to-r from-cyan-600 to-cyan-500 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                </svg>
              </div>
              <div>
                <h1 className="text-5xl font-bold text-white">WeatherPreview</h1>
                <p className="text-2xl text-gray-400">Management System</p>
              </div>
            </div>
            
            {/* 显示当前选中的坐标 */}
            {selectedCoordinate && (
              <div className="mt-4 bg-cyan-600/20 border border-cyan-500/30 rounded-lg p-4 animate-fade-in">
                <div className="text-xl text-cyan-300 mb-2">Current Location</div>
                <div className="font-mono text-2xl text-white">
                  {selectedCoordinate.lat.toFixed(4)}, {selectedCoordinate.lng.toFixed(4)}
                </div>
                <div className="text-lg text-cyan-400 mt-2">
                  Source: {selectedCoordinate.source === 'manual' ? '📝 Manual' : 
                           selectedCoordinate.source === 'map' ? '🗺️ Map Click' : 
                           '🔍 Address Search'}
                </div>
              </div>
            )}
          </div>

          {/* 坐标输入面板 */}
          <div className="space-y-4">
            <CoordinateInput
              onCoordinateSelect={handleCoordinateSelect}
              mapClickCoordinate={mapClickCoordinate}
            />

            {/* 查询面板 */}
            <QueryPanel 
              onQuerySubmit={(results) => {
                setQueryResults(results)
                if (results.data) {
                  setDataPoints(results.data)
                }
                // 新数据到达，触发GPT浮窗闪烁
                setShouldFlash(true)
                setTimeout(() => setShouldFlash(false), 2000)
                // 显示结果弹窗
                setShowResultsModal(true)
              }} 
              onLoading={setIsLoading}
              selectedCoordinate={selectedCoordinate}
              onSubmit={() => {}}
            />

            {/* 加载状态 */}
            {isLoading && (
              <div className="glass rounded-xl p-8 text-center animate-fade-in">
                <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-white text-sm">Loading data...</p>
              </div>
            )}

            {/* 结果展示卡片 */}
            <div className="grid grid-cols-2 gap-3">
              <div 
                className="glass rounded-xl p-5 card-hover cursor-pointer"
                onClick={() => queryResults && setShowResultsModal(true)}
                title="View statistical results"
              >
                <div className="flex items-center mb-3">
                  <svg className="w-7 h-7 text-cyan-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="text-lg font-bold text-white" style={{ fontSize: '2rem' }}>Statistical Results</span>
                </div>
                <div className="text-3xl font-bold text-cyan-400">{queryResults?.count || 0} Points</div>
              </div>
              <div 
                className="glass rounded-xl p-5 card-hover cursor-pointer"
                onClick={() => queryResults && setShowVisualization(true)}
                title="View visualized results"
              >
                <div className="flex items-center mb-3">
                  <svg className="w-7 h-7 text-purple-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                  <span className="text-lg font-bold text-white" style={{ fontSize: '2rem' }}>Visualized Result</span>
                </div>
                <div className="text-3xl font-bold text-purple-400">{queryResults?.files?.length || 0} Files</div>
              </div>
            </div>


            {/* 结果面板 - 已移除，使用弹窗代替 */}

            {/* Search Weather 独立按钮 */}
            <div className="mt-4">
              <button 
                onClick={() => {
                  // 调用QueryPanel的handleSubmit
                  if ((window as any).__queryPanelSubmit) {
                    (window as any).__queryPanelSubmit();
                  }
                }}
                disabled={!selectedCoordinate}
                className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-700 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-all duration-200 hover:scale-[1.02] shadow-lg hover:shadow-xl"
              >
                <span className="flex items-center justify-center">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {selectedCoordinate ? 'Search Weather' : 'Select Location First'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* 右侧地图 */}
      <div className="flex-1 relative animate-slide-in-right">
        <div className="absolute inset-0 m-4 rounded-2xl overflow-hidden shadow-2xl">
          <WeatherMap
            apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
            center={mapCenter}
            zoom={selectedCoordinate ? 12 : 8}
            selectedPoint={selectedMapPoint}
            dataPoints={dataPoints}
            onMapClick={handleMapClick}
          />
        </div>
      </div>

      {/* 状态栏 */}
      <div className="absolute bottom-4 right-4 glass-dark rounded-full px-4 py-2 flex items-center space-x-2 animate-fade-in">
        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse"></div>
        <span className="text-xs text-white font-medium">System Online</span>
      </div>

      {/* 结果弹窗 */}
      {showResultsModal && queryResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 animate-fade-in" onClick={() => setShowResultsModal(false)}>
          <div 
            className="bg-gradient-to-br from-slate-900 via-cyan-950 to-slate-900 rounded-2xl shadow-2xl w-full max-w-6xl max-h-full overflow-hidden border-4 border-cyan-500 animate-slide-in-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between p-5 border-b border-cyan-500/30 bg-gradient-to-r from-cyan-900/20 to-blue-900/20">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-gradient-to-r from-cyan-600 to-blue-500 rounded-xl flex items-center justify-center mr-3">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Query Results</h2>
                  <p className="text-sm text-cyan-300">{queryResults.count} data points found</p>
                </div>
              </div>
              <button
                onClick={() => setShowResultsModal(false)}
                className="w-9 h-9 rounded-lg hover:bg-red-500/20 flex items-center justify-center transition-colors"
                title="Close"
              >
                <svg className="w-5 h-5 text-gray-300 hover:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 内容 - 字体放大4倍 */}
            <div className="p-6 overflow-y-auto max-h-[calc(100vh-250px)] custom-scrollbar" style={{ fontSize: '2rem' }}>
              {/* 统计摘要 */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/5 rounded-xl p-6 border border-cyan-500/30">
                  <div className="text-7xl font-bold text-white mb-2">{queryResults.count}</div>
                  <div className="text-3xl text-gray-400">Data Points</div>
                </div>
                <div className="bg-white/5 rounded-xl p-6 border border-cyan-500/30">
                  <div className="text-7xl font-bold text-white mb-2">{queryResults.files?.length || 0}</div>
                  <div className="text-3xl text-gray-400">GRIB Files</div>
                </div>
              </div>

              {/* 完整数据点列表 - 两列布局 */}
              <div className="space-y-3">
                <h3 className="text-4xl font-semibold text-white mb-4 flex items-center justify-between">
                  <span>All Data Points</span>
                  <span className="text-3xl text-cyan-400">{queryResults.data.length} total</span>
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  {queryResults.data.map((point: any, index: number) => (
                    <div key={index} className="bg-white/5 rounded-lg p-6 border border-white/10 hover:border-cyan-500/30 transition-all">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-2xl text-gray-300 font-semibold">Point #{index + 1}</span>
                        <span className="text-xl text-gray-400">{new Date(point.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="space-y-3 text-xl">
                        <div className="flex justify-between">
                          <span className="text-gray-300">Location:</span>
                          <span className="text-white font-mono">{point.lat?.toFixed(4) || 'N/A'}, {point.lng?.toFixed(4) || 'N/A'}</span>
                        </div>
                        {/* 动态显示所有实际存在的变量 */}
                        {point.rawData && point.rawData.map((item: any, idx: number) => (
                          <div key={idx} className="flex justify-between">
                            <span className="text-gray-300">{item.displayName}:</span>
                            <span className="text-cyan-400 font-bold">{item.displayValue}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 底部关闭按钮 */}
            <div className="p-5 border-t border-cyan-500/30 bg-gradient-to-r from-cyan-900/10 to-blue-900/10">
              <button
                onClick={() => setShowResultsModal(false)}
                className="w-full bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white font-medium py-3 rounded-xl transition-all duration-200 hover:scale-105 shadow-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 可视化模态框 */}
      {showVisualization && queryResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl animate-scale-in">
            <VisualizationPanel 
              results={queryResults}
              onClose={() => setShowVisualization(false)}
            />
          </div>
        </div>
      )}

      {/* AI Chatbot - 右下角浮窗（始终显示）*/}
      <AskGPT
        isOpen={isGPTOpen}
        onClose={() => setIsGPTOpen(false)}
        isExpanded={isGPTExpanded}
        onToggleExpand={() => {
          setIsGPTExpanded(!isGPTExpanded)
        }}
        weatherData={queryResults}
        location={selectedCoordinate}
        shouldFlash={shouldFlash}
      />
    </div>
  )
}

