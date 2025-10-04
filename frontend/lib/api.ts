// API 服务层 - 连接后端 FastAPI

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
const API_USER = 'admin'  // 可以从环境变量读取
const API_PASS = 'dev_password'  // 可以从环境变量读取

// 创建 Basic Auth header
const getAuthHeader = () => {
  const credentials = btoa(`${API_USER}:${API_PASS}`)
  return `Basic ${credentials}`
}

// 坐标转换：经度从 -180~180 转为 0~360
const lonTo0_360 = (lon: number): number => {
  return lon < 0 ? lon + 360 : lon
}

// 后端API接口定义
export interface QueryDataParams {
  coordinate: {
    lat: number
    lng: number
    source: string
  }
  startTime?: string
  endTime?: string
  variables?: string[]
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
 */
export const queryWeatherData = async (params: QueryDataParams): Promise<QueryDataResponse> => {
  const { coordinate, startTime, endTime, variables } = params
  
  // 计算查询区域：以坐标为中心，±0.5度范围
  const lat = coordinate.lat
  const lng = coordinate.lng
  const lat_min = lat - 0.5
  const lat_max = lat + 0.5
  const lon_min_0_360 = lonTo0_360(lng - 0.5)
  const lon_max_0_360 = lonTo0_360(lng + 0.5)
  
  // 构建后端需要的payload
  const payload = {
    db_path: 'grib_index.sqlite',
    start_iso: startTime || '2024-01-01T00:00:00Z',
    end_iso: endTime || '2024-12-31T23:59:59Z',
    lon_min_0_360,
    lon_max_0_360,
    lat_min,
    lat_max,
    vars_any: variables || ['t2m', 'u10', 'v10', 'prate'],  // 默认变量
    require_all: false,
    products: null,
    indexpath: ''
  }
  
  console.log('🔄 调用后端API:', `${API_BASE_URL}/api/query-data`)
  console.log('📦 请求参数:', payload)
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/query-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader()
      },
      body: JSON.stringify(payload)
    })
    
    if (!response.ok) {
      throw new Error(`API请求失败: ${response.status} ${response.statusText}`)
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

