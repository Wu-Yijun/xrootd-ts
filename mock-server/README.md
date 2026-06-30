# XRootD Mock Server

用于开发和测试的 XRootD Mock Server 配置。

## 快速开始

### 启动 Mock Server

```bash
# 启动无认证模式的 Mock Server
pnpm mock-server:up

# 或者直接使用 docker compose
docker compose up -d
```

### 验证服务

```bash
# 验证 Mock Server 是否正常运行
pnpm mock-server:verify
```

### 停止服务

```bash
# 停止 Mock Server
pnpm mock-server:down
```

## 服务配置

### 无认证模式 (端口 1094)

- 默认配置，用于基本协议测试
- 支持所有文件操作
- 无需认证

### TLS 模式 (端口 1095)

- 配置 TLS 加密
- 用于测试 TLS 握手和加密传输

## 测试数据

测试数据位于 `mock-server/data/test/` 目录：

- `testfile.txt` - 基本测试文件

## 验收标准

根据工作计划 Phase 0：

1. `docker compose up` 后 Mock Server 可接受 TCP 连接
2. 原版客户端能完成 login → open → read → close 全流程

## 故障排除

### 查看日志

```bash
pnpm mock-server:logs
```

### 检查容器状态

```bash
docker compose ps
```

### 重新构建

```bash
docker compose down
docker compose up -d --build
```
