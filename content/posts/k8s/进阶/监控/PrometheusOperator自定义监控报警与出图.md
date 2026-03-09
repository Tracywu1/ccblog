---
title: "PrometheusOperator自定义监控报警与出图"
draft: false
tags: ["k8s", "进阶", "监控"]
---

### 一、自定义监控配置  
**核心流程：**  

**暴露指标接口 → 创建 Service → 定义 ServiceMonitor → 自动发现监控目标**  
#### 1. **被监控目标准备指标接口**  
**要求**：目标服务需提供 `/metrics` 端点，暴露 Prometheus 格式的指标。  

- 如果目标服务已经提供了 `/metrics` 接口，并且该接口返回的数据符合 Prometheus 的要求，那么可以直接使用该接口进行监控。
  - 控制平面组件默认绑定 `127.0.0.1`，导致集群内部无法访问。  要在组件对应的 yaml 文件修改配置：
  
    ```yaml
    spec:
      containers:
      - command:
        - etcd
        - --listen-metrics-urls=http://0.0.0.0:2381  # 允许外部访问  
    ```
  
- 如果目标服务没有提供 `/metrics` 接口，或者返回的数据格式不符合 Prometheus 的要求，则需要部署一个 Exporter。Exporter 是一种适配器，它可以采集目标服务的指标数据（web服务器发送请求），并将其转换为 Prometheus 能够理解的格式，然后通过 `/metrics` 接口暴露出来。
#### 2. **添加监控 Target**  
分两种场景配置：  

##### **场景 1：监控 Kubernetes Pod**  

**步骤**：  

1. **创建 Service**（关联 Pod 标签）：  
```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: etcd
    namespace: kube-system
    labels:
      app: etcd  # 用于 ServiceMonitor 匹配
  spec:
    selector:
      component: etcd  # 匹配 Pod 标签
    ports:
    - name: metrics    # 必须与 ServiceMonitor 端口名一致
      port: 2381
      targetPort: 2381
```
2. **创建 ServiceMonitor**：  
```yaml
  apiVersion: monitoring.coreos.com/v1
  kind: ServiceMonitor
  metadata:
    name: etcd
    namespace: monitoring
  spec:
    selector:
      matchLabels:
        app: etcd  # 匹配 Service 标签
    endpoints:
    - port: metrics  # 对应 Service 端口名
      interval: 30s
```

##### **场景 2：监控集群外服务（裸机/外部服务）**  

**步骤**：  

1. **手动创建 Endpoints**：  
```yaml
  apiVersion: v1
  kind: Endpoints
  metadata:
    name: external-service # 要与svc同名
    namespace: monitoring
  subsets:
  - addresses:
    - ip: 192.168.1.100  # 外部服务 IP
    ports:
    - name: metrics
      port: 9100
```
2. **创建无 Selector 的 Service**：  
```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: external-service
    namespace: monitoring
    labels:
      app: external-service # 为 ServiceMonitor 准备的标签
  spec:
    type: ClusterIP
    cluesterIP: None
    ports:
    - name: metrics
      port: 9100
```
3. **定义 ServiceMonitor**（同上）。  
### 二、Grafana 出图配置  
**步骤**：  

1. **导入仪表盘模板**：  
   - **方式 1（手动导入）**：  
     - 访问 Grafana Web UI（NodePort 暴露）。  
     - 导航至 **Create → Import**，输入仪表盘 ID（如 `3070` 导入 etcd 仪表盘）。  
   - **方式 2（自动部署）**：  
     ```yaml
     apiVersion: v1
     kind: ConfigMap
     metadata:
       name: etcd-dashboard
       namespace: monitoring
       labels:
         grafana_dashboard: "1"
     data:
       etcd.json: |
         { ... }  # 仪表盘 JSON 内容
     ```

2. **关联数据源**：  
   - 默认数据源 `Prometheus` 已自动创建，指向 Prometheus Service。  
### 三、告警配置  

prometheus server 的配置中基于服务发现已经完成对 alertmanager 的对接

**核心流程：**  

**定义告警规则（PrometheusRule） → 配置 Alertmanager 路由 → 接收告警通知**  
#### 1. **定义告警规则**  
```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: node-alerts
  namespace: monitoring
  #labels: # 不必在此处加标签，因为 Prometheus Server 设置的是 ruleSelector:{}，这代表可以选中所有的 PrometheusRule 资源。除非 Prometheus 资源里设置了专门的 ruleSelector 标签。
  #  role: alert-rules  
spec:
  groups:
  - name: node.rules
    rules:
    - alert: NodeDown
      expr: up{job="node-exporter"} == 0
      for: 5m
      labels:
        severity: critical
      annotations:
        summary: "Node {{ $labels.instance }} 宕机"
        description: "节点 {{ $labels.instance }} 已超过 5 分钟不可用"
```

#### 2. **配置 Alertmanager 路由与通知**  
1. **创建 AlertmanagerConfig**（钉钉通知示例）：  
   
   ```yaml
   apiVersion: monitoring.coreos.com/v1alpha1
   kind: AlertmanagerConfig
   metadata:
     name: dingtalk-config
     namespace: monitoring
     labels:
       alertmanager: main  # 与 Alertmanager 的选择器匹配
   spec:
     route:
       receiver: dingtalk
       groupWait: 30s
     receivers:
     - name: dingtalk
       webhookConfigs:
       - url: http://dingtalk-webhook.monitoring:8060/send
         sendResolved: true
   ```
   
2. **关联 Alertmanager**：  
   ```yaml
   apiVers ion: monitoring.coreos.com/v1
   kind: Alertmanager
   metadata:
     name: main
     namespace: monitoring
   spec:
     alertmanagerConfigSelector:  # 匹配 AlertmanagerConfig
       matchLabels:
         alertmanager: main
   ```
### 四、验证与调试  
1. **检查监控目标**：  
   - 访问 Prometheus Web UI → **Status → Targets**，确认目标状态为 **UP**。  
2. **触发测试告警**：  
   ```bash
   kubectl delete pod node-exporter-xxxx  # 手动触发 NodeDown 告警
   ```
3. **查看告警状态**：  
   - Prometheus → **Alerts** 页面查看告警触发状态。  
   - Alertmanager → **Alerts** 页面查看告警路由结果。  
### 关键注意事项  
1. **端口与标签一致性**：  
   - Service 的 `ports.name` 必须与 ServiceMonitor 的 `endpoints.port` 完全匹配。  
2. **指标接口安全**：  
   - 若需 TLS 认证，在 ServiceMonitor 中配置 `scheme: https` 和 `tlsConfig`。  
3. **告警静默与抑制**：  
   - 在 Alertmanager Web UI 中配置静默（Silences）或抑制规则（Inhibit Rules）。  
