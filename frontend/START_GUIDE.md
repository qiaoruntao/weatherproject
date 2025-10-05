# 🚀 前端启动指南

## ✅ 前端已配置完成！

前端现在已经配置为使用**真实后端 API**，可以直接在浏览器中访问。

---

## 📍 访问地址

```
http://localhost:3000
```

---

## ⚙️ 当前配置

### 后端 API
- **URL**: `https://o.qiaoruntao.com:4567/api`
- **模式**: 真实数据（Mock 已禁用）
- **Level**: `heightAboveGround`

### 环境变量 (`.env.local`)
```bash
NEXT_PUBLIC_API_BASE_URL=https://o.qiaoruntao.com:4567/api
NEXT_PUBLIC_USE_MOCK=false
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIzaSyCZNy-8HXYFfPNHLJftsoJEo6UXI7OXan4
```

---

## 🎯 使用步骤

### 1. 打开浏览器
访问: `http://localhost:3000`

### 2. 选择坐标
- **方法 A**: 在地图上点击任意位置
- **方法 B**: 使用 "Coordinate Input" 面板手动输入
  - 例如: `Latitude: 43.65`, `Longitude: -79.38`

### 3. 设置查询参数
- 点击 **"Time"** 面板展开
- 设置时间范围（默认为今天）:
  - Start Date: `2025-10-04`
  - End Date: `2025-10-04`
- 选择变量（可多选）:
  - ✅ Temperature (t2m)
  - ✅ Wind (u10)
  - ✅ Pressure (pres)
  - ✅ Humidity (rh)

### 4. 执行查询
- 点击 **"Query"** 按钮
- 等待数据加载

### 5. 查看结果
- **Results Panel** 会显示查询到的数据
- 打开浏览器开发者工具（F12）查看详细日志

---

## 🔍 预期行为

### 控制台输出示例
```
🌐 使用真实后端 API
📍 查询坐标: (43.6862, -79.1933)
📅 时间范围: 2025-10-04T00:00:00Z ~ 2025-10-04T23:59:59Z
🔬 查询变量: t2m
🔄 调用后端API: https://o.qiaoruntao.com:4567/api/api/query-data
📦 请求参数: {
  start_iso: "2025-10-04T00:00:00Z",
  end_iso: "2025-10-04T23:59:59Z",
  lon_min_0_360: 280.8066455078125,
  lon_max_0_360: 281.8066455078125,
  lat_min: 43.186154840875844,
  lat_max: 44.186154840875844,
  level: "heightAboveGround",
  variable: "t2m",
  indexpath: ""
}
✅ 后端返回: { count: 3, results: [...] }
🔍 查询完成: 坐标(43.6862, -79.1933), 来源: map
📊 结果: 3 条数据, 1 个文件
```

### API 返回数据示例
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
    },
    ...
  ]
}
```

---

## 🛠️ 启动/重启命令

### 启动前端
```bash
cd /home/mjl/nasa/weatherproject/frontend
npm run dev
```

### 重启前端
```bash
cd /home/mjl/nasa/weatherproject/frontend
pkill -f "next-server"
npm run dev
```

### 查看日志
```bash
tail -f /tmp/frontend.log
```

---

## 🔧 配置说明

### 变量映射
前端变量名会自动映射到后端变量名：

| 前端显示名 | 后端变量名 |
|-----------|-----------|
| Temperature | t2m |
| Wind | u10 |
| Pressure | pres |
| Humidity | rh |

### 坐标转换
- 前端使用 `-180~180` 经度范围
- 后端使用 `0~360` 经度范围
- **自动转换**：`lon_0_360 = lon < 0 ? lon + 360 : lon`

### 查询范围
- 以选中坐标为中心
- **纬度范围**: ±0.5度
- **经度范围**: ±0.5度

---

## 📊 功能特性

### ✅ 已实现
- [x] 真实后端 API 集成
- [x] 多变量查询（循环调用）
- [x] 坐标选择（地图点击 + 手动输入）
- [x] 时间范围查询
- [x] 结果展示
- [x] 错误处理
- [x] 自动坐标转换（-180~180 ↔ 0~360）

### 🔄 查询流程
1. 用户选择坐标和参数
2. 前端构建查询 payload
3. 循环调用后端 API（每个变量一次）
4. 合并所有结果
5. 转换为前端格式
6. 在 Results Panel 显示

---

## 🐛 故障排除

### 问题 1: 页面无法访问
**检查**: 前端服务是否运行
```bash
ps aux | grep next-server
```
**解决**: 重启前端服务
```bash
cd /home/mjl/nasa/weatherproject/frontend && npm run dev
```

### 问题 2: API 调用失败
**检查**: 后端 API 是否可访问
```bash
curl -s 'https://o.qiaoruntao.com:4567/api/api/query-data' \
  -H 'content-type: application/json' \
  -d '{"start_iso":"2025-10-04T00:00:00","end_iso":"2025-10-04T23:59:59","lon_min_0_360":280.8,"lon_max_0_360":281.8,"lat_min":43.6,"lat_max":44.6,"variable":"t2m","level":"heightAboveGround"}'
```

### 问题 3: 地图不显示
**原因**: Google Maps API Key 无效
**检查**: `.env.local` 中的 `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`

### 问题 4: 返回空数据
**原因**: 
- 选择的时间范围没有数据
- 选择的坐标位置没有数据
**解决**: 尝试不同的日期或坐标

---

## 📝 开发者工具

### 查看网络请求
1. 打开浏览器开发者工具（F12）
2. 切换到 **Network** 标签
3. 执行查询
4. 查看 `query-data` 请求的详情

### 查看控制台日志
1. 打开浏览器开发者工具（F12）
2. 切换到 **Console** 标签
3. 查看详细的查询日志

---

## 🎉 成功标准

前端正常运行的标志：
- ✅ 可以访问 `http://localhost:3000`
- ✅ 地图正常显示
- ✅ 可以选择坐标
- ✅ 可以设置查询参数
- ✅ 点击 Query 后返回真实数据
- ✅ Results Panel 显示数据
- ✅ 控制台无错误信息

---

## 📞 技术支持

如有问题，请检查：
1. 前端日志: `/tmp/frontend.log`
2. 浏览器控制台（F12）
3. 网络请求详情（Network 标签）

---

**最后更新**: 2025-10-05
**前端版本**: Next.js 14.2.33
**后端 API**: https://o.qiaoruntao.com:4567/api
