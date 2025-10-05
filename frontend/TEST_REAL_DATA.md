# ✅ 前端真实数据集成测试

## 🎯 修改完成

已完全移除 Mock 数据，前端现在**严格对应后端真实数据**。

---

## 🔧 关键修改

### 1. **移除所有假数据**
- ❌ 删除硬编码的温度、风速、气压、湿度
- ✅ 从后端 API 真实数据中提取

### 2. **数据转换逻辑** (`transformQueryResults`)

#### 后端返回格式：
```json
{
  "count": 3,
  "results": [
    {
      "prediction_time": "2025-10-04T00:00:00+00:00",
      "create_time": "2025-10-03T12:00:00+00:00",
      "type": "t2m",
      "value_min": 289.84,
      "value_max": 289.84,
      "path": "data/cfs/flxf2025100400.01.2025100312.grb2"
    }
  ]
}
```

#### 前端转换规则：
| 变量类型 | 后端字段 | 转换公式 | 单位 |
|---------|---------|---------|------|
| **Temperature** | `t2m` | `value_max - 273.15` | °C (开尔文→摄氏度) |
| **Wind Speed** | `u10` / `v10` | `value_max` | m/s |
| **Pressure** | `pres` | `value_max / 100` | hPa (Pa→百帕) |
| **Humidity** | `rh` | `value_max` | % |

### 3. **按时间分组**
- 同一时间戳的不同变量会合并到一个数据点
- 例如：`t2m`, `u10`, `pres` 在同一时间 → 一个完整的数据点

### 4. **坐标传递**
- 查询时的坐标会传递到结果显示
- 确保显示的位置与查询位置一致

---

## 📊 数据示例

### 查询参数：
```json
{
  "start_iso": "2025-10-04T00:00:00Z",
  "end_iso": "2025-10-04T23:59:59Z",
  "lon_min_0_360": 280.8066,
  "lon_max_0_360": 281.8066,
  "lat_min": 43.6862,
  "lat_max": 44.6862,
  "variable": "t2m",
  "level": "heightAboveGround"
}
```

### 后端返回（真实数据）：
```json
{
  "count": 3,
  "results": [
    {
      "prediction_time": "2025-10-04T00:00:00+00:00",
      "type": "t2m",
      "value_max": 289.84
    },
    {
      "prediction_time": "2025-10-04T06:00:00+00:00",
      "type": "t2m",
      "value_max": 288.407
    },
    {
      "prediction_time": "2025-10-04T18:00:00+00:00",
      "type": "t2m",
      "value_max": 297.243
    }
  ]
}
```

### 前端显示（转换后）：
```
Point #1
时间: 2025-10-04T00:00:00+00:00
位置: 43.6862, -79.1933
温度: 16.69°C  (289.84 - 273.15)
风速: 0 m/s    (未查询)
气压: 0 hPa    (未查询)
湿度: 0%       (未查询)

Point #2
时间: 2025-10-04T06:00:00+00:00
位置: 43.6862, -79.1933
温度: 15.26°C  (288.407 - 273.15)
风速: 0 m/s
气压: 0 hPa
湿度: 0%

Point #3
时间: 2025-10-04T18:00:00+00:00
位置: 43.6862, -79.1933
温度: 24.09°C  (297.243 - 273.15)
风速: 0 m/s
气压: 0 hPa
湿度: 0%
```

---

## 🧪 测试步骤

### 1. 启动前端
```bash
cd /home/mjl/nasa/weatherproject/frontend
npm run dev
```

### 2. 访问页面
打开浏览器: `http://localhost:3000`

### 3. 执行查询
1. 在地图上点击选择坐标（例如：43.65, -79.38）
2. 展开 "Time" 面板
3. 设置日期: `2025-10-04` 到 `2025-10-04`
4. 选择变量: **Temperature** (t2m)
5. 点击 **Query** 按钮

### 4. 验证结果
打开浏览器开发者工具（F12），检查：

#### Console 输出：
```
🌐 使用真实后端 API
📍 查询坐标: (43.6862, -79.1933)
📅 时间范围: 2025-10-04T00:00:00Z ~ 2025-10-04T23:59:59Z
🔬 查询变量: t2m
🔄 调用后端API: https://o.qiaoruntao.com:4567/api/api/query-data
✅ 后端返回: { count: 3, results: [...] }
🔍 查询完成
📊 结果: 3 条数据点, 1 个文件
📋 原始结果数: 3 条记录
```

#### Results Panel 显示：
- ✅ 3 个数据点
- ✅ 温度值为真实转换后的摄氏度（16.69°C, 15.26°C, 24.09°C）
- ✅ 时间戳正确（2025-10-04）
- ✅ 坐标正确（查询的坐标）

---

## ✅ 验证清单

### 数据真实性
- [ ] 温度值来自后端 `value_max - 273.15`
- [ ] 风速值来自后端 `value_max`（如果查询了 u10）
- [ ] 气压值来自后端 `value_max / 100`（如果查询了 pres）
- [ ] 湿度值来自后端 `value_max`（如果查询了 rh）
- [ ] **无任何硬编码的假数据**

### UI 对应
- [ ] 显示的数据点数量 = 后端返回的 count
- [ ] 每个数据点的时间戳正确
- [ ] 每个数据点的坐标正确
- [ ] 单位转换正确（K→°C, Pa→hPa）

### 多变量查询
- [ ] 查询 Temperature + Wind 时，两个变量的数据都显示
- [ ] 同一时间的不同变量合并到一个数据点
- [ ] 未查询的变量显示为 0

---

## 🔍 调试技巧

### 查看原始 API 响应
在浏览器开发者工具中：
1. 打开 **Network** 标签
2. 执行查询
3. 找到 `query-data` 请求
4. 查看 **Response** 查看原始 JSON

### 查看转换后的数据
在 Console 中查看：
```javascript
// 查看最后一次查询的结果
console.log(results)
```

### 测试不同变量
```bash
# 测试温度
curl 'https://o.qiaoruntao.com:4567/api/api/query-data' \
  -H 'content-type: application/json' \
  -d '{"start_iso":"2025-10-04T00:00:00","end_iso":"2025-10-04T23:59:59","lon_min_0_360":280.8,"lon_max_0_360":281.8,"lat_min":43.6,"lat_max":44.6,"variable":"t2m","level":"heightAboveGround"}'

# 测试风速
curl 'https://o.qiaoruntao.com:4567/api/api/query-data' \
  -H 'content-type: application/json' \
  -d '{"start_iso":"2025-10-04T00:00:00","end_iso":"2025-10-04T23:59:59","lon_min_0_360":280.8,"lon_max_0_360":281.8,"lat_min":43.6,"lat_max":44.6,"variable":"u10","level":"heightAboveGround"}'
```

---

## 🎉 成功标准

**前端完全对应后端的标志：**
1. ✅ 显示的温度值 = `后端 value_max - 273.15`
2. ✅ 显示的数据点数 = 后端 count
3. ✅ 显示的时间戳 = 后端 prediction_time
4. ✅ 无任何硬编码的假数据（20°C, 10 m/s, 1013 hPa, 60%）
5. ✅ 控制台显示 "使用真实后端 API"
6. ✅ 未查询的变量显示为 0（而不是假数据）

---

## 📝 配置文件

### `.env.local`
```bash
NEXT_PUBLIC_API_BASE_URL=https://o.qiaoruntao.com:4567/api
NEXT_PUBLIC_USE_MOCK=false  # 必须为 false
```

### `next.config.js`
```javascript
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    // 开发模式：直接在 localhost:3000 访问
}
```

---

**最后更新**: 2025-10-05
**状态**: ✅ 已完成 - 前端严格对应后端真实数据
