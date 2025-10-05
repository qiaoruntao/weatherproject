import { useState, useEffect, useRef } from 'react'

interface VisualizationPanelProps {
  results: any
  onClose: () => void
}

export default function VisualizationPanel({ results, onClose }: VisualizationPanelProps) {
  const [selectedVariable, setSelectedVariable] = useState<string>('t2m')
  const [currentTimeIndex, setCurrentTimeIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number>()

  // 变量配置（必须与 QueryPanel 中的 variableOptions 一致）
  const variableOptions = [
    { type: 't2m', label: 'Temperature', icon: '🌡️', color: '#EF4444', jsonKey: 't2m_heightAboveGround' },
    { type: 'tcc', label: 'Cloud Coverage', icon: '☁️', color: '#9CA3AF', jsonKey: 'tcc_atmosphereSingleLayer' },
    { type: 'u10', label: 'Wind Speed', icon: '💨', color: '#06B6D4', jsonKey: 'u10_heightAboveGround' },
    { type: 'snowc', label: 'Snow Coverage', icon: '❄️', color: '#93C5FD', jsonKey: 'snowc_surface' },
    { type: 'cpr', label: 'Precipitation', icon: '🌧️', color: '#3B82F6', jsonKey: 'cpr_surface' }
  ]

  // 获取时间序列数据
  const getTimeSeriesData = () => {
    if (!selectedVariable || !results?.data) return []

    const timeSeriesMap = new Map<string, any>()

    results.data.forEach((point: any) => {
      const timestamp = point.timestamp
      if (!timeSeriesMap.has(timestamp)) {
        timeSeriesMap.set(timestamp, {
          timestamp,
          lat: point.lat,
          lng: point.lng,
          value: null,
          displayValue: null
        })
      }

      const timePoint = timeSeriesMap.get(timestamp)!
      if (point.rawData) {
        const varData = point.rawData.find((item: any) => item.type === selectedVariable)
        if (varData) {
          timePoint.value = varData.value_max
          timePoint.displayValue = varData.displayValue
        }
      }
    })

    return Array.from(timeSeriesMap.values()).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
  }

  const timeSeriesData = getTimeSeriesData()
  const currentData = timeSeriesData[currentTimeIndex]

  // 动画播放（20帧/秒）
  useEffect(() => {
    if (!isPlaying || timeSeriesData.length === 0) return

    const interval = setInterval(() => {
      setCurrentTimeIndex(prev => {
        if (prev >= timeSeriesData.length - 1) {
          return 0 // 循环播放
        }
        return prev + 1
      })
    }, 50) // 50ms = 20帧/秒

    return () => clearInterval(interval)
  }, [isPlaying, timeSeriesData.length])

  // Canvas 持续动画渲染（60 FPS）
  useEffect(() => {
    if (!canvasRef.current || !currentData) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const animate = () => {
      const width = canvas.width
      const height = canvas.height

      // 清空画布
      ctx.clearRect(0, 0, width, height)

      // 绘制地图背景和网格
      drawMapGrid(ctx, width, height, currentData)

      // 根据变量类型绘制天气效果
      if (selectedVariable === 't2m') {
        drawTemperatureMap(ctx, width, height, currentData.value)
      } else if (selectedVariable === 'u10') {
        drawWindMap(ctx, width, height, currentData.value)
      } else if (selectedVariable === 'snowc') {
        drawSnowMap(ctx, width, height, currentData.value)
      } else if (selectedVariable === 'cpr') {
        drawRainMap(ctx, width, height, currentData.value)
      } else if (selectedVariable === 'tcc') {
        drawCloudMap(ctx, width, height, currentData.value)
      }

      // 绘制坐标和数值标注
      drawLabels(ctx, width, height, currentData)

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId)
      }
    }
  }, [currentData, selectedVariable])

  // 绘制地图网格（1°x1° 区域）
  const drawMapGrid = (ctx: CanvasRenderingContext2D, width: number, height: number, data: any) => {
    // 深色地图背景
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#0f172a')
    gradient.addColorStop(1, '#1e293b')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    // 绘制经纬度网格（10x10 = 0.1度间隔）
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'
    ctx.lineWidth = 1

    for (let i = 0; i <= 20; i++) {
      // 纬线
      const y = (i / 20) * height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()

      // 经线
      const x = (i / 20) * width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // 加粗主网格线（0.5度间隔）
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)'
    ctx.lineWidth = 2

    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()

      const x = (i / 4) * width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    // 中心点标记
    ctx.fillStyle = '#EF4444'
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 3
    ctx.stroke()

    // 中心十字线
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)'
    ctx.lineWidth = 2
    ctx.setLineDash([10, 5])
    ctx.beginPath()
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // 温度地图（专业热力图）
  const drawTemperatureMap = (ctx: CanvasRenderingContext2D, width: number, height: number, value: number) => {
    // 异常数据处理：温度应该在合理范围内（-100°C ~ 100°C）
    let celsius = value - 273.15
    if (celsius < -100 || celsius > 100 || isNaN(celsius)) {
      celsius = 20 // 默认值
    }
    
    // 创建多层径向渐变（模拟温度扩散）
    const numLayers = 5
    for (let layer = numLayers; layer > 0; layer--) {
      const gradient = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, (width / 2) * (layer / numLayers)
      )
      
      const opacity = 0.15 * (layer / numLayers)
      
      if (celsius < 0) {
        gradient.addColorStop(0, `rgba(59, 130, 246, ${opacity * 2})`)
        gradient.addColorStop(1, `rgba(30, 58, 138, ${opacity})`)
      } else if (celsius < 10) {
        gradient.addColorStop(0, `rgba(16, 185, 129, ${opacity * 2})`)
        gradient.addColorStop(1, `rgba(6, 95, 70, ${opacity})`)
      } else if (celsius < 20) {
        gradient.addColorStop(0, `rgba(251, 191, 36, ${opacity * 2})`)
        gradient.addColorStop(1, `rgba(146, 64, 14, ${opacity})`)
      } else if (celsius < 30) {
        gradient.addColorStop(0, `rgba(249, 115, 22, ${opacity * 2})`)
        gradient.addColorStop(1, `rgba(124, 45, 18, ${opacity})`)
      } else {
        gradient.addColorStop(0, `rgba(239, 68, 68, ${opacity * 2})`)
        gradient.addColorStop(1, `rgba(127, 29, 29, ${opacity})`)
      }
      
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    }

    // 等温线效果
    const time = Date.now() / 1000
    const numContours = 4
    for (let i = 0; i < numContours; i++) {
      const radius = 50 + i * 80 + Math.sin(time + i) * 20
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.2 - i * 0.04})`
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // 温度计图标
    drawThermometerIcon(ctx, width / 2, height / 2, celsius)
  }

  // 绘制温度计图标（分层大小）
  const drawThermometerIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, celsius: number) => {
    // 根据温度分层确定大小
    let scale = 1.5 // 默认
    if (Math.abs(celsius) < 10) {
      scale = 1.2 // 小号：-10°C ~ 10°C
    } else if (Math.abs(celsius) < 20) {
      scale = 1.5 // 中号：10°C ~ 20°C
    } else if (Math.abs(celsius) < 30) {
      scale = 1.8 // 大号：20°C ~ 30°C
    } else {
      scale = 2.1 // 超大号：> 30°C
    }
    
    // 温度计外壳
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(x - 12 * scale, y - 35 * scale, 24 * scale, 50 * scale, 12 * scale)
    ctx.fill()
    ctx.stroke()

    // 温度计底部球
    ctx.beginPath()
    ctx.arc(x, y + 20 * scale, 16 * scale, 0, Math.PI * 2)
    ctx.fillStyle = celsius > 20 ? '#EF4444' : celsius > 0 ? '#FBBF24' : '#3B82F6'
    ctx.fill()
    ctx.stroke()

    // 温度刻度
    const fillHeight = Math.min(Math.max((celsius + 20) / 60, 0), 1) * 40 * scale
    ctx.fillStyle = celsius > 20 ? '#EF4444' : celsius > 0 ? '#FBBF24' : '#3B82F6'
    ctx.fillRect(x - 6 * scale, y + 15 * scale - fillHeight, 12 * scale, fillHeight)

    // 温度文字
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `bold ${20 + scale * 4}px Arial`
    ctx.textAlign = 'center'
    ctx.fillText(`${celsius.toFixed(1)}°C`, x, y - 60 * scale)
  }

  // 风速地图（流场可视化）
  const drawWindMap = (ctx: CanvasRenderingContext2D, width: number, height: number, windValue: number) => {
    // 处理风速方向：负值表示反向
    const windSpeed = Math.abs(windValue || 5)
    const windNum = Math.abs(windValue || 5)
    const isReverse = windValue < 0 // 负值 = 反向（从右向左）
    
    const numStreamlines = windSpeed == 0? 0 : 40
    // const numStreamlines = Math.min(Math.floor(windSpeed * 1), 40)
    const time = Date.now() / 80
    
    // 绘制流线
    for (let i = 0; i < numStreamlines; i++) {
      const yStart = (i / numStreamlines) * height
      const waveAmp = (15 + Math.sin(time / 20 + i) * 10) * windNum
      const waveFreq = 0.01 + i * 0.0005
      
      ctx.strokeStyle = `rgba(6, 182, 212, ${0.6 - i * 0.01})`
      ctx.lineWidth = 2 + Math.sin(time + i) * 0.5
      ctx.beginPath()
      
      if (isReverse) {
        // 反向：从右向左
        const offset = width - ((time + i * 15) % (width + 100))
        for (let x = width + 100; x > offset; x -= 5) {
          const y = yStart + Math.sin(x * waveFreq + time / 10) * waveAmp
          if (x === width + 100) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.stroke()
        
        // 箭头（向左）
        const x = offset
        const y = yStart + Math.sin(x * waveFreq + time / 10) * waveAmp
        ctx.fillStyle = `rgba(6, 182, 212, ${0.8 - i * 0.015})`
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + 18, y - 8)
        ctx.lineTo(x + 18, y + 8)
        ctx.closePath()
        ctx.fill()
      } else {
        // 正向：从左向右
        const offset = (time + i * 15) % (width + 100)
        for (let x = -100; x < offset; x += 5) {
          const y = yStart + Math.sin(x * waveFreq + time / 10) * waveAmp
          if (x === -100) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
        ctx.stroke()
        
        // 箭头（向右）
        const x = offset
        const y = yStart + Math.sin(x * waveFreq + time / 10) * waveAmp
        ctx.fillStyle = `rgba(6, 182, 212, ${0.8 - i * 0.015})`
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x - 18, y - 8)
        ctx.lineTo(x - 18, y + 8)
        ctx.closePath()
        ctx.fill()
      }
    }

    // 风车图标
    drawWindmillIcon(ctx, width / 2, height / 2, time / 15, windValue)
  }

  // 绘制风车图标（分层大小）
  const drawWindmillIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, windValue: number) => {
    const speed = Math.abs(windValue || 0)
    
    // 根据风速分层确定大小
    let scale = 1.0 // 默认
    if (speed < 5) {
      scale = 0.7 // 小号：0-5 m/s
    } else if (speed < 10) {
      scale = 1.0 // 中号：5-10 m/s
    } else if (speed < 15) {
      scale = 1.3 // 大号：10-15 m/s
    } else {
      scale = 1.6 // 超大号：> 15 m/s
    }
    
    ctx.save()
    ctx.translate(x, y)
    
    // 风车杆
    ctx.fillStyle = '#78350f'
    ctx.fillRect(-10 * scale, 0, 20 * scale, 100 * scale)
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 2
    ctx.strokeRect(-10 * scale, 0, 20 * scale, 100 * scale)
    
    // 风车叶片（旋转）
    ctx.rotate(rotation * (0.5 + speed * 0.1)) // 风速越大，旋转越快
    for (let i = 0; i < 3; i++) {
      ctx.save()
      ctx.rotate((i * Math.PI * 2) / 3)
      
      // 叶片
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(-20 * scale, -80 * scale)
      ctx.lineTo(20 * scale, -80 * scale)
      ctx.closePath()
      ctx.fill()
      
      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = 3
      ctx.stroke()
      
      ctx.restore()
    }
    
    // 中心圆
    ctx.beginPath()
    ctx.arc(0, 0, 15 * scale, 0, Math.PI * 2)
    ctx.fillStyle = '#DC2626'
    ctx.fill()
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 3
    ctx.stroke()
    
    ctx.restore()

    // 风速文字（显示 W/E 方向）
    const direction = windValue >= 0 ? 'W' : 'E' // 正数=西风，负数=东风
    
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `bold ${20 + scale * 8}px Arial`
    ctx.textAlign = 'center'
    ctx.fillText(`${speed.toFixed(1)} m/s ${direction}`, x, y - 80 * scale)
  }

  // 雪覆盖地图（改为雪花降落速度）
  const drawSnowMap = (ctx: CanvasRenderingContext2D, width: number, height: number, value: number) => {
    // value 现在表示雪花降落速度（snowc 的值）
    // 异常数据处理
    let snowFallSpeed = value || 0
    if (snowFallSpeed < 0) snowFallSpeed = 0
    if (snowFallSpeed > 1) snowFallSpeed = 1
    
    // 如果雪花降落速度为0，不显示雪
    if (snowFallSpeed === 0) {
      // 只显示无雪的背景
      ctx.fillStyle = 'rgba(30, 58, 138, 0.1)'
      ctx.fillRect(0, 0, width, height)
      
      // 显示"无降雪"提示
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 32px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('No Snowfall', width / 2, height / 2)
      return
    }
    // 雪花大小根据降雪速度分层（数据越大，雪花越大）
    let snowSize = 0.5 // 默认最小
    if (snowFallSpeed < 0.2) {
      snowSize = 0.5 // 小号：0-20%
    } else if (snowFallSpeed < 0.4) {
      snowSize = 1.0 // 中号：20-40%
    } else if (snowFallSpeed < 0.7) {
      snowSize = 1.5 // 大号：40-70%
    } else {
      snowSize = 2.0 // 超大号：> 70%
    }
    
    // 雪花数量固定为30（稀疏）
    const numFlakes = snowFallSpeed == 0 ? 0 : 30
    const fallSpeedMultiplier = 1 + snowFallSpeed * 2 // 速度倍数：1-3倍
    const time = Date.now() / 40
    
    // 雪花飘落（大小根据 snowSize 调整，更稀疏）
    for (let i = 0; i < numFlakes; i++) {
      // 增加水平和垂直间距
      const horizontalSpacing = (width + 200) / Math.max(numFlakes, 1)
      const x = ((time * (0.6 + i * 0.1)) % (width + 200)) - 100 + (i * horizontalSpacing * 0.5) % width
      const y = ((time * fallSpeedMultiplier * (1.2 + i * 0.06)) % (height + 150)) - 75
      const size = (2 + (i % 4)) * snowSize // 基础大小 2-5px * 倍数 0.5-2.0 = 1-10px
      const rotation = (time + i * 10) % 360
      
      // 确保雪花不会太密集（跳过一些位置）
      if (i % 2 === 0 || snowFallSpeed > 0.5) {
        drawSnowflake(ctx, x, y, size, rotation)
      }
    }
    
    // 地面积雪层（厚度根据降落速度累积）
    const snowHeight = Math.min(snowFallSpeed * height * 0.4, height * 0.4)
    const gradient = ctx.createLinearGradient(0, height - snowHeight, 0, height)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.7)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.9)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, height - snowHeight, width, snowHeight)

    // 积雪纹理
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * width
      const y = height - snowHeight + Math.random() * snowHeight
      ctx.beginPath()
      ctx.arc(x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }

    // 雪人图标
    if (snowHeight > 50) {
      drawSnowmanIcon(ctx, width / 2, height - snowHeight - 70, snowFallSpeed)
    }
    
    // 显示降雪速度
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 24px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(`Snowfall Rate: ${(snowFallSpeed * 100).toFixed(1)}%`, width / 2, 50)
  }

  // 绘制雪花
  const drawSnowflake = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rotation: number) => {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((rotation * Math.PI) / 180)
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.strokeStyle = 'rgba(200, 220, 255, 0.8)'
    ctx.lineWidth = 1
    
    for (let i = 0; i < 6; i++) {
      ctx.save()
      ctx.rotate((i * Math.PI) / 3)
      
      // 主轴
      ctx.fillRect(-size / 3, -size * 1.5, size / 1.5, size * 3)
      
      // 分支
      ctx.save()
      ctx.translate(0, -size)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-size / 4, -size / 2, size / 2, size)
      ctx.restore()
      
      ctx.restore()
    }
    
    ctx.restore()
  }

  // 绘制雪人图标（分层大小）
  const drawSnowmanIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, snowFallSpeed: number) => {
    // 根据降雪速度分层确定大小
    let scale = 1.0 // 默认
    if (snowFallSpeed < 0.2) {
      scale = 0.6 // 小号：0-20%
    } else if (snowFallSpeed < 0.4) {
      scale = 0.8 // 中号：20-40%
    } else if (snowFallSpeed < 0.7) {
      scale = 1.0 // 大号：40-70%
    } else {
      scale = 1.2 // 超大号：> 70%
    }
    
    // 底部球
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.strokeStyle = '#1e293b'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y + 40 * scale, 35 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 中间球
    ctx.beginPath()
    ctx.arc(x, y, 26 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 头部球
    ctx.beginPath()
    ctx.arc(x, y - 30 * scale, 20 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // 眼睛
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(x - 7 * scale, y - 33 * scale, 3 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x + 7 * scale, y - 33 * scale, 3 * scale, 0, Math.PI * 2)
    ctx.fill()

    // 鼻子（胡萝卜）
    ctx.fillStyle = '#F97316'
    ctx.beginPath()
    ctx.moveTo(x, y - 28 * scale)
    ctx.lineTo(x + 15 * scale, y - 28 * scale)
    ctx.lineTo(x, y - 24 * scale)
    ctx.closePath()
    ctx.fill()

    // 帽子
    ctx.fillStyle = '#000000'
    ctx.fillRect(x - 22 * scale, y - 45 * scale, 44 * scale, 5 * scale)
    ctx.fillRect(x - 15 * scale, y - 60 * scale, 30 * scale, 15 * scale)

    // 纽扣
    ctx.fillStyle = '#000000'
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.arc(x, y - 5 * scale + i * 12 * scale, 3 * scale, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 降水地图
  const drawRainMap = (ctx: CanvasRenderingContext2D, width: number, height: number, precipValue: number) => {
    // 异常数据处理
    let precipRate = precipValue || 0
    if (precipRate < 0) precipRate = 0
    
    // 如果降水率为0，不显示雨
    if (precipRate === 0) {
      // 只显示无雨的背景
      ctx.fillStyle = 'rgba(55, 65, 81, 0.1)'
      ctx.fillRect(0, 0, width, height)
      
      // 显示"无降水"提示
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 32px Arial'
      ctx.textAlign = 'center'
      ctx.fillText('No Precipitation', width / 2, height / 2)
      return
    }
    
    // 雨滴大小根据降水率分层（数据越大，雨滴越大）
    let rainSize = 0.5 // 默认最小
    if (precipRate < 0.00005) {
      rainSize = 0.5 // 小号：0-0.00005
    } else if (precipRate < 0.0001) {
      rainSize = 1.0 // 中号：0.00005-0.0001
    } else if (precipRate < 0.0002) {
      rainSize = 1.5 // 大号：0.0001-0.0002
    } else {
      rainSize = 2.0 // 超大号：> 0.0002
    }
    
    // 雨滴数量固定为80（稀疏）
    const numDrops = precipRate == 0 ? 0 : 80
    const time = Date.now() / 25
    
    // 雨滴（更稀疏）
    for (let i = 0; i < numDrops; i++) {
      // 增加间距
      const horizontalSpacing = (width + 100) / Math.max(numDrops, 1)
      const x = ((time * (0.7 + i * 0.1)) % (width + 100)) - 50 + (i * horizontalSpacing * 0.3) % width
      const y = ((time * (3.5 + i * 0.1)) % (height + 80)) - 40
      
      // 雨滴线条（大小根据 rainSize 调整）
      const gradient = ctx.createLinearGradient(x, y, x - 4 * rainSize, y + 20 * rainSize)
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)')
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.3)')
      ctx.strokeStyle = gradient
      ctx.lineWidth = 2 * rainSize // 雨滴粗细根据大小调整
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x - 4 * rainSize, y + 20 * rainSize)
      ctx.stroke()
      
      // 水花效果（大小根据 rainSize 调整）
      if (y > height - 30) {
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)'
        ctx.lineWidth = 1 * rainSize
        ctx.beginPath()
        ctx.arc(x, height - 15, 4 * rainSize, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    
    // 地面水坑（高度根据降水率调整）
    const puddleHeight = Math.min(20 + precipRate * 100000, 40) * rainSize
    const puddle = ctx.createLinearGradient(0, height - puddleHeight, 0, height)
    puddle.addColorStop(0, 'rgba(59, 130, 246, 0.3)')
    puddle.addColorStop(1, 'rgba(59, 130, 246, 0.5)')
    ctx.fillStyle = puddle
    ctx.fillRect(0, height - puddleHeight, width, puddleHeight)

    // 雨伞图标
    drawUmbrellaIcon(ctx, width / 2, height / 2, precipValue)
  }

  // 绘制雨伞图标（分层大小）
  const drawUmbrellaIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, precipValue: number) => {
    // 根据降水率分层确定大小
    let scale = 1.0 // 默认
    if (precipValue < 0.00005) {
      scale = 0.6 // 小号：0-0.00005
    } else if (precipValue < 0.0001) {
      scale = 0.8 // 中号：0.00005-0.0001
    } else if (precipValue < 0.0002) {
      scale = 1.0 // 大号：0.0001-0.0002
    } else {
      scale = 1.2 // 超大号：> 0.0002
    }
    
    // 伞柄
    ctx.strokeStyle = '#78350f'
    ctx.lineWidth = 5 * scale
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, y + 70 * scale)
    ctx.stroke()

    // 伞柄弯钩
    ctx.beginPath()
    ctx.arc(x + 10 * scale, y + 70 * scale, 10 * scale, Math.PI, 0)
    ctx.stroke()

    // 伞面
    ctx.fillStyle = 'rgba(239, 68, 68, 0.95)'
    ctx.strokeStyle = '#7F1D1D'
    ctx.lineWidth = 3 * scale
    ctx.beginPath()
    ctx.arc(x, y, 60 * scale, Math.PI, 0, true)
    ctx.fill()
    ctx.stroke()

    // 伞骨
    for (let i = -3; i <= 3; i++) {
      ctx.strokeStyle = '#7F1D1D'
      ctx.lineWidth = 2 * scale
      ctx.beginPath()
      ctx.moveTo(x, y)
      const angle = Math.PI + (i * Math.PI) / 8
      ctx.lineTo(x + Math.cos(angle) * 60 * scale, y + Math.sin(angle) * 60 * scale)
      ctx.stroke()
    }

    // 降水率文字
    ctx.fillStyle = '#FFFFFF'
    ctx.font = `bold ${16 + scale * 4}px Arial`
    ctx.textAlign = 'center'
    ctx.fillText(`${(precipValue || 0).toFixed(5)} kg/m²/s`, x, y - 80 * scale)
  }

  // 云层地图
  const drawCloudMap = (ctx: CanvasRenderingContext2D, width: number, height: number, value: number) => {
    // 异常数据处理
    let cloudCoverage = (value)
    
    // if (cloudCoverage < 0) cloudCoverage = 0
    // if (cloudCoverage > 1) cloudCoverage = cloudCoverage
    let cloudSize = cloudCoverage * 10
    // 量化云量等级（更清晰的分级）
    let cloudLevel = 0
    let cloudLevelText = ''
    if (cloudCoverage < 10) {
      cloudLevel = 0
      cloudLevelText = 'Clear Sky'
    } else if (cloudCoverage < 30) {
      cloudLevel = 1
      cloudLevelText = 'Few Clouds'
    } else if (cloudCoverage < 60) {
      cloudLevel = 2
      cloudLevelText = 'Scattered Clouds'
    } else if (cloudCoverage < 90) {
      cloudLevel = 3
      cloudLevelText = 'Broken Clouds'
    } else {
      cloudLevel = 4
      cloudLevelText = 'Overcast'
    }
    
    // 根据量化等级确定云朵数量（极度稀疏）
    // const numClouds = cloudLevel == 0? 0:10
    const numClouds = cloudLevel * 3
    // const numClouds = Math.max(cloudLevel - 1, 0) * 2 // 0, 0, 2, 4, 6 朵（减少数量）
    const time = Date.now() / 200 // 减慢移动速度
    
    // 绘制云朵（更小，间距极大）
    for (let i = 0; i < numClouds; i++) {
      // 极大间距，确保不重叠
      const horizontalSpacing = width / Math.max(numClouds, 1) // 平均分布
      const x = ((time * (0.2 + i * 0.2)) % (width + 600)) - 300 + i * horizontalSpacing
      const y = 60 + (i % 3) * (height * 0.25) // 3层垂直分布
      const size = 20 + (i % 2) * 8 // 更小：20-28像素
      const opacity = 0.25 + cloudCoverage * 0.35
      
      // 云朵阴影
      ctx.fillStyle = `rgba(100, 116, 139, ${opacity * 0.3})`
      drawCloud(ctx, x + 5, y + 5, size)
      
      // 云朵主体
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
      drawCloud(ctx, x, y, size)
    }

    // 太阳图标（更小）
    drawSunIcon(ctx, width / 2, height / 2, time / 8, cloudCoverage)
    
    // 显示量化的云量等级
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
    ctx.fillRect(width / 2 - 120, height - 60, 240, 50)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)'
    ctx.lineWidth = 2
    ctx.strokeRect(width / 2 - 120, height - 60, 240, 50)
    
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 22px Arial'
    ctx.textAlign = 'center'
    ctx.fillText(cloudLevelText, width / 2, height - 30)
    ctx.font = '16px Arial'
    ctx.fillText(`${(cloudCoverage * 100).toFixed(1)}% Coverage`, width / 2, height - 10)
  }

  // 绘制云朵形状
  // resize the cloud
  const drawCloud = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
    ctx.beginPath()
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2)
    ctx.arc(x + size * 0.5, y - size * 0.25, size * 0.45, 0, Math.PI * 2)
    ctx.arc(x + size, y, size * 0.5, 0, Math.PI * 2)
    ctx.arc(x + size * 0.5, y + size * 0.25, size * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }

  // 绘制太阳图标（分层大小）
  const drawSunIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, rotation: number, cloudCoverage: number) => {
    // 根据云量反向确定太阳大小（云越少，太阳越大）
    let scale = 1.0 // 默认
    if (cloudCoverage < 0.2) {
      scale = 1.2 // 大号：晴朗（云量 < 20%）
    } else if (cloudCoverage < 0.5) {
      scale = 1.0 // 中号：少云（云量 20-50%）
    } else if (cloudCoverage < 0.8) {
      scale = 0.8 // 小号：多云（云量 50-80%）
    } else {
      scale = 0.6 // 超小号：阴天（云量 > 80%）
    }
    
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rotation)

    const opacity = Math.max(0.3, 1 - cloudCoverage * 0.8)

    // 太阳光芒
    ctx.strokeStyle = `rgba(251, 191, 36, ${opacity})`
    ctx.lineWidth = 3 * scale
    for (let i = 0; i < 12; i++) {
      ctx.save()
      ctx.rotate((i * Math.PI) / 6)
      ctx.beginPath()
      ctx.moveTo(0, -25 * scale)
      ctx.lineTo(0, -45 * scale)
      ctx.stroke()
      ctx.restore()
    }

    // 太阳圆盘
    ctx.fillStyle = `rgba(251, 191, 36, ${opacity})`
    ctx.beginPath()
    ctx.arc(0, 0, 22 * scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = `rgba(245, 158, 11, ${opacity})`
    ctx.lineWidth = 3 * scale
    ctx.stroke()

    ctx.restore()
  }

  // 绘制标注信息
  const drawLabels = (ctx: CanvasRenderingContext2D, width: number, height: number, data: any) => {
    if (!data.lat || !data.lng) return

    // 坐标信息框
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
    ctx.fillRect(15, 15, 240, 90)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)'
    ctx.lineWidth = 2
    ctx.strokeRect(15, 15, 240, 90)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 16px monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`Latitude:  ${data.lat.toFixed(4)}°`, 25, 40)
    ctx.fillText(`Longitude: ${data.lng.toFixed(4)}°`, 25, 65)
    
    ctx.font = '14px sans-serif'
    ctx.fillStyle = '#94A3B8'
    ctx.fillText('Coverage Area: ±1.0° region', 25, 90)

    // 时间戳
    const dateStr = new Date(data.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
    ctx.fillRect(width - 185, 15, 170, 45)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)'
    ctx.lineWidth = 2
    ctx.strokeRect(width - 185, 15, 170, 45)
    
    ctx.fillStyle = '#FFFFFF'
    ctx.font = 'bold 16px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(dateStr, width - 25, 45)
  }

  if (!results || !results.data || results.data.length === 0) {
    return (
      <div className="glass rounded-xl p-8 text-center">
        <p className="text-gray-400">No data available for visualization</p>
      </div>
    )
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* 头部 */}
      <div className="p-6 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-purple-900/30 to-blue-900/30">
        <h2 className="text-3xl font-bold text-white flex items-center">
          <span className="mr-3 text-4xl">🌍</span>
          Professional Weather Visualization
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors text-3xl font-bold w-12 h-12 flex items-center justify-center hover:bg-red-500/20 rounded-lg"
        >
          ✕
        </button>
      </div>

      {/* 变量选择 */}
      <div className="p-6 border-b border-white/10 bg-gradient-to-r from-cyan-900/10 to-blue-900/10">
        <label className="block text-base font-bold text-gray-200 mb-4">Select Weather Variable</label>
        <div className="flex flex-wrap gap-3">
          {variableOptions.map((variable) => (
            <button
              key={variable.type}
              onClick={() => {
                setSelectedVariable(variable.type)
                setCurrentTimeIndex(0)
                setIsPlaying(false)
              }}
              className={`px-6 py-3 rounded-xl text-lg font-bold transition-all duration-300 transform ${
                selectedVariable === variable.type
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-2xl scale-110'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:scale-105'
              }`}
              style={{
                borderLeft: selectedVariable === variable.type ? `5px solid ${variable.color}` : 'none'
              }}
            >
              <span className="text-3xl mr-2">{variable.icon}</span>
              {variable.label}
            </button>
          ))}
        </div>
      </div>

      {/* 地图可视化区域 */}
      {timeSeriesData.length > 0 && currentData && (
        <div className="p-8">
          {/* Canvas 地图 */}
          <div className="mb-6 rounded-2xl overflow-hidden shadow-2xl border-4 border-purple-500/30">
            <canvas
              ref={canvasRef}
              width={1000}
              height={500}
              className="w-full h-auto bg-slate-900"
              style={{ display: 'block' }}
            />
          </div>

          {/* 当前值显示 */}
          <div className="text-center mb-6 bg-gradient-to-r from-purple-900/40 to-blue-900/40 rounded-xl p-6 border-2 border-purple-500/40">
            <div className="text-7xl mb-3">
              {variableOptions.find(v => v.type === selectedVariable)?.icon}
            </div>
            <div className="text-6xl font-bold text-white mb-2">
              {currentData.displayValue || 'N/A'}
            </div>
            <div className="text-3xl text-gray-300 mb-2">
              {variableOptions.find(v => v.type === selectedVariable)?.label}
            </div>
          </div>

          {/* 时间轴 */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm text-gray-400 mb-3 font-mono">
              <span>{new Date(timeSeriesData[0].timestamp).toLocaleString()}</span>
              <span className="text-cyan-400 font-bold text-xl">
                Frame {currentTimeIndex + 1} / {timeSeriesData.length} 
                <span className="text-purple-400 ml-2">(20 FPS)</span>
              </span>
              <span>{new Date(timeSeriesData[timeSeriesData.length - 1].timestamp).toLocaleString()}</span>
            </div>
            <input
              type="range"
              min="0"
              max={timeSeriesData.length - 1}
              value={currentTimeIndex}
              onChange={(e) => {
                setCurrentTimeIndex(parseInt(e.target.value))
                setIsPlaying(false)
              }}
              className="w-full h-4 bg-white/20 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #A855F7 0%, #3B82F6 ${(currentTimeIndex / (timeSeriesData.length - 1)) * 100}%, rgba(255,255,255,0.2) ${(currentTimeIndex / (timeSeriesData.length - 1)) * 100}%, rgba(255,255,255,0.2) 100%)`
              }}
            />
          </div>

          {/* 播放控制 */}
          <div className="flex items-center justify-center gap-5 mb-8">
            <button
              onClick={() => setCurrentTimeIndex(Math.max(0, currentTimeIndex - 1))}
              disabled={currentTimeIndex === 0}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-all text-xl font-bold"
            >
              ⏮ Prev
            </button>
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="px-12 py-5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-xl font-bold transition-all shadow-2xl text-2xl transform hover:scale-110"
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button
              onClick={() => setCurrentTimeIndex(Math.min(timeSeriesData.length - 1, currentTimeIndex + 1))}
              disabled={currentTimeIndex === timeSeriesData.length - 1}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-xl transition-all text-xl font-bold"
            >
              Next ⏭
            </button>
          </div>

          {/* 数据统计 */}
          <div className="grid grid-cols-3 gap-5">
            <div className="bg-gradient-to-br from-cyan-900/40 to-cyan-800/40 rounded-xl p-6 text-center border-2 border-cyan-500/40">
              <div className="text-sm text-gray-300 mb-2 font-bold">MIN VALUE</div>
              <div className="text-3xl font-bold text-cyan-400">
                {Math.min(...timeSeriesData.filter(d => d.value !== null).map(d => d.value)).toFixed(3)}
              </div>
            </div>
            <div className="bg-gradient-to-br from-red-900/40 to-red-800/40 rounded-xl p-6 text-center border-2 border-red-500/40">
              <div className="text-sm text-gray-300 mb-2 font-bold">MAX VALUE</div>
              <div className="text-3xl font-bold text-red-400">
                {Math.max(...timeSeriesData.filter(d => d.value !== null).map(d => d.value)).toFixed(3)}
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl p-6 text-center border-2 border-green-500/40">
              <div className="text-sm text-gray-300 mb-2 font-bold">AVG VALUE</div>
              <div className="text-3xl font-bold text-green-400">
                {(timeSeriesData.filter(d => d.value !== null).reduce((sum, d) => sum + d.value, 0) / timeSeriesData.filter(d => d.value !== null).length).toFixed(3)}
              </div>
            </div>
          </div>
        </div>
      )}

      {timeSeriesData.length === 0 && (
        <div className="p-8 text-center text-gray-400">
          <p className="text-2xl">No data available for the selected variable</p>
        </div>
      )}
    </div>
  )
}