/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    swcMinify: true,
    // 开发模式：直接在 localhost:3000 访问
    output: 'export',  // 注释掉，开发时不需要
    basePath: '/weatherforecast',  // 注释掉，开发时直接用根路径
}

module.exports = nextConfig

