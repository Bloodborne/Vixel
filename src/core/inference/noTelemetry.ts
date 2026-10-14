/**
 * 关掉 onnxruntime 的遥测（必须在任何 onnxruntime-node 会话创建之前执行，进程入口第一个 import）。
 *
 * onnxruntime 1.30 起 macOS / Linux 版也编进了微软 1DS 遥测客户端（上报到
 * mobile.events.data.microsoft.com）；Windows 版走 ETW。Vixel 承诺运行时零出站，
 * 所以每个会加载 ORT 的进程都显式设 ORT_DISABLE_TELEMETRY。写 process.env 会同步到
 * 真实环境（native 层 getenv 读得到），fork / utilityProcess 子进程也会继承。
 */
process.env.ORT_DISABLE_TELEMETRY = '1'

export {}
