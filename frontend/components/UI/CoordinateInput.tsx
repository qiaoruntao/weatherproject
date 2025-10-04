import { useState } from 'react'

interface CoordinateInputProps {
  onCoordinateSelect: (lat: number, lng: number, source: 'manual' | 'map' | 'search') => void
  mapClickCoordinate?: { lat: number; lng: number } | null
}

export default function CoordinateInput({ onCoordinateSelect, mapClickCoordinate }: CoordinateInputProps) {
  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  // 处理手动输入
  const handleManualSubmit = () => {
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    
    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid coordinates')
      return
    }
    
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Coordinates out of valid range (Lat: -90 to 90, Lng: -180 to 180)')
      return
    }
    
    onCoordinateSelect(lat, lng, 'manual')
  }

  // 处理地址搜索（使用 Google Geocoding API）
  const handleAddressSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchError('Please enter an address')
      return
    }

    setIsSearching(true)
    setSearchError('')

    try {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(searchQuery)}&key=${apiKey}`
      )
      
      const data = await response.json()
      
      if (data.status === 'OK' && data.results.length > 0) {
        const location = data.results[0].geometry.location
        onCoordinateSelect(location.lat, location.lng, 'search')
        setSearchError('')
      } else {
        setSearchError('Address not found. Please try different keywords')
      }
    } catch (error) {
      console.error('Geocoding error:', error)
      setSearchError('Search failed. Please try again later')
    } finally {
      setIsSearching(false)
    }
  }

  // 使用地图点击的坐标
  const handleUseMapClick = () => {
    if (mapClickCoordinate) {
      onCoordinateSelect(mapClickCoordinate.lat, mapClickCoordinate.lng, 'map')
    }
  }

  return (
    <div className="glass rounded-xl overflow-hidden card-hover">
      {/* 按钮头部 */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-5 flex items-center justify-between hover:bg-white/5 transition-all duration-200"
      >
        <div className="flex items-center">
          <div className="w-8 h-8 bg-gradient-to-r from-cyan-600 to-cyan-500 rounded-lg flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">Location</h2>
        </div>
        <svg 
          className={`w-5 h-5 text-white transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 可展开的内容 */}
      <div className={`transition-all duration-300 ${isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
        <div className="px-5 pb-5 space-y-4">
        {/* 方式1: 手动输入坐标 */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="w-6 h-6 bg-cyan-600 text-white rounded-full flex items-center justify-center text-xs font-bold mr-2">1</span>
            <h3 className="text-sm font-semibold text-white">Manual Input</h3>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                placeholder="Latitude"
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
                step="0.0001"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all duration-200 placeholder-gray-400"
              />
              <input
                type="number"
                placeholder="Longitude"
                value={manualLng}
                onChange={(e) => setManualLng(e.target.value)}
                step="0.0001"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all duration-200 placeholder-gray-400"
              />
            </div>
            <button
              onClick={handleManualSubmit}
              disabled={!manualLat || !manualLng}
              className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-700 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg transition-all duration-200 hover:scale-[1.02] text-sm"
            >
              Use Coordinates
            </button>
          </div>
        </div>

        {/* 方式2: 地图点击 */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="w-6 h-6 bg-cyan-600 text-white rounded-full flex items-center justify-center text-xs font-bold mr-2">2</span>
            <h3 className="text-sm font-semibold text-white">Map Click</h3>
          </div>
          {mapClickCoordinate ? (
            <div className="space-y-2">
              <div className="bg-white/5 rounded-lg p-2 font-mono text-xs text-white">
                <div><span className="text-cyan-400">Lat:</span> {mapClickCoordinate.lat.toFixed(4)}</div>
                <div><span className="text-cyan-400">Lng:</span> {mapClickCoordinate.lng.toFixed(4)}</div>
              </div>
              <button
                onClick={handleUseMapClick}
                className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-700 hover:to-cyan-600 text-white font-medium py-2 rounded-lg transition-all duration-200 hover:scale-[1.02] text-sm"
              >
                Use This Location
              </button>
            </div>
          ) : (
            <p className="text-gray-400 text-xs">Click on the map to select a location</p>
          )}
        </div>

        {/* 方式3: 地址搜索 */}
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center mb-3">
            <span className="w-6 h-6 bg-cyan-600 text-white rounded-full flex items-center justify-center text-xs font-bold mr-2">3</span>
            <h3 className="text-sm font-semibold text-white">Address Search</h3>
          </div>
          <div className="space-y-2">
            <input
              type="text"
              placeholder="e.g., University of Waterloo"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddressSearch()}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all duration-200 placeholder-gray-400"
            />
            {searchError && (
              <p className="text-red-400 text-xs">{searchError}</p>
            )}
            <button
              onClick={handleAddressSearch}
              disabled={isSearching || !searchQuery.trim()}
              className="w-full bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-700 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 rounded-lg transition-all duration-200 hover:scale-[1.02] text-sm flex items-center justify-center"
            >
              {isSearching ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  Searching...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search Address
                </>
              )}
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

