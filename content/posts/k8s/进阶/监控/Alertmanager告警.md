---
title: "Alertmanager告警"
draft: false
tags: ["k8s", "进阶", "监控"]
---

### **1. 介绍Alertmanager**



- **官网**：  
  [https://prometheus.io/docs/alerting/latest/alertmanager/](https://prometheus.io/docs/alerting/latest/alertmanager/)
- **功能**：  
  接收 Prometheus 的报警信息，通过分组、抑制、静默等机制处理后，转发到邮件、钉钉等接收端。
- **告警流程**：  
  
  ```plaintext
  Prometheus → 触发阈值 → 超出持续时间（为避免毛刺） → Alertmanager → 分组/抑制/静默 → 邮件/钉钉等
  ```
  
  <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250512213939751.png" alt="image-20250512213939751" style="zoom:33%;" />
### **2. 安装 Alertmanager**

二进制包下载地址：https://github.com/prometheus/alertmanager/releases/

官方文档： https://prometheus.io/docs/alerting/configuration/

#### 2.1 **二进制安装**  

```bash
# 下载并解压
wget https://github.com/prometheus/alertmanager/releases/download/v0.27.0/alertmanager-0.27.0.linux-amd64.tar.gz
tar xvf alertmanager-*.tar.gz
cd alertmanager-*/

# 运行
./alertmanager --config.file=alertmanager.yml
```

#### 2.2 Alertmanager 在 **K8s 中部署**
##### **2.1.1 准备工作**
**发件邮箱配置（以 163 邮箱为例）**  

- 登录 163 邮箱 → 设置 → POP3/SMTP/IMAP → 开启 POP3/SMTP 服务 → 获取授权码（如 `JTALPFVELQLSSPDD`）。

  > | 特性                     | POP3 (邮局协议第3版)                                         | IMAP (互联网消息访问协议)                                    | SMTP (简单邮件传输协议)                    |
  > | :----------------------- | :----------------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------------- |
  > | **主要功能**             | **收取邮件** (从服务器下载到本地)                            | **收取与同步邮件** (在服务器管理)                            | **发送邮件**                               |
  > | **工作核心**             | **邮件下载与移除** (默认)                                    | **邮件状态同步**                                             | **邮件中继传递**                           |
  > | **邮件存储位置**         | **本地设备** (默认下载后删除服务器邮件)                      | **服务器为主** (客户端通常缓存)                              | **不涉及存储** (纯传输协议)                |
  > | **操作同步性**           | **单向** (本地操作不影响服务器)                              | **双向同步** (任何设备操作实时更新服务器)                    | **不适用** (仅发送)                        |
  > | **多设备一致性**         | **差** (邮件仅存在首次下载的设备上)                          | **优秀** (所有设备看到相同的邮件状态)                        | **不适用** (仅发送)                        |
  > | **离线访问能力**         | **优秀** (邮件已下载到本地)                                  | **依赖缓存** (需联网查看新邮件或未缓存内容)                  | **不适用** (发送需联网)                    |
  > | **服务器空间占用**       | **节省** (邮件可设置下载后删除)                              | **占用高** (邮件需长期保存在服务器)                          | **不适用**                                 |
  > | **速度(首次收取)**       | 相对较快 (仅下载新邮件)                                      | 可能较慢 (需同步文件夹结构等信息)                            | **不适用**                                 |
  > | **典型使用场景**         | 1. 单设备查收邮件 2. 需节省服务器空间 3. 稳定且完全的离线访问 | 1. **多设备**(手机/电脑/平板)管理邮箱 2. 需保持各设备邮件状态一致 3. 网页邮箱与客户端状态一致 | **所有邮件发送行为** (网页/客户端都需要它) |
  > | **安全性端口 (SSL/TLS)** | **995** (推荐)                                               | **993** (推荐)                                               | **465** 或 **587**(推荐)                   |
  > | **网易服务器地址**       | `pop.163.com`                                                | `imap.163.com`                                               | `smtp.163.com`                             |
  > | **与授权码关系**         | **需要** (代替密码在客户端登录)                              | **需要** (代替密码在客户端登录)                              | **需要** (代替密码在客户端发送邮件)        |
  > | **核心差异总结**         | “拉取-删除” 模式                                             | “实时同步” 模式                                              | “只发不收” 模式                            |
  > | **现代推荐度**           | **低** (适用场景有限)                                        | **高** (多设备用户首选)                                      | **必需** (任何发送行为依赖它)              |
##### **2.2.2 配置文件**
**ConfigMap 配置（alertmanager-config.yaml）**  

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: alert-config
  namespace: monitor
data:
  config.yml: |-	# 保留字符串中的换行符，但会删除最后一行的换行符
    # 全局配置
    global:
      resolve_timeout: 5m          # 未接收告警 5 分钟后标记为 resolved（说明告警的情况已经恢复，无需再告警）
      smtp_smarthost: 'smtp.163.com:25'
      smtp_from: 'xxx@163.com'
      smtp_auth_username: 'xxx@163.com'
      smtp_auth_password: 'JTALPFVELQLSSPDD'  # 邮箱授权码
      smtp_hello: '163.com'
      smtp_require_tls: false       # 禁用 TLS

    # 路由策略
    route:
      # 按标签聚合告警，减少冗余通知
      group_by: ['alertname', 'cluster']  # 按 alertname 和 cluster 分组
      # 等待时间窗口，收集同组告警  
      group_wait: 30s                    # 等待 30 秒聚合同组告警
      
      group_interval: 30s                # 同组新告警发送间隔（短期聚合）
      # 未解决告警的重复提醒间隔
      repeat_interval: 1h                # 重复发送未解决告警的间隔（长期提醒）
      # 这两个参数一起工作，确保短时间内的警报状态变化不会造成过多的重复通知，同时在告警长期为解决的情况下提供定期的提醒。
      
      receiver: default                   # 默认接收器：未匹配路由的告警发送至默认邮箱。  
      routes:                             # 子路由规则，继承父路由的所有属性，可以进行覆盖和更具体的规则匹配
        - receiver: email
          group_wait: 10s
          group_by: ['instance']          # 按 instance 分组
          match:
            team: node                    # 匹配 team=node 标签的告警!!!

    # 接收器配置
    receivers:
      - name: default                     # 默认接收器
        email_configs:
          - to: 'xxx@qq.com'        # 接收邮箱
            send_resolved: true           # 告警恢复时发送通知
      - name: email                       # 自定义接收器
        email_configs:
          - to: 'xxx@163.com'
            send_resolved: true
```
##### **2.2.3 Deployment 配置（alertmanager-deploy.yaml）**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: alertmanager
  namespace: monitor
  labels:
    app: alertmanager
spec:
  selector:
    matchLabels:
      app: alertmanager
  template:
    metadata:
      labels:
        app: alertmanager
    spec:
      volumes:	# 定义卷
        - name: alertcfg
          configMap:
            name: alert-config      # 挂载 ConfigMap
      containers:
        - name: alertmanager
          imagePullPolicy: IfNotPresent
          args:
            - "--config.file=/etc/alertmanager/config.yml"  # 指定配置文件路径
          ports:
            - containerPort: 9093
              name: http
          volumeMounts:	# 在容器中挂载卷
            - mountPath: /etc/alertmanager  # 配置文件挂载路径
              name: alertcfg
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 100m
              memory: 256Mi
```
##### **2.2.4 Service 配置（alertmanager-svc.yaml）**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: alertmanager
  namespace: monitor
  labels:
    app: alertmanager
spec:
  type: NodePort
  ports:
    - name: web
      port: 9093                # 容器暴露的端口
      targetPort: http          # 容器端口名称
      nodePort: 32045           # NodePort 端口（范围 30000-32767）
  selector:
    app: alertmanager
```
##### **2.2.5 部署命令**
```bash
kubectl apply -f alertmanager-config.yaml  # 创建 ConfigMap
kubectl apply -f alertmanager-deploy.yaml  # 部署 Deployment
kubectl apply -f alertmanager-svc.yaml     # 创建 Service
```
### **3. 配置 Prometheus 报警规则**
#### **3.1 修改 Prometheus 配置**

- **编辑 ConfigMap**  

   ```bash
   kubectl -n monitor edit cm prometheus-config
   ```

- **添加 Alertmanager 配置与报警规则**  
   ```yaml
   # prometheus-cm.yaml（ConfigMap 内容，from 01 Prometheus 监控）
   # 会在配置文件挂载路径/etc/prometheus下有两个文件，prometheus.yml和rules.yml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: prometheus-config
     namespace: monitor
   data:
     prometheus.yml: |
       global:
         scrape_interval: 15s       # 抓取指标间隔
         evaluation_interval: 15s   # 告警规则计算间隔
         scrape_timeout: 15s        # 抓取超时时间
   
       alerting:
         alertmanagers:
           - static_configs:
               - targets: ["alertmanager:9093"]  # Alertmanager 服务地址
   
       rule_files:
         - /etc/prometheus/rules.yml  # 告警规则文件路径
   
       scrape_configs:
         - job_name: "nodes"
           static_configs:
             - targets: ["node01:9100", "node02:9100"]  # 监控目标
   
     rules.yml: |  # 告警规则文件
       groups:
         # 报警规则1：
         - name: test-node-mem  # 规则组名称
           rules:
             - alert: NodeMemoryUsage  # 告警规则名称（自动生成标签 `alertname=<value>`）
               expr: |  # PromQL 表达式，定义触发条件。  
                 (node_memory_MemTotal_bytes	# 计算节点内存实际使用率（排除空闲、缓存和缓冲区），若超过 20% 则触发告警。
                   - (node_memory_MemFree_bytes 
                     + node_memory_Buffers_bytes 
                     + node_memory_Cached_bytes)
                 ) / node_memory_MemTotal_bytes * 100 > 20
               for: 2m	 # 持续 2 分钟满足条件触发告警（过滤瞬时波动）
               labels:	# 附加标签，用于路由和分组
                 team: node			# 将这个报警归类到 “node” 团队负责
                 severity: critical	# 告警的严重级别
               annotations:	# 可被告警通知模板引用，支持变量（如 `{{$labels.instance}}`）
                 summary: "{{$labels.instance}}: High Memory usage detected"
                 description: "{{$labels.instance}}: Memory usage is above 20% (current value: {{ $value }})"
                 
         # 报警规则2：
         - name:test-node-load
           rules:
             - alert: NodeLoad
               expr: node_load5 < 1 # 故意设置该值，让其报警，正常是超过某个值才报警，而非小于
               for: 2m
               labels:
                 team: node
                 severity: normal
               annotations:
                 summary: '{{ $labels.instance }}: Low node load deteched'
                 description: '{{ $labels.instance }}: node load is below 1 (current value is:{{ $value }})'
   ```
#### **3.2 重载 Prometheus 配置**
- **触发配置更新**  

   ```bash
   # 获取 Prometheus Pod IP（假设为 10.244.3.19）
   kubectl -n monitor get pods -o wide | grep prometheus
   
   # 发送重载请求
   curl -X POST "http://10.244.3.19:9090/-/reload"
   ```
   > **注意**：需确保 Prometheus 启动时启用 `--web.enable-lifecycle` 参数以支持 reload。
   >
   > （了解）宿主机如何直接与pod通信：
   >
   > - 宿主机通过 ﻿cni0﻿ 网桥（或 Calico 的 ﻿caliXXX﻿ 接口）管理 Pod 网络
   > - 当宿主机发起请求到 Pod IP（如 ﻿10.244.3.19﻿）时：
   >   - 宿主机内核查找该 IP 的路由规则。
   >   - CNI 已配置路由表：目标 IP 属于 ﻿10.244.0.0/16﻿ 网段时，数据包被转发到 ﻿cni0﻿ 网桥。
   >   - cni0﻿ 网桥通过 VETH 对将请求送达目标 Pod。

- **验证配置生效**  
  
   - 访问 Prometheus Web 界面（`http://<NodeIP>:9090/alerts`），查看规则状态是否为 `Active`。
### 4. 告警状态与生命周期
#### 4.1 三种状态  

- **`inactive`**
  - 监控指标未触发报警条件或从未触发过。
- **`pending`**
  - 指标触发报警条件，但未超过 `for` 设定的持续时间。
- **`firing`**
  - 指标持续触发报警条件超过 `for` 时间，Prometheus 将报警发送至 Alertmanager。
#### 4.2 **状态转换流程**

- **初始状态**：`inactive`
  - 示例：内存使用率正常。
- **触发条件**：指标首次满足规则（如内存使用率 > 20%）
  - 状态变为 `pending`。
- **持续检查**：
  - **超过 `for` 时间（如 2 分钟）** → 状态变为 `firing`，发送报警。
  - **未超过 `for` 时间恢复** → 状态变回 `inactive`。
### 5. 优化告警信息

#### 5.1 **Prometheus 规则优化**

- **延迟报警触发**：
  通过 `for` 参数设置持续阈值时间，避免瞬时波动触发报警。

  ```yaml
  # prometheus-config.yml
  - alert: HighMemoryUsage
    expr: node_memory_MemFree_bytes < 20%
    for: 2m  # 持续 2 分钟触发报警
  ```

- **优化阈值**：
  根据历史数据调整阈值（如从 20% 调整为 25%）。

- **报警规则性能优化**

  **问题**：复杂 PromQL 实时计算性能差，且多条报警规则中存在共用的表达式。  

  **解决方案**：预计算共用的表达式并存储为记录规则。用户只需查询这些预计算的结果，而不必每次都执行完整的复杂查询。

  - **Recording Rule 机制**

    - **作用**：预计算公共表达式，减少重复计算开销。

    - **配置实例**：

      ```yaml
      # prometheus-config.yml
      groups:
        - name: recording_rules
          rules:
            - record: job:http_requests:rate5m
              expr: rate(http_requests_total[5m])
      ```

    - **引用预计算指标**：

      ```yaml
      - alert: HighRequestRate
        expr: job:http_requests:rate5m > 100
      ```
#### 5.2 **Alertmanager 配置优化**

**问题**：报警杂乱且频繁

- **分组合并（Grouping）**：
  将指定标签相同的报警合并为一条通知，减少冗余。

  ```yaml
  # alertmanager-config.yaml
  route:
    group_by: ['alertname', 'instance']	# 将具有相同报警名称和实例的报警归为同一组
    group_wait: 30s  # 等待 30 秒收集同组报警
    group_interval: 5m  # 发送新报警间隔
  ```

- **抑制重复报警**：
  设置 `repeat_interval` 控制重复报警频率。

  ```yaml
  route:
    repeat_interval: 1h  # 同一报警 1 小时内不重复发送
  ```
#### 5.3 **静默（Silences）**

- **作用**：临时屏蔽指定报警（如维护期间）。
- **配置方式**：
  - 在 Alertmanager Web 界面（`http://<alertmanager-ip>:9093`）创建静默规则。
  - 指定匹配标签（如 `alertname=HighMemoryUsage`）和时间范围。
- **注意**：
  - New Silence 中 Matchers Alerts affected by this silence 添加是 **and** 的关系。
  - 若想达到“或”的效果，可以 New 多个 Silence。
#### 5.4 **抑制（Inhibition）**

- **作用**：抑制由根因触发的相关报警（如节点宕机时忽略其上的服务报警），避免告警风暴（alert storm）。

- **配置示例**：

  ```yaml
  # alertmanager-config.yaml
  inhibit_rules:
    - source_match:
        severity: 'critical'
      target_match:
        severity: 'warning'
      equal: ['instance']  # 相同实例的 warning 报警被抑制
  ```
  
  如果一个实例（instance）同时触发了 `critical`（严重）和 `warning`（警告）报警，那么 `warning`（警告）报警将被抑制，不会发送通知。这样可以避免对同一个实例的重复报警，使得报警系统更加高效和有用。
#### **5.5 定制报警模板**

- **作用**：格式化报警通知内容（如标题、字段、链接），提升可读性。

- **模板文件（ConfigMap）**：  

  ```yaml
  # alertmanager-config.yaml
  data:
    config.yml: |-
      ...
      templates:	# 1. 增加 templates 配置，指定模板文件
      - '/etc/alertmanager/template_email.tmpl'
      
      receivers:
        - name: email               
          email_configs:
            - to: 'xxx@163.com'
              send_resolved: true
              html:'{{ template "email.html" . }}' # 2. 使用自定义的模板来发送告警通知的内容
      ...
      
    # 3. 定义 email.html，注意模板内容里不能加注释
    # {{- if gt (len .Alerts.Firing) 0 -}}：如果 .Alerts.Firing 的长度（即触发的告警数量）大于 0，则执行后面的代码块
    template_email.tmpl: |-
      {{ define "email.html" }}
      {{- if gt (len .Alerts.Firing) 0 -}}
      <h3>报警</h3>
      {{- range .Alerts }}
      <strong>实例:</strong> {{ .Labels.instance }}<br>
      <strong>概述:</strong> {{ .Annotations.summary }}<br>
      <strong>详情:</strong> {{ .Annotations.description }}<br>
      <strong>时间:</strong> {{ (.StartsAt.Add 28800e9).Format "2006-01-02 15:04:05" }}<br>
      {{- end }}
      {{- end }}
      {{- if gt (len .Alerts.Resolved) 0 -}}
      <h3>恢复</h3>
      {{- range .Alerts }}
      <strong>实例:</strong> {{ .Labels.instance }}<br>
      <strong>信息:</strong> {{ .Annotations.summary }}<br>
      <strong>恢复时间:</strong> {{ (.EndsAt.Add 28800e9).Format "2006-01-02 15:04:05" }}<br>
      {{- end }}
      {{- end }}
      {{ end }}
  ```
