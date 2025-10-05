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
 */
export const transformQueryResults = (apiResponse: QueryDataResponse) => {
  const { count, results } = apiResponse
  
  // 提取唯一的文件路径
  const uniqueFiles = Array.from(new Set(results.map(r => r.path.split('/').pop() || r.path)))
  
  // 转换为前端显示格式（兼容现有 ResultsPanel）
  const dataPoints = results.map((item, index) => ({
    lat: 43.65,  // 示例值，实际应从查询参数或结果中获取
    lng: -79.38,
    temperature: item.type === 't2m' ? item.value_max - 273.15 : 20,  // 转为摄氏度
    windSpeed: item.type === 'u10' ? item.value_max : 10,
    pressure: item.type === 'pres' ? item.value_max / 100 : 1013,  // 转为 hPa
    humidity: item.type === 'rh' ? item.value_max : 60,
    timestamp: item.prediction_time,
    rawData: item  // 保留原始数据
  }))
  
  return {
    count,
    files: uniqueFiles,
    data: dataPoints,
    rawResults: results
  }
}

