import { useState } from 'react'
import React from 'react'

interface QueryPanelProps {
  onQuerySubmit: (results: any) => void
  onLoading: (loading: boolean) => void
  selectedCoordinate?: { lat: number; lng: number; source: string } | null
  onSubmit?: () => void
}

export default function QueryPanel({ onQuerySubmit, onLoading, selectedCoordinate, onSubmit }: QueryPanelProps) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedVars, setSelectedVars] = useState<string[]>(['Temperature'])
  const [isExpanded, setIsExpanded] = useState(false)

  const variables = ['Temperature', 'Wind', 'Pressure', 'Humidity']

  const toggleVariable = (variable: string) => {
    setSelectedVars(prev => 
      prev.includes(variable)
        ? prev.filter(v => v !== variable)
        : [...prev, variable]
    )
  }

  // 提供给父组件调用
  React.useEffect(() => {
    if (onSubmit) {
      // 将handleSubmit暴露给父组件
      (window as any).__queryPanelSubmit = handleSubmit;
    }
  }, [onSubmit, selectedCoordinate, startDate, endDate, selectedVars])

  const handleSubmit = async () => {
    if (!selectedCoordinate) {
      alert('Please select a coordinate location first')
      return
    }

    onLoading(true)
    
    try {
      // 检查是否使用真实后端 (可通过环境变量控制)
      const useMockData = process.env.NEXT_PUBLIC_USE_MOCK === 'true'
      
      if (useMockData) {
        // 使用 Mock 数据
        console.log('🎭 使用 Mock 数据模式')
        const { mockQueryData } = await import('../../lib/mockData')
        const results = await mockQueryData({
          startTime: startDate,
          endTime: endDate,
          variables: selectedVars,
          coordinate: selectedCoordinate
        })
        onQuerySubmit(results)
      } else {
        // 使用真实后端 API
        console.log('🌐 使用真实后端 API')
        const { queryWeatherData, transformQueryResults, VARIABLE_MAP } = await import('../../lib/api')
        
        // 转换变量名
        const backendVars = selectedVars.map(v => VARIABLE_MAP[v] || v.toLowerCase())
        
        // 转换日期格式为 ISO
        const startISO = startDate ? `${startDate}T00:00:00Z` : undefined
        const endISO = endDate ? `${endDate}T23:59:59Z` : undefined
        
        const apiResponse = await queryWeatherData({
          coordinate: selectedCoordinate,
          startTime: startISO,
          endTime: endISO,
          variables: backendVars
        })
        
        // 转换为前端格式
        const results = transformQueryResults(apiResponse)
        
        console.log(`🔍 查询完成: 坐标(${selectedCoordinate.lat.toFixed(4)}, ${selectedCoordinate.lng.toFixed(4)}), 来源: ${selectedCoordinate.source}`)
        console.log(`📊 结果: ${results.count} 条数据, ${results.files.length} 个文件`)
        
        onQuerySubmit(results)
      }
    } catch (error) {
      console.error('❌ 查询失败:', error)
      alert(`Query failed: ${error instanceof Error ? error.message : 'Unknown error'}\n\nIf backend is not running, set NEXT_PUBLIC_USE_MOCK=true in .env.local to use mock data`)
    } finally {
      onLoading(false)
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
          <div className="w-8 h-8 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">Time</h2>
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
      <div className={`transition-all duration-300 ${isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
        <div className="px-5 pb-5 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Start Date</label>
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">End Date</label>
          <input 
            type="date" 
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all duration-200"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">Variables</label>
          <div className="flex flex-wrap gap-2">
            {variables.map((item) => (
              <button
                key={item}
                onClick={() => toggleVariable(item)}
                className={`px-3 py-1 border border-white/20 rounded-full text-xs text-white transition-all duration-200 hover:scale-105 ${
                  selectedVars.includes(item)
                    ? 'bg-gradient-to-r from-cyan-600 to-cyan-500'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

