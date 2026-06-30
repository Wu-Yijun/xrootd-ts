# XRootD Mock Server

用于开发和测试的 XRootD Mock Server 配置。

## 快速开始

### 启动 Mock Server

```bash
pnpm mock-server:up
```

### 验证服务

```bash
pnpm mock-server:verify
```

### 停止服务

```bash
pnpm mock-server:down
```

## 服务配置

- 镜像: `opensciencegrid/xrootd-standalone:24-testing-20260615-1618`
- 端口: `1094` (XRootD 协议)
- 认证: 无 (测试模式)
- 导出目录: `/data`

## 验收标准

根据工作计划 Phase 0：

1. `docker compose up` 后 Mock Server 可接受 TCP 连接 ✓
2. 原版客户端能完成 login → open → read → close 全流程

## 故障排除

```bash
# 查看日志
pnpm mock-server:logs

# 检查容器状态
docker compose ps
```
