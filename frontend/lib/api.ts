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
    level: string         // 层级类型（如 heightAboveGround）
    json_key: string      // 完整的变量键名（如 t2m_heightAboveGround）
    value_min: number
    value_max: number
    path: string
    lat: number           // 真实数据点的纬度
    lon: number           // 真实数据点的经度（0~360）
  }>
}

/**
 * 调用后端 /api/query-data 接口
 * 根据坐标和时间范围查询天气数据
 * 注意：后端接口只接受单个变量查询
 */
export const queryWeatherData = async (params: QueryDataParams): Promise<QueryDataResponse> => {
  const { coordinate, startTime, endTime, variable, level } = params
  
  // 计算查询区域：以坐标为中心，±1度范围（1°×1° 区域）
  const lat = coordinate.lat
  const lng = coordinate.lng
  const lat_min = lat - 1.0
  const lat_max = lat + 1.0
  const lon_min_0_360 = lonTo0_360(lng - 1.0)
  const lon_max_0_360 = lonTo0_360(lng + 1.0)
  
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
  'Wind': 'u10',
  'Pressure': 'pres',
  'Humidity': 'rh'
}

/**
 * 完整的变量名称映射表（type_level -> 显示名称）
 * 来自后端 GRIB 数据定义
 */
export const VARIABLE_DISPLAY_NAMES: Record<string, string> = {
  "pwat_atmosphereSingleLayer": "Precipitable water",
  "tcc_atmosphereSingleLayer": "Cloud Coverage",
  "cwork_atmosphereSingleLayer": "Cloud work function",
  "tcc_boundaryLayerCloudLayer": "Total Cloud Cover",
  "tcc_convectiveCloudLayer": "Total Cloud Cover",
  "t_depthBelowLandLayer": "Temperature",
  "soilw_depthBelowLandLayer": "Volumetric soil moisture content",
  "soill_depthBelowLandLayer": "Liquid volumetric soil moisture (non-frozen)",
  "ssw_depthBelowLandLayer": "Soil moisture content",
  "u10_heightAboveGround": "Wind Speed",
  "v10_heightAboveGround": "10 metre V wind component",
  "t2m_heightAboveGround": "Temperature",
  "tmax_heightAboveGround": "Maximum temperature",
  "tmin_heightAboveGround": "Minimum temperature",
  "sh2_heightAboveGround": "2 metre specific humidity",
  "qmax_heightAboveGround": "Maximum specific humidity at 2m",
  "qmin_heightAboveGround": "Minimum specific humidity at 2m",
  "pres_highCloudBottom": "Pressure",
  "tcc_highCloudLayer": "Total Cloud Cover",
  "pres_highCloudTop": "Pressure",
  "t_highCloudTop": "Temperature",
  "t_hybrid": "Temperature",
  "u_hybrid": "U component of wind",
  "v_hybrid": "V component of wind",
  "q_hybrid": "Specific humidity",
  "gh_hybrid": "Geopotential height",
  "pres_lowCloudBottom": "Pressure",
  "tcc_lowCloudLayer": "Total Cloud Cover",
  "pres_lowCloudTop": "Pressure",
  "t_lowCloudTop": "Temperature",
  "pres_middleCloudBottom": "Pressure",
  "tcc_middleCloudLayer": "Total Cloud Cover",
  "pres_middleCloudTop": "Pressure",
  "t_middleCloudTop": "Temperature",
  "sdswrf_nominalTop": "Surface downward short-wave radiation flux",
  "suswrf_nominalTop": "Surface upward short-wave radiation flux",
  "sulwrf_nominalTop": "Surface upward long-wave radiation flux",
  "csusf_nominalTop": "Clear Sky Upward Solar Flux",
  "csulf_nominalTop": "Clear Sky Upward Long Wave Flux",
  "unknown_surface": "unknown",
  "siconc_surface": "Sea ice area fraction",
  "slt_surface": "Soil type",
  "t_surface": "Temperature",
  "sp_surface": "Surface pressure",
  "lsm_surface": "Land-sea mask",
  "ishf_surface": "Instantaneous surface sensible heat net flux",
  "fsr_surface": "Forecast surface roughness",
  "prate_surface": "Precipitation rate",
  "sde_surface": "Snow depth",
  "utaua_surface": "U-component of atmospheric surface momentum flux",
  "vtaua_surface": "V-component of atmospheric surface momentum flux",
  "orog_surface": "Orography",
  "slhtf_surface": "Surface latent heat net flux",
  "snohf_surface": "Snow phase change heat flux",
  "srweq_surface": "Snowfall rate water equivalent",
  "crain_surface": "Categorical rain",
  "cpr_surface": "Precipitation",
  "snowc_surface": "Snow Coverage",
  "sdwe_surface": "Water equivalent of accumulated snow depth (deprecated)",
  "fricv_surface": "Frictional velocity",
  "iegwss_surface": "Instantaneous eastward gravity wave surface stress",
  "ingwss_surface": "Instantaneous northward gravity wave surface stress",
  "sdswrf_surface": "Surface downward short-wave radiation flux",
  "suswrf_surface": "Surface upward short-wave radiation flux",
  "sdlwrf_surface": "Surface downward long-wave radiation flux",
  "sulwrf_surface": "Surface upward long-wave radiation flux",
  "ssrun_surface": "Storm surface runoff",
  "veg_surface": "Vegetation",
  "watr_surface": "Water runoff",
  "gflux_surface": "Ground heat flux",
  "sfexc_surface": "Exchange coefficient",
  "cnwat_surface": "Plant canopy surface water",
  "sbsno_surface": "Sublimation (evaporation from snow)",
  "duvb_surface": "UV-B downward solar flux",
  "cduvb_surface": "Clear sky UV-B downward solar flux",
  "csdsf_surface": "Clear Sky Downward Solar Flux",
  "csusf_surface": "Clear Sky Upward Solar Flux",
  "vbdsf_surface": "Visible Beam Downward Solar Flux",
  "vddsf_surface": "Visible Diffuse Downward Solar Flux",
  "nbdsf_surface": "Near IR Beam Downward Solar Flux",
  "nddsf_surface": "Near IR Diffuse Downward Solar Flux",
  "csulf_surface": "Clear Sky Upward Long Wave Flux",
  "csdlf_surface": "Clear Sky Downward Long Wave Flux",
  "vgtyp_surface": "Vegetation Type",
  "acond_surface": "Aerodynamic conductance",
  "evcw_surface": "Canopy water evaporation",
  "trans_surface": "Transpiration",
  "sltyp_surface": "Surface Slope Type",
  "evbs_surface": "Direct evaporation from bare soil",
  "al_surface": "Forecast albedo",
  "sithick_surface": "Sea ice thickness"
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
 *       "path": "data/cfs/flxf2025100400.01.2025100312.grb2",
 *       "lat": 43.93681771851052,
 *       "lon": 281.24960835509063
 *     }
 *   ]
 * }
 */
export const transformQueryResults = (apiResponse: QueryDataResponse, coordinate?: { lat: number; lng: number }) => {
  const { count, results } = apiResponse
  
  // 提取唯一的文件路径
  const uniqueFiles = Array.from(new Set(results.map(r => r.path.split('/').pop() || r.path)))
  
  // 按时间戳和坐标分组数据（同一时间同一位置的不同变量）
  const groupedByTimeAndLocation = new Map<string, any>()
  
  results.forEach(item => {
    // 使用时间戳 + 坐标作为唯一键
    const key = `${item.prediction_time}_${item.lat.toFixed(6)}_${item.lon.toFixed(6)}`
    
    if (!groupedByTimeAndLocation.has(key)) {
      // 经度转换：0~360 → -180~180
      const lng = item.lon > 180 ? item.lon - 360 : item.lon
      
      groupedByTimeAndLocation.set(key, {
        timestamp: item.prediction_time,
        lat: item.lat,           // 使用真实坐标
        lng: lng,                // 转换后的经度
        rawData: []              // 存储原始数据（带显示名称）
      })
    }
    
    const point = groupedByTimeAndLocation.get(key)!
    
    // 使用后端返回的 json_key 获取显示名称
    const displayName = VARIABLE_DISPLAY_NAMES[item.json_key] || item.json_key || item.type
    
    // 格式化显示值（只显示 value_max）
    let displayValue = ''
    
    // 特殊处理：温度转换（开尔文 → 摄氏度）
    if (item.type === 't2m' || item.type === 'tmax' || item.type === 'tmin' || item.type === 't') {
      const celsius = item.value_max - 273.15
      displayValue = `${celsius.toFixed(2)}°C`
    } else {
      // 其他变量：显示原始值
      displayValue = item.value_max?.toFixed(3) || 'N/A'
    }
    
    // 添加到 rawData，包含显示信息
    point.rawData.push({
      ...item,
      displayName,
      displayValue
    })
  })
  
  // 转换为数组（只保留实际查询到的数据）
  const dataPoints = Array.from(groupedByTimeAndLocation.values()).map(point => ({
    timestamp: point.timestamp,
    lat: point.lat,
    lng: point.lng,
    rawData: point.rawData  // 包含所有原始数据和显示信息
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

