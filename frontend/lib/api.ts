// API 服务层 - 连接后端 FastAPI

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'

// 可选的 Basic Auth（如果后端需要）
const API_USER = process.env.NEXT_PUBLIC_API_USER || ''
const API_PASS = process.env.NEXT_PUBLIC_API_PASS || ''

// 创建 Basic Auth header（如果配置了用户名密码）
const getAuthHeader = () => {
  if (API_USER && API_PASS) {
    const credentials = btoa(`${API_USER}:${API_PASS}`)
    return `Basic ${credentials}`
  }
  return ''
}

// 坐标转换：经度从 -180~180 转为 0~360
const lonTo0_360 = (lon: number): number => {
  return lon < 0 ? lon + 360 : lon
}

// 后端API接口定义（匹配后端 DataQueryPayload）
export interface QueryDataParams {
  coordinate: {
    lat: number
    lng: number
    source: string
  }
  startTime?: string
  endTime?: string
  variable: string      // 单个变量（后端要求）
  level?: string        // level 参数（后端要求，默认 'surface'）
}

export interface QueryDataResponse {
  count: number
  results: Array<{
    prediction_time: string
    create_time: string
    type: string
    value_min: number
    value_max: number
    path: string
  }>
}

/**
 * 调用后端 /api/query-data 接口
 * 根据坐标和时间范围查询天气数据
 * 注意：后端接口只接受单个变量查询
 */
export const queryWeatherData = async (params: QueryDataParams): Promise<QueryDataResponse> => {
  const { coordinate, startTime, endTime, variable, level } = params
  
  // 计算查询区域：以坐标为中心，±0.5度范围
  const lat = coordinate.lat
  const lng = coordinate.lng
  const lat_min = lat - 0.5
  const lat_max = lat + 0.5
  const lon_min_0_360 = lonTo0_360(lng - 0.5)
  const lon_max_0_360 = lonTo0_360(lng + 0.5)
  
  // 构建后端需要的payload（严格匹配 DataQueryPayload）
  // 默认使用今天的日期
  const today = new Date().toISOString().split('T')[0]
  const payload = {
    start_iso: startTime || `${today}T00:00:00Z`,
    end_iso: endTime || `${today}T23:59:59Z`,
    lon_min_0_360,
    lon_max_0_360,
    lat_min,
    lat_max,
    level: level || 'heightAboveGround',    // 必需参数
    variable: variable,                      // 必需参数（单个变量）
    indexpath: ''                            // 可选参数
  }
  
  console.log('🔄 调用后端API:', `${API_BASE_URL}/api/query-data`)
  console.log('📦 请求参数:', payload)
  
  try {
    // 构建 headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    
    // 如果有 Auth，添加 Authorization header
    const authHeader = getAuthHeader()
    if (authHeader) {
      headers['Authorization'] = authHeader
    }
    
    const response = await fetch(`${API_BASE_URL}/api/query-data`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API请求失败: ${response.status} ${response.statusText}\n${errorText}`)
    }
    
    const data = await response.json()
    console.log('✅ 后端返回:', data)
    
    return data
  } catch (error) {
    console.error('❌ API调用失败:', error)
    throw error
  }
}

/**
 * 查询多个变量（循环调用单变量接口）
 * 后端只支持单变量查询，所以需要循环调用
 */
export const queryMultipleVariables = async (
  coordinate: { lat: number; lng: number; source: string },
  startTime: string | undefined,
  endTime: string | undefined,
  variables: string[],
  level?: string
): Promise<QueryDataResponse> => {
  console.log(`🔄 开始查询 ${variables.length} 个变量:`, variables)
  
  const allResults: any[] = []
  
  for (const variable of variables) {
    try {
      console.log(`  ➤ 查询变量: ${variable}`)
      const response = await queryWeatherData({
        coordinate,
        startTime,
        endTime,
        variable,
        level
      })
      
      if (response.results && response.results.length > 0) {
        allResults.push(...response.results)
        console.log(`  ✅ ${variable}: 找到 ${response.results.length} 条数据`)
      } else {
        console.log(`  ⚠️ ${variable}: 无数据`)
      }
    } catch (error) {
      console.error(`  ❌ ${variable} 查询失败:`, error)
      // 继续查询其他变量，不中断
    }
  }
  
  console.log(`✅ 多变量查询完成: 总共 ${allResults.length} 条数据`)
  
  return {
    count: allResults.length,
    results: allResults
  }
}

/**
 * 健康检查接口
 */
export const healthCheck = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/healthz`)
    const data = await response.json()
    return data.ok === true
  } catch (error) {
    console.error('健康检查失败:', error)
    return false
  }
}

/**
 * 变量名映射：前端显示名 -> 后端变量名
 */
export const VARIABLE_MAP: Record<string, string> = {
  'Temperature': 't2m',
  'Wind': 'u10',  // 可以查询 u10 和 v10
  'Pressure': 'pres',
  'Humidity': 'rh'
}

/**
 * 将后端返回的结果转换为前端需要的格式
 * 后端返回的数据格式：
 * {
 *   "count": 3,
 *   "results": [
 *     {
 *       "prediction_time": "2025-10-04T00:00:00+00:00",
 *       "create_time": "2025-10-03T12:00:00+00:00",
 *       "type": "t2m",
 *       "value_min": 289.84,
 *       "value_max": 289.84,
 *       "path": "data/cfs/flxf2025100400.01.2025100312.grb2"
 *     }
 *   ]
 * }
 */
export const transformQueryResults = (apiResponse: QueryDataResponse, coordinate?: { lat: number; lng: number }) => {
  const { count, results } = apiResponse
  
  // 提取唯一的文件路径
  const uniqueFiles = Array.from(new Set(results.map(r => r.path.split('/').pop() || r.path)))
  
  // 按时间戳分组数据（同一时间的不同变量）
  const groupedByTime = new Map<string, any>()
  
  results.forEach(item => {
    const timestamp = item.prediction_time
    if (!groupedByTime.has(timestamp)) {
      groupedByTime.set(timestamp, {
        timestamp,
        lat: coordinate?.lat || 0,
        lng: coordinate?.lng || 0,
        temperature: null,
        windSpeed: null,
        pressure: null,
        humidity: null,
        rawData: []
      })
    }
    
    const point = groupedByTime.get(timestamp)!
    point.rawData.push(item)
    
    // 根据变量类型填充数据
    switch (item.type) {
      case 't2m':
        // 温度：开尔文转摄氏度
        point.temperature = item.value_max - 273.15
        break
      case 'u10':
      case 'v10':
        // 风速：使用 value_max
        point.windSpeed = item.value_max
        break
      case 'pres':
        // 气压：Pa 转 hPa
        point.pressure = item.value_max / 100
        break
      case 'rh':
        // 湿度：百分比
        point.humidity = item.value_max
        break
    }
  })
  
  // 转换为数组并填充缺失值
  const dataPoints = Array.from(groupedByTime.values()).map(point => ({
    ...point,
    temperature: point.temperature !== null ? point.temperature : 0,
    windSpeed: point.windSpeed !== null ? point.windSpeed : 0,
    pressure: point.pressure !== null ? point.pressure : 0,
    humidity: point.humidity !== null ? point.humidity : 0
  }))
  
  // 按时间排序
  dataPoints.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  
  return {
    count: dataPoints.length,
    files: uniqueFiles,
    data: dataPoints,
    rawResults: results
  }
}

