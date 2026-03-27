# live-proxy-server

> **AI 生成代码声明**
>
> 本仓库包含由 AI 生成或 AI 辅助生成的代码与文档。

## 项目简介

本项目提供一个基于 Express 的直播拉流代理服务，并配套一个 Vite + Vue 3 的前端页面。服务端通过 `streamlink` 拉取直播流，转发为 `video/mp2t` 供客户端播放，同时提供配置读写与重启接口，方便在本地环境快速调整与运行。

## 杀端口

```cmd
netstat -ano|findstr 8900
```