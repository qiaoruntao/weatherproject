// Mock数据用于测试前端功能

export interface WeatherDataPoint {
  lat: number
  lng: number
  temperature: number
  windSpeed: number
  pressure: number
  humidity: number
  timestamp: string
}

export interface QueryResult {
  count: number
  files: string[]
  data: WeatherDataPoint[]
}

// 生成随机天气数据
export const generateMockWeatherData = (center: { lat: number; lng: number }, count: number = 10): WeatherDataPoint[] => {
  const data: WeatherDataPoint[] = []
  
  for (let i = 0; i < count; i++) {
    data.push({
      lat: center.lat + (Math.random() - 0.5) * 2,
      lng: center.lng + (Math.random() - 0.5) * 2,
      temperature: 15 + Math.random() * 15, // 15-30°C
      windSpeed: Math.random() * 20, // 0-20 m/s
      pressure: 1000 + Math.random() * 30, // 1000-1030 hPa
      humidity: 40 + Math.random() * 50, // 40-90%
      timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString()
    })
  }
  
  return data
}

// 模拟API查询
export const mockQueryData = async (params: {
  startTime?: string
  endTime?: string
  variables?: string[]
  coordinate?: { lat: number; lng: number }
  bounds?: { north: number; south: number; east: number; west: number }
}): Promise<QueryResult> => {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 800))
  
  // 使用传入的坐标或默认坐标
  const center = params.coordinate || { lat: 43.65, lng: -79.38 }
  const mockData = generateMockWeatherData(center, 15)
  
  console.log('🎭 Mock数据生成:', {
    center,
    dataPoints: mockData.length,
    variables: params.variables
  })
  
  return {
    count: mockData.length,
    files: [
      'cfs.2024010100.grb2',
      'cfs.2024010106.grb2',
      'cfs.2024010112.grb2',
      'cfs.2024010118.grb2'
    ],
    data: mockData
  }
}

// 模拟点查询
export const mockPointSearch = async (lat: number, lng: number, k: number = 5): Promise<WeatherDataPoint[]> => {
  await new Promise(resolve => setTimeout(resolve, 500))
  
  return generateMockWeatherData({ lat, lng }, k)
}

// 模拟网格数据
export const mockGridData = async (bounds: {
  north: number
  south: number
  east: number
  west: number
}): Promise<{ grid: number[][], lats: number[], lngs: number[] }> => {
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  const latStep = (bounds.north - bounds.south) / 20
  const lngStep = (bounds.east - bounds.west) / 20
  
  const lats = Array.from({ length: 20 }, (_, i) => bounds.south + i * latStep)
  const lngs = Array.from({ length: 20 }, (_, i) => bounds.west + i * lngStep)
  
  const grid = lats.map(() => 
    lngs.map(() => 15 + Math.random() * 15)
  )
  
  return { grid, lats, lngs }
}

