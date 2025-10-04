import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AskGPTProps {
  weatherData?: any
  location?: { lat: number; lng: number }
  isOpen: boolean
  onClose: () => void
  isExpanded: boolean
  onToggleExpand: () => void
  shouldFlash?: boolean
}

export default function AskGPT({ weatherData, location, isOpen, onClose, isExpanded, onToggleExpand, shouldFlash }: AskGPTProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputMessage, setInputMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastWeatherData, setLastWeatherData] = useState<any>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 推荐问题
  const suggestedQuestions = [
    "Is this weather suitable for outdoor activities?",
    "What should I wear today?",
    "Do I need an umbrella?",
    "Is it good weather for hiking?"
  ]

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // 当展开且有新天气数据时自动总结
  useEffect(() => {
    if (isExpanded && weatherData && weatherData !== lastWeatherData) {
      setLastWeatherData(weatherData)
      initializeChat()
    }
  }, [isExpanded, weatherData, lastWeatherData])

  const initializeChat = async () => {
    // If no weather data, show friendly greeting
    if (!weatherData || !weatherData.data || weatherData.data.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content: `Hello! I'm your weather assistant. 👋\n\nCurrently, there's no weather data available. Please search for weather data first by:\n\n1. Selecting a location (manual input, map click, or address search)\n2. Choosing date range and variables\n3. Clicking "Search Weather"\n\nOnce you have weather data, I can help you with:\n• Weather analysis and forecasts\n• Activity suggestions based on conditions\n• Clothing recommendations\n• Travel planning advice\n\nWhat would you like to know about the weather?`
        }
      ])
      return
    }
    
    // Build weather summary
    const weatherSummary = buildWeatherSummary()
    
    setIsLoading(true)
    
    try {
      const response = await callGPT([
        {
          role: 'system',
          content: 'You are a professional weather analysis assistant. Provide concise and practical analysis and suggestions based on the weather data. Be friendly and professional, and respond in English.'
        },
        {
          role: 'user',
          content: `Please summarize and provide suggestions based on the following weather data:\n\n${weatherSummary}\n\nProvide: 1. Weather summary 2. Travel suggestions 3. Clothing recommendations`
        }
      ])

      setMessages([
        {
          role: 'assistant',
          content: response
        }
      ])
    } catch (error) {
      console.error('GPT call failed:', error)
      setMessages([
        {
          role: 'assistant',
          content: `Sorry, unable to connect to AI service: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again later.`
        }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const buildWeatherSummary = () => {
    if (!weatherData || !weatherData.data || weatherData.data.length === 0) {
      return 'No weather data available'
    }

    const data = weatherData.data
    const locationStr = location 
      ? `Location: ${location.lat.toFixed(2)}°${location.lat >= 0 ? 'N' : 'S'}, ${Math.abs(location.lng).toFixed(2)}°${location.lng >= 0 ? 'E' : 'W'}`
      : 'Location: Unknown'

    // Calculate averages
    const temps = data.map((d: any) => d.temperature).filter((t: number) => !isNaN(t))
    const winds = data.map((d: any) => d.windSpeed).filter((w: number) => !isNaN(w))
    const pressures = data.map((d: any) => d.pressure).filter((p: number) => !isNaN(p))
    const humidities = data.map((d: any) => d.humidity).filter((h: number) => !isNaN(h))

    const avgTemp = temps.length > 0 ? (temps.reduce((a: number, b: number) => a + b, 0) / temps.length).toFixed(1) : 'N/A'
    const maxTemp = temps.length > 0 ? Math.max(...temps).toFixed(1) : 'N/A'
    const minTemp = temps.length > 0 ? Math.min(...temps).toFixed(1) : 'N/A'
    const avgWind = winds.length > 0 ? (winds.reduce((a: number, b: number) => a + b, 0) / winds.length).toFixed(1) : 'N/A'
    const avgPressure = pressures.length > 0 ? (pressures.reduce((a: number, b: number) => a + b, 0) / pressures.length).toFixed(1) : 'N/A'
    const avgHumidity = humidities.length > 0 ? (humidities.reduce((a: number, b: number) => a + b, 0) / humidities.length).toFixed(1) : 'N/A'

    return `${locationStr}
Data points: ${data.length}

Temperature:
- Average: ${avgTemp}°C
- Max: ${maxTemp}°C
- Min: ${minTemp}°C

Wind speed: Average ${avgWind} m/s
Pressure: Average ${avgPressure} hPa
Humidity: Average ${avgHumidity}%`
  }

  const callGPT = async (messages: Message[]): Promise<string> => {
    const apiKey = process.env.NEXT_PUBLIC_GPT_API_KEY
    const apiUrl = process.env.NEXT_PUBLIC_GPT_API_URL || 'https://api.chatanywhere.tech/v1/chat/completions'

    if (!apiKey) {
      throw new Error('GPT API Key not configured')
    }

    console.log('🤖 Calling GPT API:', apiUrl)
    console.log('🔑 API Key (first 10 chars):', apiKey.substring(0, 10) + '...')

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('❌ GPT API Error:', response.status, errorText)
        throw new Error(`API request failed: ${response.status} - ${errorText}`)
      }

      const data = await response.json()
      console.log('✅ GPT Response received')

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid API response format')
      }

      return data.choices[0].message.content
    } catch (error) {
      console.error('❌ Fetch error:', error)
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to reach API server. Please check your internet connection.')
      }
      throw error
    }
  }

  const handleSendMessage = async (customMessage?: string) => {
    const messageToSend = customMessage || inputMessage
    if (!messageToSend.trim() || isLoading) return

    const userMessage: Message = {
      role: 'user',
      content: messageToSend
    }

    setMessages(prev => [...prev, userMessage])
    setInputMessage('')
    setIsLoading(true)

    try {
      // Build complete conversation history
      const conversationHistory: Message[] = [
        {
          role: 'system',
          content: `You are a professional weather analysis assistant. Current weather data:\n${buildWeatherSummary()}\n\nPlease answer user questions based on this data, providing professional and practical advice. Respond in English.`
        },
        ...messages,
        userMessage
      ]

      const response = await callGPT(conversationHistory)

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response
      }])
    } catch (error) {
      console.error('Send message failed:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, failed to send: ${error instanceof Error ? error.message : 'Unknown error'}`
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  if (!isOpen) return null

  // 未展开时：右下角半透明小浮窗
  if (!isExpanded) {
    return (
      <div 
        className={`fixed bottom-6 right-6 z-50 animate-fade-in cursor-pointer ${shouldFlash ? 'animate-bounce' : ''}`}
        onClick={onToggleExpand}
      >
        <div className={`bg-cyan-600/30 backdrop-blur-md rounded-2xl shadow-2xl p-4 border border-cyan-500/50 hover:bg-cyan-600/40 transition-all duration-300 hover:scale-105 ${shouldFlash ? 'ring-4 ring-cyan-400 ring-opacity-50' : ''}`}>
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-gradient-to-r from-cyan-600 to-blue-500 rounded-xl flex items-center justify-center animate-pulse">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-white">
              <div className="font-semibold text-2xl">AI Chatbot</div>
              <div className="text-lg text-cyan-200">Click to expand</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 展开时：大窗口实色背景
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onToggleExpand}>
      <div 
        className="bg-gradient-to-br from-slate-900 via-cyan-950 to-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl h-[700px] flex flex-col border border-cyan-500/50 m-4 animate-slide-in-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-5 border-b border-cyan-500/30 bg-gradient-to-r from-cyan-900/20 to-blue-900/20">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-gradient-to-r from-cyan-600 to-blue-500 rounded-xl flex items-center justify-center mr-3 shadow-lg">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div>
              <h2 className="text-4xl font-bold text-white">AI Chatbot</h2>
              <p className="text-2xl text-cyan-300">Powered by GPT</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onToggleExpand}
              className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Minimize"
            >
              <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-950/30">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-5 ${
                  msg.role === 'user'
                    ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white'
                    : 'bg-white/10 text-white border border-white/20'
                }`}
              >
                <div className="text-2xl whitespace-pre-wrap leading-relaxed">{msg.content}</div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="bg-white/10 rounded-lg p-3 border border-white/20">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-cyan-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 推荐问题 */}
        {messages.length > 0 && !isLoading && (
          <div className="px-6 py-4 border-t border-cyan-500/30 bg-gradient-to-r from-cyan-900/10 to-blue-900/10">
            <div className="text-xl text-gray-400 mb-3">Suggested questions:</div>
            <div className="flex flex-wrap gap-3">
              {suggestedQuestions.map((question, index) => (
                <button
                  key={index}
                  onClick={() => handleSendMessage(question)}
                  disabled={isLoading}
                  className="px-4 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 rounded-full text-lg text-cyan-200 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 输入框 */}
        <div className="p-6 border-t border-cyan-500/30 bg-gradient-to-r from-cyan-900/10 to-blue-900/10">
          <div className="flex space-x-4">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={weatherData ? "Ask me anything about the weather..." : "Search weather data first..."}
              disabled={isLoading || !weatherData}
              className="flex-1 bg-slate-900/50 border border-cyan-500/30 rounded-xl px-6 py-4 text-2xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all duration-200 disabled:opacity-50"
            />
            <button
              onClick={() => handleSendMessage()}
              disabled={isLoading || !inputMessage.trim() || !weatherData}
              className="px-8 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all duration-200 hover:scale-105 shadow-lg"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

