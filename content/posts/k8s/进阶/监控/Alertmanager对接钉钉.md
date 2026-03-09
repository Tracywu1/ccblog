---
title: "Alertmanager对接钉钉"
draft: false
tags: ["k8s", "进阶", "监控"]
---

## Alertmanager 对接钉钉

**官方文档**：[自定义机器人接入 - 钉钉开放平台](https://open.dingtalk.com/document/robots/custom-robot-access)

### 1. 报警接收器

Alertmanager 支持多种内置的报警接收器，包括：Emai、Slack、企业微信、Webhook（通过 HTTP 请求发送报警信息到指定的 URL，这是最为灵活的方式）。

**特别说明：钉钉集成**

Alertmanager 的接收器（receiver）并不直接支持钉钉的 URL。为了实现钉钉集成，需要部署一个专门的插件容器，例如 `prometheus-webhook-dingtalk`。

- **集成钉钉的流程：**

  Prometheus（告警规则） —> Alertmanager —> `prometheus-webhook-dingtalk` —> 钉钉

  1. 部署 `prometheus-webhook-dingtalk` 等支持钉钉的插件容器。
  2. 配置 Alertmanager，将报警信息通过 Webhook 方式发送到插件容器。
  3. 配置插件容器，使其将接收到的报警信息转发到钉钉。
### **2. 钉钉机器人配置**
1. **创建群聊**  

   - 登录钉钉 → 创建群聊（需至少 2 人）。

2. **添加群机器人**  

   - 群设置 → 机器人 → 添加机器人 → 自定义机器人。  
   - **安全设置**：选择“加签”并生成 `secret`（如 `SEC67f8b6d159...`）。  
   - **Webhook 地址**：添加完成可获得访问令牌 URL（如 `https://oapi.dingtalk.com/robot/send?access_token=3acdac21...`，相当于暴露了该群的“api接口”）。

3. **webhook api 测试**

   在文档的安全设置部分

   ```python
   # 测试脚本
   # python 3.8
   import time
   import hmac
   import hashlib
   import base64
   import urllib.parse
   import requests
   
   timestamp = str(round(time.time() * 1000))
   secret = 'this is secret'
   secret_enc = secret.encode('utf-8')
   string_to_sign = '{}\n{}'.format(timestamp, secret)
   string_to_sign_enc = string_to_sign.encode('utf-8')
   hmac_code = hmac.new(secret_enc, string_to_sign_enc, digestmod=hashlib.sha256).digest()
   sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
   print(timestamp)
   print(sign)
   
   MESSAGE = sys.argv[1]
   webhook_url = f'https://oapi.dingtalk.com/robot/send?access_token=XXXXXX&timestamp={timestamp}&sign={sign}'
   response = requests.post(webhook_url, headers={'Content-Type': 'application/json'},json={"msgtype": "text", "text": {"content":f"'{MESSAGE}'"}})
   print(response.text)
   print(response.status_code)
   ```

   ```bash
   # 准备工作：安装requests库
   pip3 install requests -i https://mirrors.aliyun.com/pypi/simple/
   
   # 执行脚本
   python3 webhook_test.py 测试 # 验证钉钉群是否收到消息（测试）
   ```
### **3.  二进制部署钉钉 Webhook 服务**

**prometheus-webhook-dingtalk官方地址**：https://github.com/timonwong/prometheus-webhook-dingtalk

实现webhook—>钉钉的对接

#### 3.1 **下载并解压软件**  

```bash
wget https://github.com/timonwong/prometheus-webhook-dingtalk/releases/download/v2.1.0/prometheus-webhook-dingtalk-2.1.0.linux-amd64.tar.gz
tar xvf prometheus-webhook-dingtalk-2.1.0.linux-amd64.tar.gz -C /usr/local/
ln -s /usr/local/prometheus-webhook-dingtalk-2.1.0.linux-amd64 /usr/local/prometheus-webhook-dingtalk
```

#### 3.2 **配置文件（`/usr/local/prometheus-webhook-dingtalk/config.yml`）**  

```yaml
targets:
  webhook1: # 一个群聊的接口
    url: https://oapi.dingtalk.com/robot/send?access_token=3acdac2167b83e0b54f751c0cfcbb676b7828af183aca2e21428c489883ced8b
    secret: SEC67f8b6d15997deaf686ab0509b2dad943aca99d700131f88d010ef57e591aea0
  
  webhook_mention_all:  # 通知所有人
    url: https://oapi.dingtalk.com/robot/send?access_token=3acdac2167b83e0b54f751c0cfcbb676b7828af183aca2e21428c489883ced8b
    secret: SEC67f8b6d15997deaf686ab0509b2dad943aca99d700131f88d010ef57e591aea0
    mention:
      all: true  # @所有人
  
  webhook_mention_users:  # 通知指定用户
    url: https://oapi.dingtalk.com/robot/send?access_token=3acdac2167b83e0b54f751c0cfcbb676b7828af183aca2e21428c489883ced8b
    secret: SEC67f8b6d15997deaf686ab0509b2dad943aca99d700131f88d010ef57e591aea0
    mention:
      mobiles: ['18611453110']  # 用户手机号
```

#### 3.3 **系统服务配置（`/lib/systemd/system/dingtalk.service`）**  

```ini
[Unit]
Description=dingtalk
Documentation=https://github.com/timonwong/prometheus-webhook-dingtalk/
After=network.target

[Service]
Restart=on-failure
WorkingDirectory=/usr/local/prometheus-webhook-dingtalk
ExecStart=/usr/local/prometheus-webhook-dingtalk/prometheus-webhook-dingtalk \
  --web.listen-address=0.0.0.0:8060 \
  --config.file=/usr/local/prometheus-webhook-dingtalk/config.yml

[Install]
WantedBy=multi-user.target
```

#### 3.4 **启动服务**  

```bash
systemctl daemon-reload
systemctl start dingtalk
systemctl enable dingtalk  # 可选
systemctl status dingtalk  # 验证状态
```
### **4. 配置 Alertmanager 对接钉钉 Webhook**

#### 4.1 储备知识：**路由规则冲突处理**

当多个路由规则的条件完全相同时，默认只有第一个匹配的路由生效。两种解决方案：

1. **差异化路由条件**  
   - 通过 `match` 标签区分不同路由，确保条件不重叠。
   ```yaml
   routes:
     - receiver: email
       match:
         team: node
         type: error  # 添加额外标签区分
     - receiver: mywebhook
       match:
         team: node
         type: warning
   ```

2. **使用 `continue` 字段**  
   - 允许告警继续匹配后续路由规则，实现多接收器分发。
   ```yaml
   routes:
     - receiver: email
       match:
         team: node
       continue: true  # 继续匹配后续路由
     - receiver: mywebhook
       match:
         team: node
   ```
#### **4.2 新增钉钉 Webhook 接收器**
**修改 Alertmanager ConfigMap**  

```yaml
# alertmanager-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: alert-config
  namespace: monitor
data:
  config.yml: |
    global:
      resolve_timeout: 5m
    
    route:
      group_by: ['alertname', 'cluster']
      receiver: default
      routes:
        - receiver: email
          group_wait: 10s
          group_by: ['instance']
          match:
            team: node
          continue: true  # 允许继续匹配后续路由
        - receiver: mywebhook  # 新增钉钉接收器路由
          group_wait: 10s
          group_by: ['instance']
          match:
            team: node
    
    receivers:
      - name: default
        email_configs: [...]  # 默认邮件配置
      - name: email
        email_configs: [...]  # 原邮件接收器
      - name: mywebhook       # 钉钉 Webhook 接收器
        webhook_configs:
          - url: 'http://<WEBHOOK_SERVER_IP>:8060/dingtalk/webhook1/send'  # 钉钉 Webhook 地址
            send_resolved: true		# 告警恢复时发送通知
```

**重载配置**

```bash
kubectl delete -f alertmanager-config.yaml
kubectl apply -f alertmanager-config.yaml
```
### **5. 为钉钉 Webhook 定制报警模板**

#### 5.1 **修改模板文件**  

参考默认模板：[default.tmpl](https://github.com/timonwong/prometheus-webhook-dingtalk/blob/main/template/default.tmpl)  

```bash
vim /usr/local/prometheus-webhook-dingtalk/config.yml
```

**新增配置项**：

```yaml
# 在全局配置中添加模板路径
templates:
  - /etc/prometheus-webhook-dingtalk/template.tmpl  # 自定义模板路径

targets:
  webhook1:
    url: https://oapi.dingtalk.com/robot/send?access_token=xxx
    secret: SECxxx
    message:  # 指定使用模板
      text: '{{ template "default.tmpl" . }}'  # 引用模板名称
```

#### 5.2 **创建自定义模板文件**

```bash
mkdir -p /etc/prometheus-webhook-dingtalk
cat > /etc/prometheus-webhook-dingtalk/template.tmpl <<'EOF'
{{ define "default.tmpl" }}
{{- if gt (len .Alerts.Firing) 0 -}}
{{- range $index, $alert := .Alerts -}}
### <font color='#FF0000'>🚨 告警触发</font>

**告警名称**: {{ $alert.Labels.alertname }}  
**告警级别**: {{ $alert.Labels.severity }} 级  
**告警状态**: {{ $alert.Status }}  
**告警实例**: {{ $alert.Labels.instance }}  
**故障设备**: {{ $alert.Labels.device }}  

**告警概要**:  
{{ $alert.Annotations.summary }}  

**告警详情**:  
{{ $alert.Annotations.description }}  

**故障时间**:  
{{ ($alert.StartsAt.Add 28800e9).Format "2006-01-02 15:04:05" }}  # 通过 `Add 28800e9` 将 UTC 时间转换为 CST（+8 时区）。
{{- end }}
{{- end }}

{{- if gt (len .Alerts.Resolved) 0 -}}
{{- range $index, $alert := .Alerts -}}
### <font color='#00FF00'>✅ 告警恢复</font>
**告警实例**: {{ $alert.Labels.instance }}  
**告警名称**: {{ $alert.Labels.alertname }}  
**告警级别**: {{ $alert.Labels.severity }} 级  
**恢复时间**:  
{{ ($alert.EndsAt.Add 28800e9).Format "2006-01-02 15:04:05" }}  

**恢复详情**:  
{{ $alert.Annotations.summary }}  
{{- end }}
{{- end }}
{{ end }}
EOF
```

#### 5.3 **重启 Webhook 服务**  

```bash
systemctl restart dingtalk.service
```
### 6. 基于 K8s 的钉钉 Webhook 报警部署

> 注意：与二进制部署方式的区别仅有 Weebhook 服务这一环节的部署方式不同，其他的部分都一致
#### **6.1 部署架构**
```plaintext
Prometheus → Alertmanager → [Webhook 服务 (promoter)] → 钉钉机器人
```
#### **6.2 核心配置清单**
##### 6.2.1 **模板与配置文件 ConfigMap**
```yaml
# promoter-conf.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: promoter-conf
  namespace: monitor
data:
  # (1) 报警模板
  template.tmpl: |
    {{ define "default.tmpl" }}
    {{- if gt (len .Alerts.Firing) 0 -}}
    {{- range $index, $alert := .Alerts -}}
    ### <font color='#FF0000'>🚨 告警触发</font>

    **告警名称**: {{ $alert.Labels.alertname }}  
    **告警级别**: {{ $alert.Labels.severity }} 级  
    **告警状态**: {{ $alert.Status }}  
    **告警实例**: {{ $alert.Labels.instance }}  
    **故障设备**: {{ $alert.Labels.device }}  

    **告警概要**:  
    {{ $alert.Annotations.summary }}  

    **告警详情**:  
    {{ $alert.Annotations.description }}  

    **故障时间**:  
    {{ ($alert.StartsAt.Add 28800e9).Format "2006-01-02 15:04:05" }}  
    {{- end }}
    {{- end }}

    {{- if gt (len .Alerts.Resolved) 0 -}}
    {{- range $index, $alert := .Alerts -}}
    ### <font color='#00FF00'>✅ 告警恢复</font>
    **告警实例**: {{ $alert.Labels.instance }}  
    **告警名称**: {{ $alert.Labels.alertname }}  
    **告警级别**: {{ $alert.Labels.severity }} 级  
    **恢复时间**:  
    {{ ($alert.EndsAt.Add 28800e9).Format "2006-01-02 15:04:05" }}  

    **恢复详情**:  
    {{ $alert.Annotations.summary }}  
    {{- end }}
    {{- end }}
    {{ end }}

  # (2) Webhook 服务配置
  config.yml: |
    templates:
      - /etc/promoter/template.tmpl  # 模板路径
    
    targets:
      webhook1:
        url: https://oapi.dingtalk.com/robot/send?access_token=925ua9673ed8d1d283478ea6ef29cfe395e2571895330e93cf06b0678053dAdo
        secret: SECd0eeae6676ef6043acd77275f4b11318498397edd9be.c05ba6308b9722fed0d
        message:
          text: '{{ template "default.tmpl" . }}'  # 引用模板
```

**注意**：实际应用中应该注重敏感信息保护，即钉钉的 `access_token` 和 `secret` 应通过 K8s **Secret** 存储，而非明文写在 ConfigMap 中。

##### 6.2.2 **Deployment 部署**
```yaml
# promoter-deploy.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: promoter
  namespace: monitor
  labels:
    app: promoter
spec:
  selector:
    matchLabels:
      app: promoter
  template:
    metadata:
      labels:
        app: promoter
    spec:
      volumes:
        - name: promoter-cfg  # 挂载 ConfigMap
          configMap:
            name: promoter-conf
      containers:
        - name: promoter
          imagePullPolicy: IfNotPresent
          args:
            - "--web.listen-address=:8060"
            - "--config.file=/etc/promoter/config.yml"  # 指定配置文件
          ports:
            - containerPort: 8060
          volumeMounts:
            - mountPath: /etc/promoter  # 配置文件挂载在容器的路径
              name: promoter-cfg
```

##### 6.2.3 **Service 暴露服务**
```yaml
# promoter-svc.yaml(默认是ClusterIP类型)
apiVersion: v1
kind: Service
metadata:
  name: promoter
  namespace: monitor
  labels:
    app: promoter
spec:
  selector:
    app: promoter
  ports:
    - port: 8080      # Service 端口
      targetPort: 8060  # 容器端口
```
#### **6.3 更新 Alertmanager 配置**
```yaml
# alertmanager-config.yaml（修改部分）
receivers:
  - name: mywebhook
    webhook_configs:
      - url: 'http://promoter:8080/dingtalk/webhook1/send'  # 通过 Service 访问
        send_resolved: true
```
#### **6.4 部署与验证**
1. **应用配置**
   
   ```bash
   kubectl apply -f promoter-conf.yaml
   kubectl apply -f promoter-deploy.yaml
   kubectl apply -f promoter-svc.yaml
   ```
   
2. **检查资源状态**
   ```bash
   kubectl -n monitor get pods -l app=promoter     # 检查 Pod
   kubectl -n monitor get svc promoter            # 检查 Service
   ```

3. **触发测试告警**
   
   - 修改 Prometheus 规则阈值，触发告警。
   - 观察钉钉群消息格式是否符合模板定义。
### 7. 发送告警并@所有人 或 @指定用户
#### **7.1 @所有人**
在钉钉 Webhook 配置中，通过 `mention.all: true` 实现@全体成员。仅需修改配置文件，无需调整模板。

**配置示例**

```yaml
# promoter-conf.yaml (ConfigMap)
targets:
  webhook1:
    url: https://oapi.dingtalk.com/robot/send?access_token=xxx
    secret: SECxxx
    message:
      text: '{{ template "default.tmpl" . }}'  # 引用模板
    mention:
      all: true  # 关键配置：@所有人
```

**效果**

- 告警消息中将自动添加 `@所有人`。
#### **7.2 @指定用户**
需 **两步配置**，缺一不可：
1. **定义手机号列表**：在 `mention.mobiles` 中声明需@的用户手机号。
2. **模板中显式@用户**：在text模板中通过 `@手机号` 手动触发。

**配置示例**

```yaml
# promoter-conf.yaml (ConfigMap)
targets:
  webhook1:
    url: https://oapi.dingtalk.com/robot/send?access_token=xxx
    secret: SECxxx
    message:
      text: |
        {{ template "default.tmpl" . }}
        @xxx @xxx  # 显式@用户（必须手动添加）
    mention:
      mobiles: ['xxx', 'xxx']  # 声明手机号列表
```

**效果**

- 告警消息中将@指定用户，且用户手机号需已在钉钉组织内公开。
