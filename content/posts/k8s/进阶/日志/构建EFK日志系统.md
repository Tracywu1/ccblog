---
title: "构建EFK日志系统"
draft: false
tags: ["k8s", "进阶", "日志"]
---

## 一、ELK 与 EFK
| 架构名称 | 核心组件                                                     | 适用场景           | 技术特点                      |
| -------- | ------------------------------------------------------------ | ------------------ | ----------------------------- |
| **ELK**  | Elasticsearch：统一存储检索引擎<br />**Logstash**：核心数据处理管道<br />Kibana：统一可视化平台 | 传统服务器日志处理 | 数据处理能力强，资源消耗较高  |
| **EFK**  | Elasticsearch<br />**Fluentd**：日志采集 + 基础处理<br />Kibana | 云原生/容器化环境  | 轻量级、K8s原生支持、高效采集 |

#### 为何选择 EFK？
1. **容器化适配优势**  
   
   - Fluentd 专为云原生设计，内置 K8s Metadata 过滤器  
   - 自动关联 Pod/Namespace 等元数据到日志记录
   
2. **资源效率对比**  
   | 指标     | Fluentd | Logstash |
   | -------- | ------- | -------- |
   | 内存占用 | ~40MB   | ~500MB   |
   | CPU消耗  | 低      | 较高     |
   | 启动速度 | 秒级    | 分钟级   |

3. **社区生态支持**  
   - Fluentd 是 CNCF 毕业项目  
   - 官方提供 K8s DaemonSet 部署模板
## 二、日志采集、处理工具三剑客

### 1. 厂商归属与定位
| 工具     | 所属组织 | 官方文档                                                     | 核心定位                  |
| -------- | -------- | ------------------------------------------------------------ | ------------------------- |
| Filebeat | Elastic  | [Filebeat Docs](https://www.elastic.co/guide/en/beats/filebeat/current/index.html) | 轻量级日志采集器          |
| Logstash | Elastic  | [Logstash Docs](https://www.elastic.co/guide/en/logstash/current/index.html) | 数据管道处理器            |
| Fluentd  | CNCF     | [Fluentd Docs](https://docs.fluentd.org)                     | 云原生日志采集器+中等处理 |

### 2. 功能对比矩阵
| 特性             | Filebeat          | Logstash      | Fluentd          |
| ---------------- | ----------------- | ------------- | ---------------- |
| **资源消耗**     | 极低（Go语言）    | 高（JVM）     | 中等（Ruby+C）   |
| **插件生态**     | 较少              | 最丰富        | 丰富（800+插件） |
| **数据处理能力** | 基础解析          | 强大过滤/转换 | 中等处理         |
| **K8s集成**      | 需额外配置        | 需额外配置    | 原生支持         |
| **部署模式**     | Agent             | Pipeline      | Agent/聚合器     |
| **协议支持**     | 主要文件/标准输入 | 全协议        | 全协议           |

### 3. 典型工作流对比

#### ELK 架构
```mermaid
graph LR
A[Filebeat] --> B[Logstash]
B --> C[Elasticsearch]
C --> D[Kibana]
```

#### EFK 架构
```mermaid
graph LR
A[Fluentd] --> 
 D[Elasticsearch]
D --> E[Kibana]
```

## 三、EFK + Kafka + Logstash 架构
<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/20210112111924313.png" alt="ELK、EFK、Prometheus、SkyWalking、K8s的排列组合_prometheus 能替代 elk-CSDN博客" style="zoom: 25%;" />

### 1. 核心应用场景

#### **大规模集群日志管理挑战**
- **问题背景**：  
  
  当集群规模庞大时，大量 Fluentd 实例直接向 Elasticsearch 写入日志（写入流量远超 ES 单节点/集群承载能力），可能导致：  
  
  - Elasticsearch 因高并发写入压力过大（CPU/内存飙升）
  
    - ES 的写入流程需消耗：
  
      ```mermaid
      graph LR
        A[写入请求] --> B[JSON 解析]
        B --> C[分词/索引构建]
        C --> D[写入 Lucene Segment]
        D --> E[刷盘持久化]
      ```
  
        高并发下：
  
      - **CPU 耗尽**：无法及时处理分词/索引构建
      - **内存不足**：Segment 缓存区溢出，触发频繁 GC
      - **磁盘 IOPS 打满**：大量并发刷盘操作堆积
  
  - 索引分片过载，引发搜索性能下降
  
    - 
  
  - 日志丢失风险增加（ES 写入队列溢出的部分会被丢弃）  
  
- **解决方案**：  
  
  引入 **Kafka 缓冲层** + **Logstash 处理层**，实现：  
  
  - **流量削峰**：平滑突发日志流量
  - **复杂数据处理**
  - **解耦处理**：分离采集、缓冲、处理阶段  
  - **弹性扩展**：各组件独立横向扩容
### 2. 完整架构流程

#### 2.1 数据流示意图
```mermaid
graph LR
A[Log Sources] --> B[Fluentd]
B --> C[Kafka]
C --> D[Logstash]
D --> E[Elasticsearch]
E --> F[Kibana]
```

#### 2.2 各组件核心职责

| 组件              | 核心职责                                |
| :---------------- | :-------------------------------------- |
| **Fluentd**       | 采集、简单处理、转发到 Kafka。          |
| **Kafka**         | 缓冲日志数据，解耦生产与消费流程。      |
| **Logstash**      | 复杂数据处理（解析、转换），输出到 ES。 |
| **Elasticsearch** | 存储、索引、提供搜索接口。              |
| **Kibana**        | 数据可视化与交互式分析。                |
### 3. 关键组件作用详解

#### 3.1 Kafka 的核心价值

- **流量削峰**：
  - Kafka 作为分布式消息队列，缓冲高并发日志数据，避免 ES 直接承受写入压力。
  - 支持持久化存储，确保数据可靠传输。
- **高效传输**：
  - 支持多生产者和消费者模型，允许异步处理和解耦数据生产与消费。
  - 提供横向扩展能力，适应大规模数据流。
#### 3.2 Logstash 的核心作用
- **复杂数据处理**：
  - Fluentd 擅长采集和简单处理（如过滤、格式化），而 Logstash 支持更复杂的操作（如正则解析、字段提取、数据增强）。
- **灵活性增强**：
  - 支持丰富的插件（如 `grok`、`mutate`），可处理多格式日志（如 JSON、文本、CSV）。
  - 提供多输出适配能力，便于与下游系统集成。
### 4. 工作流程

1. **日志来源**：
   - 包括应用程序、服务器、容器（如 K8s Pod）、网络设备等。
2. **Fluentd 阶段**：
   - **采集**：从日志源收集数据。
   - **初步处理**：过滤无关日志、添加元数据、格式化。
   - **转发至 Kafka**：将数据推送到指定 Kafka Topic。
3. **Kafka 阶段**：
   - **缓冲与传输**：持久化存储日志数据，按 Topic 分区管理。
   - **多消费者支持**：允许多个 Logstash 实例并行消费数据。
4. **Logstash 阶段**：
   - **输入**：通过 Kafka 输入插件订阅并消费 Topic 数据。
   - **处理**：执行复杂操作（如字段解析、类型转换、数据脱敏）。
   - **输出**：将处理后的数据发送到 Elasticsearch 索引。
5. **Elasticsearch 阶段**：
   - **存储与索引**：数据按索引结构存储，支持快速检索。
   - **集群扩展**：分布式架构支持横向扩容，保障高可用性。
6. **Kibana 阶段**：
   - **可视化**：通过仪表板展示日志分析结果。
   - **查询**：基于 ES 索引进行实时搜索与聚合分析。
## 五、安装 EFK
### **1. 安装 Elasticsearch 集群**
#### 1**.1 准备与规划**

1. **创建名称空间**  
   
   ```bash
   kubectl create ns logging
   ```
   
2. **环境要求**  
   - **最低配置**：  
     | 节点类型 | CPU 要求 | 内存要求 |
     | -------- | -------- | -------- |
     | Master   | >2 核    | >2Gi     |
     | Data     | >1 核    | >2Gi     |
     | Client   | >1 核    | >2Gi     |
     
   - **建议配置**：每节点 4 核 CPU + 4Gi 内存  

3. **部署规划**  
   | 集群名称      | 节点类型 | 副本数 | 存储大小 | 网络模式  | 描述                                 |
   | ------------- | -------- | ------ | -------- | --------- | ------------------------------------ |
   | elasticsearch | Master   | 3      | 5Gi      | ClusterIP | 控制 ES 集群                         |
   | elasticsearch | Data     | 3      | 50Gi     | ClusterIP | 存储数据                             |
   | elasticsearch | Client   | 2      | 无       | NodePort  | 处理用户请求，实现请求转发和负载均衡 |
#### **1.2 为 ES 准备持久化存储**

测试环境选用 NFS，生产环境建议使用 LocalPV 或者 Ceph RBD

1. **安装 NFS 服务端（192.168.71.101）**  
   
   ```bash
   # 安装软件
   yum install -y nfs-utils rpcbind
   
   # 创建共享目录
   mkdir -p /data/nfs && chmod 755 /data/nfs
   
   # 配置共享目录
   cat > /etc/exports <<EOF
   /data/nfs *(rw,sync,no_root_squash)
   EOF
   
   # 启动服务
   systemctl start rpcbind nfs
   systemctl enable rpcbind nfs
   ```
   
2. **客户端验证（所有 Node 节点）**  
   ```bash
   yum install -y nfs-utils
   showmount -e 192.168.71.101  # 查看共享目录
   mount -t nfs 192.168.71.101:/data/nfs /mnt  # 临时挂载测试
   ```

3. **部署 StorageClass（NFS Provisioner）**  
   ```bash
   # 添加 Helm 仓库
   helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner
   
   # 安装 Provisioner
   helm upgrade --install nfs-subdir-external-provisioner \
     nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
     --set nfs.server=192.168.71.101 \
     --set nfs.path=/data/nfs \
     --set storageClass.defaultClass=true \
     -n kube-system
   
   # 验证
   kubectl -n kube-system get sc nfs-client
   ```
#### **1.3 为 ES 准备证书文件**
1. **生成证书**  
   ```bash
   mkdir -p /logging/elastic-certs
   
   # 运行容器生成证书，containerd 下面用 nerdctl
   nerdctl run --name elastic-certs -v /logging/elastic-certs:/app -it -w /app \
     elasticsearch:7.17.3 /bin/sh -c \
     "elasticsearch-certutil ca --out /app/elastic-stack-ca.p12 --pass '' && \
      elasticsearch-certutil cert --name security-master --dns security-master --ca /app/elastic-stack-ca.p12 --pass '' --ca-pass '' --out /app/elastic-certificates.p12"
   
   # 删除容器
   nerdctl rm -f elastic-certs
   ```
   
2. **添加证书到 k8s**  
   
   ```bash
   # 含证书信息的 secret
   kubectl create secret -n logging generic elastic-certs --from-file=/logging/elastic-certs/elastic-certificates.p12
   
   # 含集群用户名密码的 secret
   kubectl create secret -n logging generic elastic-auth --from-literal=username=elastic --from-literal=password=xxx1234
   ```
#### **1.4 安装 ES 集群**
1. **添加 Helm 仓库**  
   ```bash
   helm repo add elastic https://helm.elastic.co
   helm repo update
   ```

2. **下载 Elasticsearch Chart**  
   ```bash
   helm pull elastic/elasticsearch --untar --version 7.17.3
   cd elasticsearch
   ```

3. **配置 Values 文件**  
   - **Master 节点（`values-master.yaml`）**  
     ```yaml
     ## 集群名称
     clusterName: 'elasticsearch'
     ## 设置节点名称
     nodeGroup: 'master'
     
     ## 设置角色
     roles: { master: 'true', data: 'false', ingest: 'false' }
     
     # ============镜像配置============
     ## 指定镜像与镜像版本
     #image: 'elasticsearch'
     imageTag: '7.17.3'
     imagePullPolicy: 'IfNotPresent'
     
     # 副本数
     ## 测试环境有限，可以设置为1 
     replicas: 3
     
     # ============资源配置============
     ## JVM 配置参数
     esJavaOpts: '-Xmx1g -Xms1g'
     ## 部署资源配置（生产环境要设置大些）
     resources: { requests: { cpu: '1000m', memory: '2Gi' }, limits: { cpu: '1000m', memory: '2Gi' } }
     ## 数据持久卷配置
     persistence.enabled: false
     
     # ============安全配置============
     ## 设置协议，可配置为 http、https
     protocol: http
     ## 证书挂载配置，这里我们挂入上面创建的证书
     secretMounts:
       - name: elastic-certs
         secretName: elastic-certs
         path: /usr/share/elasticsearch/config/certs
         defaultMode: 0755
     
     ## 允许您在/usr/share/elasticsearch/config/中添加任何自定义配置文件,例如elasticsearch.yml、log4j2.properties
     ## ElasticSearch 7.x 默认安装了 x-pack 插件，部分功能免费，这里我们配置下
     ## 下面注掉的部分为配置 https 证书，配置此部分还需要配置 helm 参数 protocol 值改为 https
     esConfig:
       elasticsearch.yml: |
         xpack.security.enabled: true
         xpack.security.transport.ssl.enabled: true
         xpack.security.transport.ssl.verification_mode: certificate
         xpack.security.transport.ssl.keystore.path: /usr/share/elasticsearch/config/certs/elastic-certificates.p12
         xpack.security.transport.ssl.truststore.path: /usr/share/elasticsearch/config/certs/elastic-certificates.p12
         # xpack.security.http.ssl.enabled: true
         # xpack.security.http.ssl.truststore.path: /usr/share/elasticsearch/config/certs/elastic-certificates.p12
         # xpack.security.http.ssl.keystore.path: /usr/share/elasticsearch/config/certs/elastic-certificates.p12
     
     ## 环境变量配置，这里引入上面设置的用户名、密码 secret 文件
     extraEnvs:
       - name: ELASTIC_USERNAME
         valueFrom:
           secretKeyRef:
             name: elastic-auth
             key: username
       - name: ELASTIC_PASSWORD
         valueFrom:
           secretKeyRef:
             name: elastic-auth
             key: password
             
     # ============调度配置============
     ## 设置调度策略
     ## - hard：只有当有足够的节点时 Pod 才会被调度，并且它们永远不会出现在同一个节点上
     ## - soft：尽最大努力调度
     antiAffinity: 'soft'
     # tolerations:
     # - operator: "Exists" ##容忍全部污点
     ```
   - **Data 节点（`values-data.yaml`）**  
     
     ```yaml
     nodeGroup: 'data'
     roles: { master: 'false', data: 'true', ingest: 'true' }
     persistence: 
       enabled: true 
     volumeClaimTemplate: 
         storageClassName: nfs-client
         accessModes: ['ReadWriteOnce']
         resources.requests.storage: 10Gi
     ```
   - **Client 节点（`values-client.yaml`）**  
     ```yaml
     nodeGroup: 'client'
     roles: { master: 'false', data: 'false', ingest: 'false' }
     service: { type: NodePort, nodePort: '30200' }
     ```
   
4. **安装集群**  
   ```bash
   # 安装 Master 节点
   helm install es-master ./ -f values-master.yaml -n logging
   
   # 安装 Data 节点
   helm install es-data ./ -f values-data.yaml -n logging
   
   # 安装 Client 节点
   helm install es-client ./ -f values-client.yaml -n logging
   ```

5. **验证安装**  
   ```bash
   kubectl -n logging get pods  # 检查 Pod 状态
   kubectl -n logging get svc elasticsearch-client  # 查看 NodePort 服务
   ```
#### **关键注意事项**
1. **资源不足问题**：  
   - 若 Pod 处于 `Pending` 状态，需检查节点资源（CPU/内存）是否满足要求。  
   - 实验环境可适当减少副本数（如 `replicas: 1`）。

2. **探针失败处理**：  
   - Master 节点初次启动可能因集群未就绪导致探针失败，安装 Data 节点后会自动恢复。  

3. **证书与安全**：  
   - 使用 `xpack.security` 配置强制启用 HTTPS（需调整 `protocol: https`）。  
#### **最终结果**
- **访问 ES**：通过 `NodePort 30200` 访问 Elasticsearch Client 节点。  
- **验证命令**：  
  ```bash
  curl http://<NodeIP>:30200 -u elastic:xxx1234
  ```

### 2. 安装 Kibana
#### **安装步骤**
1. **下载 Kibana Helm Chart**  
   
   ```bash
   helm pull elastic/kibana --untar --version 7.17.3  # 下载并解压 chart 包
   cd kibana
   ```
   
2. **创建 Values 配置文件（`values-prod.yaml`）**  
   ```yaml
   # ============镜像配置============
   imageTag: '7.17.3'
   imagePullPolicy: "IfNotPresent"
   
   # ============Elasticsearch 连接配置============
   elasticsearchHosts: 'http://elasticsearch-client:9200'  # 指向 ES Client 的 Service
   # 9200是 elasticsearch 集群默认的 REST API 端口，因为是在集群内部操作，故没有用到 NodePort
   
   # ============环境变量配置============
   extraEnvs:
     - name: 'ELASTICSEARCH_USERNAME'
       valueFrom:
         secretKeyRef:
           name: elastic-auth  # 引用之前创建的 Secret
           key: username
     - name: 'ELASTICSEARCH_PASSWORD'
       valueFrom:
         secretKeyRef:
           name: elastic-auth
           key: password
   
   # ============资源限制============
   resources:
     requests:
       cpu: '500m'
       memory: '1Gi'
     limits:
       cpu: '500m'
       memory: '1Gi'
   
   # ============Kibana 参数配置============
   kibanaConfig:
     kibana.yml: |
       i18n.locale: "zh-CN"  # 中文界面
       server.publicBaseUrl: "http://192.168.71.101:30601"  # 外部访问地址（无结尾斜杠）
   
   # ============Service 配置============
   service:
     type: NodePort
     nodePort: '30601'  # NodePort 端口
   ```
   
3. **部署 Kibana**  
   
   ```bash
   helm install kibana -f values-prod.yaml --namespace logging .  # 在 logging 命名空间部署
   ```
   
4. **验证安装**  
   ```bash
   kubectl -n logging get pods -w  # 检查 Pod 状态
   ```
   **预期输出**：  
   ```
   NAME                            READY   STATUS    RESTARTS   AGE
   kibana-kibana-7dd8569446-jm497  1/1     Running   0          6m9s
   ```

5. **访问 Kibana**  
   
   - **访问地址**：`http://<NodeIP>:30601`（`<NodeIP>` 可以是 k8s 集群中任意一个节点的 IP 地址）。  
     - **Kibana 独立部署**：
       Kibana 是一个独立的组件，通常以 `Deployment` 或 `StatefulSet` 形式部署在 K8s 集群中，**并不运行在 Elasticsearch 的节点 Pod 内**。
     - **Kibana 的  Service 类型为 NodePort**：
       - **所有节点开放端口**：K8s 会在**集群所有节点**（包括 Elasticsearch 的节点）上开放 `30601` 端口。
       - **流量转发**：访问任意节点的 IP + `30601` 端口，流量会被自动路由到 Kibana 的 Pod。
   - **登录凭证**：  
     - 用户名：`elastic`  
     - 密码：`xxx1234`（与 Elasticsearch 集群的 Secret 一致）
#### **最终结果**
- Kibana 成功部署并与 Elasticsearch 集群连接。  
- 通过 `http://<NodeIP>:30601` 访问中文界面，使用 `elastic:xxx1234` 登录。
### 3. 安装 Fluentd 作为日志收集工具
#### **3.1 Fluentd 工作原理**  

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250517215115736.png" alt="image-20250517215115736" style="zoom: 50%;" />

- **流程**：  
  1. 从日志源（如容器日志文件）收集数据。  
  2. 将数据转换为结构化格式并打标签。  
  3. 根据标签匹配规则将日志发送到目标（如 Elasticsearch、Kafka）。  
#### **3.2 Fluentd 配置详解**  
配置文件分为三部分：**日志源配置**、**过滤配置**、**路由配置**。
##### **3.2.1 日志源配置**  
**目标**：采集 `/var/log/containers/*.log` 的容器日志并解析。  
```xml
<source>
  @id fluentd-containers.log
  @type tail	<!-- 调用 tail 插件：Fluentd 内置的输入方式，其原理是不断地从源文件中获取新的日志 -->
  path /var/log/containers/*.log  <!-- 容器日志路径（宿主机）-->
  pos_file /var/log/es-containers.log.pos  <!-- 记录上一次的读取位置 -->
  tag raw.kubernetes.*  <!-- 日志标签 -->
  read_from_head true  <!-- 首次从头读取 -->
 
  <!-- 日志读取出来之后进行的格式化处理 -->
  <parse>
    @type multi_format  <!-- 多格式（多pattern）解析器 -->
    <pattern>
      format json  <!-- 尝试 JSON 解析 -->
      time_key time
      time_format %Y-%m-%dT%H:%M:%S.%NZ
    </pattern>
    <pattern>
      format /^(?<time>.+) (?<stream>stdout|stderr) [^ ]* (?<log>.*)$/  <!-- 正则解析非 JSON 日志 -->
      time_format %Y-%m-%dT%H:%M:%S.%N%:z
    </pattern>
  </parse>
</source>
```
##### **3.2.2 过滤配置**  
**目标**：清理字段并仅保留 `logging=true` 标签的 Pod 日志。  

```xml
<!-- 删除冗余字段(也可以在kibana删除) -->
<filter kubernetes.**> <!-- 这个过滤器应用于所有日志标签以 kubernetes. 开头的日志 -->
  @type record_transformer <!-- 使用 record_transformer 插件，它允许对日志记录进行转换，如添加、修改或删除字段 -->
  remove_keys $.docker.container_id,$.kubernetes.pod_id,...  <!--  移除指定字段 -->
    <!-- remove_keys 指定了要从日志记录中删除的字段。字段包括： -->
	<!-- $.docker.container_id: Docker 容器 ID -->
	<!-- $.kubernetes.container_image_id: Kubernetes 容器镜像 ID -->
	<!-- $.kubernetes.pod_id: Kubernetes Pod ID -->
	<!-- $.kubernetes.namespace_id: Kubernetes 命名空间 ID -->
	<!-- $.kubernetes.master_url: Kubernetes Master URL -->
	<!-- $.kubernetes.labels.pod-template-hash: Kubernetes Pod 模板哈希标签 -->
</filter>

<!-- 仅保留 logging=true 的日志 -->
<filter kubernetes.**>
  @id filter_log	<!--  为这个过滤器配置一 个唯一的 ID filter_log，便于管理和调试。 -->
  @type grep	<!--  使用 grep 插件，它用于按指定的模式过滤日志记录。只有匹配模式的日志才会被保留下来。 -->
  <regexp>
    key $.kubernetes.labels.logging  <!--  检查标签 -->
    pattern ^true$  <!--  正则匹配 -->
  </regexp>
</filter>
```
##### **3.2.3 路由配置**  

**目标**：将日志发送到 Elasticsearch，并配置缓冲区策略。  

```xml
<match **>  <!-- 匹配所有日志 -->
  @id elasticsearch
  @type elasticsearch	<!-- elasticsearch ：日志输出插件，
将日志数据发送到 Elasticsearch。 -->
  @log_level info <!-- 日志级别配置成info，表示任何该级别或者该级别以上（INFO、
WARNING、ERROR）的日志都将被路由到ES -->
  include_tag_key true <!-- 设置为 true，表示在发送到 Elasticsearch 的日志数据中会包含日
志的标签（tag）。这是有用的，可以在 Elasticsearch 中使用标签进行筛选和查询 -->
  type_name fluentd <!-- 用于指定 Elasticsearch 中索引的类型名称，这会影响数据在
Elasticsearch 中的存储方式。 -->
  
  host elasticsearch-client  <!-- ES Client Service -->
  port 9200
  user elastic  <!-- 用户名 -->
  password xxx1234  <!-- 密码 -->
  
  logstash_format true  <!-- Fluentd 将日志数据以 Logstash 格式发送到 Elasticsearch。
Logstash 格式通常包括时间戳、日志级别、消息内容等，有助于结构化日志的处理。 -->
    
  <!-- Fluentd 允许在目标（对接的下游服务）不可用时进行缓存，比如，如果网络出现故障或者 ES 不
可用的时候。 -->
  <buffer> <!--  -->
  @type file <!-- 设置缓存类型为 file，表示 Fluentd 将日志数据缓存在本地文件中。这对于处理大
量日志或网络故障时非常有用。 -->
  path /var/log/fluentd-buffers/kubernetes.system.buffer  <!-- 缓存文件存储的路径。 -->
  flush_mode interval  <!-- 按照时间间隔进行数据刷新（将数据从缓冲区发送到 Elasticsearch） -->
  retry_type exponential_backoff  <!-- 设置重试类型为 exponential_backoff，这意味着在网
络错误或 Elasticsearch 不可用时，Fluentd 会进行指数退避重试，逐渐增加重试间隔。 -->
  flush_thread_count 2  <!-- 设置用于刷新缓冲区的线程数为 2。提高线程数可以提升数据的处理能力。 -->
  flush_interval 5s  <!-- 设置刷新间隔为 5 秒。这意味着每隔 5 秒，Fluentd 将尝试将缓冲区中的数据发送到 Elasticsearch。 -->
  retry_forever true  <!-- 默认值为 true，表示在 Elasticsearch 不可用时会无限重试，不会放弃。 -->
  retry_max_interval 30  <!-- 设置重试的最大间隔时间为 30 秒。如果 Elasticsearch 长时间不
可用，重试间隔会增加，直到达到这个最大值。 -->
  chunk_limit_size 2M  <!-- 缓冲区中单个数据块的最大尺寸 -->
  queue_limit_length 8  <!-- 缓冲区队列的最大
长度  -->
  overflow_action block  <!-- 设置溢出行为为 block，这意味着如果缓冲区队列长度超过 queue_limit_length，新的日志写入将被阻塞，直到队列长度减少到可接受的范围内。 -->
  </buffer>
</match>
```
#### **3.3 安装 Fluentd** 

> 官网部署参考：https://docs.fluentd.org/container-deployment/kubernetes

**部署方式**：使用 DaemonSet 确保每个节点运行一个 Fluentd 实例。  （也可以直接使用 Helm 来进行一键安装）

> **配置流程**：
>
> 1. 日志采集：从指定的路径读取日志文件并打上标签 raw.kubernetes.*。*
>    - 日志源：从容器日志文件 /var/log/containers/*.log 中读取日志。*
>    - 标签：日志被打上 raw.kubernetes.* 标签，这里的 * 是通配符，表示所有相关的日志都会用这个标签。
>    - 解析：使用 multi_format 解析器处理日志，先尝试 JSON 解析，如果失败，再用正则表达式解析。
>
> 2. 异常检测+处理 （处理raw.kubernetes.** 标签的日志）：
>    - 标签匹配：匹配所有以 raw.kubernetes. 开头的日志。
>    - 插件：使用 detect_exceptions 插件检测异常信息，并处理这些异常栈。
>    - 标签处理：去除日志标签中的 raw 前缀，将 raw.kubernetes.some_log 转换为 kubernetes.some_log。
>    - 日志字段：指定 log 字段作为日志消息的主要内容。
>    - 多行处理：确保多行日志在 5 秒内被合并为一条完整的日志记录。
>
> 3. 过滤器配置
>
>    （1）拼接日志（针对所有日志）
>
>    - 匹配：所有日志（**）。
>    - 插件：使用 concat 插件将多行日志拼接成一条完整的日志记录。
>    - 拼接规则：根据换行符 \n 拼接日志行，拼接后的日志条目之间没有额外分隔符。
>
>    （2）添加 Kubernetes 元数据。
>
>    - 匹配：所有以 kubernetes. 开头的日志。
>    - 插件：使用 kubernetes_metadata 插件为日志添加 Kubernetes 相关元数据。
>
>    （3）解析 JSON 字段。
>
>    - 匹配：所有以 kubernetes. 开头的日志。
>    - 插件：使用 parser 插件来处理 JSON 格式的日志字段，保留原始数据，并移除 log 字段后进行进一步解析。
>
>    （4）删除多余字段。
>
>    - 匹配：所有以 kubernetes. 开头的日志。
>    - 插件：使用 record_transformer 插件删除指定的字段，清理不必要的日志数据。
>
>    （5）筛选符合条件的日志。
>
>    - 匹配：所有以 kubernetes. 开头的日志。
>    - 插件：使用 grep 插件根据 $.kubernetes.labels.logging 字段的值过滤日志，仅保留 logging=true 的日志。

##### **3.3.1 创建 Fluentd 配置文件（ConfigMap）**

`fluentd-configmap.yaml`：  
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-conf
  namespace: logging
data:
  # ------------------------- 1. 日志采集与处理配置 -------------------------
  containers.input.conf: |-
    <source>
      @id fluentd-containers.log
      @type tail
      path /var/log/containers/*.log  # 容器日志路径
      pos_file /var/log/es-containers.log.pos  # 记录读取位置
      tag raw.kubernetes.*  # 原始日志标签
      read_from_head true  # 首次从头读取日志
      <parse>
        @type multi_format  # 多格式解析器
        <pattern>
          format json  # 解析 JSON 格式日志
          time_key time
          time_format %Y-%m-%dT%H:%M:%S.%NZ
        </pattern>
        <pattern>
          format /^(?<time>.+) (?<stream>stdout|stderr) [^ ]* (?<log>.*)$/
          time_format %Y-%m-%dT%H:%M:%S.%N%:z  # 正则解析非 JSON 日志
        </pattern>
      </parse>
    </source>

    # ------------------------- 2. 异常检测与标签处理 -------------------------
    <match raw.kubernetes.**>
      @id raw.kubernetes
      @type detect_exceptions  # `detect_exceptions` 插件自动合并异常堆栈为单条日志。  
      remove_tag_prefix raw    # 移除标签前缀（raw.kubernetes → kubernetes）
      message log              # 指定日志消息字段
      multiline_flush_interval 5  # 多行日志合并时间窗口（5秒）
    </match>

    # ------------------------- 3. 日志过滤与增强 -------------------------
    # 3.1 多行日志拼接
    <filter **>
      @id filter_concat
      @type concat	# concat 插件拼接多行日志，避免日志被拆分。  
      key message
      multiline_end_regexp /\n$/	# 以换行符“\n”拼接
      separator ""	# 设置拼接后的日志条目之间的分隔符为空字符串。即多行日志将被直接拼接在一起，没有额外的分隔符
    </filter>

    # 3.2 添加 Kubernetes 元数据
    <filter kubernetes.**>
      @id filter_kubernetes_metadata
      @type kubernetes_metadata  # 补充 Pod/Namespace 元数据
    </filter>

    # 3.3 解析 JSON 字段并清理冗余数据
    <filter kubernetes.**>
      @id filter_parser
      @type parser
      key_name log	# 指定要解析的日志字段名称是 log。插件会在这个字段内执行解析操作。
      reserve_data true	# 在解析过程中保留原始数据。
      remove_key_name_field true	# 在成功解析日志后，移除 key_name 字段。
      <parse>
        @type multi_format
        <pattern>
          format json  # 尝试解析为 JSON
        </pattern>
        <pattern>
          format none  # 无法解析则保留原始格式
        </pattern>
      </parse>
    </filter>

    # 3.4 删除冗余字段
    <filter kubernetes.**>
      @type record_transformer
      remove_keys $.docker.container_id,$.kubernetes.container_image_id,$.kubernetes.pod_id,$.kubernetes.namespace_id,$.kubernetes.master_url,$.kubernetes.labels.pod-template-hash  # 删除无用字段
    </filter>

    # 3.5 仅保留 logging=true 标签的日志
    <filter kubernetes.**>
      @id filter_log
      @type grep
      <regexp>
        key $.kubernetes.labels.logging
        pattern ^true$  # 过滤条件：Pod 需有 logging=true 标签
      </regexp>
    </filter>

  # ------------------------- 4. 日志输出到 Elasticsearch -------------------------
  output.conf: |-
    <match **>
      @id elasticsearch
      @type elasticsearch
      host elasticsearch-client  # Elasticsearch Service 地址
      port 9200
      user elastic               # ES 用户名（通过 Secret 配置）
      password xxx1234           # ES 密码
      logstash_format true       # 使用 Logstash 格式
      logstash_prefix k8s        # 索引前缀（生成索引如 k8s-YYYY.MM.dd）
      
      request_timeout 30s
      <buffer>
        @type file
        path /var/log/fluentd-buffers/kubernetes.system.buffer  # 缓冲区路径
        flush_mode interval
        retry_type exponential_backoff
        flush_thread_count 2
        flush_interval 5s        # 每 5 秒刷新缓冲区
        retry_forever true       # 无限重试
        retry_max_interval 30
        chunk_limit_size 2M      # 单块最大 2MB
        queue_limit_length 8	
        overflow_action block
      </buffer>
    </match>
    
  # ------------------------- 5. 监听配置，一般用于日志聚合用（可选） -------------------------
  forward.input.conf: |-
  # 监听通过TCP发送的消息
    <source>
      @id forward
      @type forward # forward 插件会监听通过 TCP 协议发送到 Fluentd 的日志消息。其他Fluentd 实例或应用程序可以将日志数据发送到这个 Fluentd 实例，该实例会接收并处理这些日志消息
      
    # 默认情况下，forward 插件会监听 TCP 端口 24224。您可以根据需要修改端口号和其他设置。要进行自定义配置，如设置端口号、绑定地址等，可以添加相应的配置参数。例如
    # port 24224 # 设置监听的端口号
    # bind 0.0.0.0 # 绑定所有网络接口
    
    # 这个配置通常用于构建多实例 Fluentd 部署，其中一个实例作为集中式日志接收器，接收来自不同实例或服务的日志数据。这种设置有助于集中管理和处理日志数据，并将日志数据进一步转发到其他系统（如 Elasticsearch、Kafka、文件等）。
    </source>
```

##### **3.3.2 创建 Fluentd RBAC 权限**  
`fluentd-daemonset.yaml`：  
```yaml
# ------------------------- 1. ServiceAccount -------------------------
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fluentd-es
  namespace: logging
  labels:
    k8s-app: fluentd-es

# ------------------------- 2. ClusterRole -------------------------
kind: ClusterRole
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: fluentd-es
  labels:
    k8s-app: fluentd-es
rules:
- apiGroups: [""]
  resources: ["namespaces", "pods"]  # 授予访问 Namespace 和 Pod 的权限
  verbs: ["get", "watch", "list"]

# ------------------------- 3. ClusterRoleBinding -------------------------
kind: ClusterRoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: fluentd-es
  labels:
    k8s-app: fluentd-es
subjects:
- kind: ServiceAccount
  name: fluentd-es
  namespace: logging
roleRef:
  kind: ClusterRole
  name: fluentd-es

# ------------------------- 4. DaemonSet -------------------------
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: logging
  labels:
    app: fluentd
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      serviceAccountName: fluentd-es  # 绑定 ServiceAccount
      tolerations:                   # 容忍 Master 节点污点
      - key: node-role.kubernetes.io/master
        effect: NoSchedule
      containers:
      - name: fluentd
        volumeMounts:
        - name: fluentconfig
          mountPath: /etc/fluent/config.d  # 挂载 ConfigMap
        - name: varlog
          mountPath: /var/log              # 挂宿主机日志目录
      volumes:
      - name: fluentconfig
        configMap:
          name: fluentd-conf  # 引用 ConfigMap
      - name: varlog
        hostPath:
          path: /var/log      # 宿主机日志路径

      # 可选：限制 Fluentd 部署到特定节点
      # nodeSelector:
      #   beta.kubernetes.io/fluentd-ds-ready: "true"
```

##### 3.3.3 部署与验证

**部署**  

```bash
kubectl apply -f fluentd-configmap.yaml
kubectl apply -f fluentd-daemonset.yaml
```

**验证部署**  

```bash
kubectl -n logging get pods -o wide
```
**预期输出**：每个节点运行一个 Fluentd Pod。  
#### **3.4 测试日志采集**  
**步骤**：  
1. **部署测试 Pod**：  
   
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: counter
     labels:
       logging: 'true'  # 必须带有此标签才会被采集
   spec:
     containers:
       - name: count
         image: centos
         args: ["/bin/sh", "-c", "i=0; while true; do echo \"$i: $(date)\"; i=$((i+1)); sleep 1; done"]
   ```
   ```bash
   kubectl apply -f counter.yaml
   ```
   
2. **Kibana 配置索引模式**：  
   
   - 访问 Kibana：`http://<NodeIP>:30601`。  
   - 进入 **Stack Management > 索引模式 > 创建索引模式**，输入 `k8s-*`。  
   - 选择时间字段 `@timestamp`，完成创建。  
   
3. **查看日志**：  
   - 进入 **Discover** 页面，选择 `k8s-*` 索引模式。  
   - 筛选 `kubernetes.pod_name: "counter"`，查看实时日志。  
### 4. 安装 Kafka
#### **4.1 安装背景**  
- **目的**：缓解 Fluentd 直接写入 Elasticsearch 的压力，通过 Kafka 实现流量削峰。  
- **流程**：  
  
  ```plaintext
  Fluentd → Kafka → Logstash → Elasticsearch → Kibana  
  ```
#### **4.2 安装步骤**  

##### **4.2.1 添加 Helm 仓库**  
```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

##### **4.2.2 下载 Kafka Chart**  
```bash
helm pull bitnami/kafka --untar --version 17.2.3
cd kafka
```

##### **4.2..3 配置 Values 文件**  
创建 `values-prod.yaml`，配置持久化存储：  
```yaml
# values-prod.yaml
## Kafka 持久化配置
persistence:
  enabled: true
  storageClass: 'nfs-client'  # 使用 NFS StorageClass
  accessModes:
    - ReadWriteOnce
  size: 8Gi
  mountPath: /bitnami/kafka

## Zookeeper 持久化配置
zookeeper:
  enabled: true  # 启用内置 Zookeeper
  persistence:
    enabled: true
    storageClass: 'nfs-client'
    accessModes:
      - ReadWriteOnce
    size: 8Gi
```

##### **4.2.4 安装 Kafka**  
```bash
helm upgrade --install kafka -f values-prod.yaml --namespace logging .
```

##### **4.2.5 镜像加速（可选）**  
若默认镜像下载慢，替换为阿里云镜像：  
```yaml
# 在 values-prod.yaml 中添加：
image:
  tag: 3.2.0-debian-10-r4
 
zookeeper:
  image:
    tag: 3.8.0-debian-10-r64
```

##### **4.2.6 验证部署**  
```bash
kubectl -n logging get pods -w
```
**预期输出**：  

```
NAME                READY   STATUS    RESTARTS   AGE
kafka-0             1/1     Running   0          2m10s     # Kafka Broker
kafka-zookeeper-0   1/1     Running   0          12m       # Zookeeper
```
#### **4.3 关键组件说明**  
- **Kafka Broker**：处理消息的生产和消费。  
- **Zookeeper**：管理 Kafka 集群的元数据和协调。  
- **服务地址**：  
  - Kafka 集群内部 DNS：`kafka.logging.svc.cluster.local:9092`  
  - Broker 独立地址：`kafka-0.kafka-headless.logging.svc.cluster.local:9092`  
#### **4.4 测试 Kafka 功能**  

##### **1. 创建测试客户端 Pod**  
```bash
kubectl run kafka-client \
  --restart='Never' \
  --image docker.io/bitnami/kafka:3.2.0-debian-10-r4 \
  --namespace logging \
  --command -- sleep infinity
```

##### **2. 启动生产者**

进入 Pod 内，启动生产者

```bash
kubectl exec -it kafka-client -n logging -- bash
kafka-console-producer.sh \
  --broker-list kafka-0.kafka-headless.logging.svc.cluster.local:9092 \
  --topic test
```

##### **3. 启动消费者**

在另一个终端也进入 Pod 内，启动消费者

```bash
kubectl exec -it kafka-client -n logging -- bash
kafka-console-consumer.sh \
  --bootstrap-server kafka.logging.svc.cluster.local:9092 \
  --topic test \
  --from-beginning
```

**验证结果**：  
- 在生产者终端输入消息（如 `Hello Kafka`），消费者终端应实时接收该消息。  
### 5. 配置 Fluentd 对接 Kafka  
#### **5.1 目标**  
将 Fluentd 日志输出目标由 Elasticsearch 改为 Kafka，实现日志流缓冲。  
#### **5.2 步骤说明**  

##### **1. 构建包含 Kafka 插件的 Fluentd 镜像**  
- **Dockerfile**（使用 `containerd` 时命名为 `Containerfile`）：  
  
  ```dockerfile
  # 基础镜像（已包含 Fluentd 核心组件）
  
  # 安装 Kafka 插件
  RUN echo "source 'https://mirrors.tuna.tsinghua.edu.cn/rubygems/'" > Gemfile && \
      gem install bundler -v 2.4.22
  RUN gem install fluent-plugin-kafka -v 0.17.5 --no-document
  ```
- **构建镜像**：  
  
  ```bash
  ```
##### **2. 修改 Fluentd 配置（ConfigMap）**  
更新 `fluentd-configmap.yaml` 的 `output.conf` 部分：  
```yaml
# 把 ES 换成 Kafka
output.conf: |-
  <match **>
    @id kafka
    @type kafka2  # 使用 fluent-plugin-kafka 插件
    @log_level info
    
    # Kafka Broker 地址（Headless Service 确保直连 Pod）
    brokers kafka-0.kafka-headless.logging.svc.cluster.local:9092	# 指向一个具体的 Pod (kafka-0)
    # 可以换成 brokers kafka.logging.svc.cluster.local:9092(增高kafka服务的地址)
    use_event_time true  # 使用日志事件本身自带的时间作为 Kafka 消息时间戳，而非日志到达 Fluentd / 采集的时间，确保时间的准确性

    # Topic 配置
    # topic_key k8slog # 由于 topic_key 是固定的 k8slog，所有消息将被发送到 messages 主题的同一个分区，从而保证消息的顺序性。移除该配置消息将会被均匀分布到所有分区，适合负载均衡，但是不保证顺序性
    default_topic messages  # 指定所有日志默认发送的 Topic（需与后续 Logstash 消费的 Topic 一致）

    # 缓冲配置
    <buffer k8slog>
      @type file
      path /var/log/td-agent/buffer/td  # 缓冲区文件路径
      flush_interval 3s  # 每 3 秒刷新一次缓冲区
    </buffer>

    # 数据格式
    <format>
      @type json  # 输出为 JSON 格式
    </format>

    # 生产者配置
    required_acks -1  # 生产者需等待所有副本确认，保证数据不丢失
    compression_codec gzip  # 启用 GZIP 压缩，减少网络带宽消耗
  </match>
```
##### **3. 更新 Fluentd DaemonSet**  
修改 `fluentd-daemonset.yaml` 中的镜像地址：  
```yaml
containers:
  - name: fluentd
```
##### **4. 重新部署 Fluentd**  
```bash
kubectl delete -f fluentd-configmap.yaml
kubectl delete -f fluentd-daemonset.yaml

kubectl apply -f fluentd-configmap.yaml  # 更新配置
kubectl apply -f fluentd-daemonset.yaml  # 重启 Fluentd
```
#### **5.3 验证日志写入 Kafka**  
1. **启动 Kafka 消费者**：  
   
   ```bash
   kubectl exec -it kafka-client -n logging -- \
     kafka-console-consumer.sh \
       --bootstrap-server kafka.logging.svc.cluster.local:9092 \
       --topic messages \
       --from-beginning
   ```
2. **预期输出**：  
   
   ```json
   {
     "stream": "stdout",
     "kubernetes": {
       "container_name": "count",
       "pod_name": "counter",
       "labels": {"logging": "true"},
       ...
     },
     "message": "220379: Sat Jul 13 02:09:43 UTC 2024"
   } 
   ```
### 6. 安装 Logstash 对接 Kafka  
#### 6.1**目标**  
配置 Logstash 消费 Kafka 中的日志数据，并转发至 Elasticsearch。  
#### 6.2 **安装步骤**  

##### **1. 拉取 Logstash Helm Chart**  
```bash
helm pull elastic/logstash --untar --version 7.17.3
cd logstash
```

##### **2. 创建 Values 配置文件**  
新建 `values-prod.yaml`，配置资源、持久化存储及数据管道：  
```yaml
# values-prod.yaml
fullnameOverride: logstash  # 覆盖默认的命名规则，固定为 logstash

## 资源限制
resources:
  requests:
    cpu: "100m"
    memory: "1536Mi"
  limits:
    cpu: "1000m"
    memory: "1536Mi"

## 持久化存储配置
persistence:
  enabled: true
  volumeClaimTemplate:
    accessModes: ['ReadWriteOnce']
    storageClassName: nfs-client  # 使用 NFS StorageClass
    resources:
      requests:
        storage: 1Gi

## Logstash 主配置
logstashConfig:
  logstash.yml: |
    http.host: 0.0.0.0  # 允许外部访问 HTTP 接口
    # 启用 X-Pack 监控
    xpack.monitoring.enabled: true
    xpack.monitoring.elasticsearch.hosts: ["http://elasticsearch-client:9200"]
    xpack.monitoring.elasticsearch.username: "elastic"

## 数据管道配置（输入、过滤、输出）
logstashPipeline:
  logstash.conf: |
    input {
      kafka {
        bootstrap_servers => "kafka-0.kafka-headless.logging.svc.cluster.local:9092"  # Kafka Broker 地址
        codec => json  # 数据格式为 JSON
        consumer_threads => 3  # 消费线程数
        topics => ["messages"]  # 订阅的 Topic
      }
    }
    filter {}  # 空过滤器（可按需添加字段处理）
    output {
      elasticsearch {
        hosts => ["elasticsearch-client:9200"]  # ES Client Service
        user => "elastic"
        password => "xxx1234"
        index => "logstash-k8s-%{+YYYY.MM.dd}"  # 索引格式（按日期分片）
      }
      stdout {  # 启用调试模式，输出到控制台
        codec => rubydebug
      }
    }
```

##### **3. 部署 Logstash**  
```bash
helm upgrade --install logstash -f values-prod.yaml --namespace logging .
```
**镜像加速（可选）**：  
若默认镜像下载慢，替换为阿里云镜像：  
```yaml
image:
  tag: 7.17.3
```

##### **4. 验证部署**  
```bash
kubectl -n logging get pods -l app=logstash
```
**预期输出**：  
```
NAME         READY   STATUS    RESTARTS   AGE
logstash-0   1/1     Running   0          2m8s
```

##### **5. 查看日志数据**  
检查 Logstash 是否成功消费 Kafka 数据：  
```bash
kubectl logs -f logstash-0 -n logging
```
**预期输出**：  
```json
{
  "docker" => {},
  "@version" => "1",
  "stream" => "stdout",
  "@timestamp" => 2024-07-13T03:14:09.695Z,
  "message" => "224228: Sat Jul 13 03:14:08 UTC 2024",
  "kubernetes" => {
    "namespace_labels" => {"kubernetes_io/metadata_name" => "default"},
    "namespace_name" => "default",
    "host" => "master03",
    "pod_ip" => "10.244.2.20",
    "labels" => {"logging" => "true"},
    "container_name" => "count",
    "container_image" => "docker.io/library/centos:latest",
    "pod_name" => "counter"
  }
}
```
#### **6.2 Kibana 配置索引模式**  
1. **登录 Kibana**：访问 `http://<NodeIP>:30601`。  
2. **创建索引模式**：  
   - 进入 **Stack Management > 索引模式 > 创建索引模式**。  
   - 输入 `logstash-k8s-*`，匹配 Logstash 生成的索引。  
   - 选择时间字段 `@timestamp`。  

3. **查看日志**：  
   - 进入 **Discover** 页面，选择 `logstash-k8s-*` 索引模式。  
   - 筛选 `kubernetes.pod_name: "counter"`，查看测试 Pod 的日志。  
#### **6.3 最终组件状态**  
```bash
kubectl -n logging get pods
```
**预期输出**：  
```
NAME                        READY   STATUS    RESTARTS   AGE
elasticsearch-client-0      1/1     Running   0          102s
elasticsearch-data-0        1/1     Running   0          94s
elasticsearch-master-0      1/1     Running   0          97s
fluentd-9x5x9               1/1     Running   0          64m
kafka-0                     1/1     Running   0          103m
logstash-0                  1/1     Running   0          21m
kibana-kibana-7dd8569446-sspjs 1/1 Running 0          41m
```

至此，完成 **Fluentd → Kafka → Logstash → Elasticsearch → Kibana** 全链路日志收集与处理。

### 7. 定制索引名称  
#### **7.1 目标**  
通过两级过滤机制（Fluentd + Logstash）实现日志的精细化管理，并动态生成 Elasticsearch 索引名称。  
#### **7.2 第一道关卡：Fluentd 标签过滤**  
**配置**：确保 Fluentd 仅采集带有 `logging: "true"` 标签的 Pod 日志。  
```xml
<!-- fluentd-configmap.yaml 中的过滤配置 -->
<filter kubernetes.**>
  @id filter_log
  @type grep
  <regexp>
    key $.kubernetes.labels.logging
    pattern ^true$  # 仅保留 logging=true 的日志
  </regexp>
</filter>
```
**效果**：  

- 只有 Pod 的 `metadata.labels` 包含 `logging: "true"` 时，其日志才会被 Fluentd 采集并发送到 Kafka。  
#### **7.3 第二道关卡：Logstash 动态索引**  
**配置**：修改 Logstash 的 `output` 部分，动态生成索引名称。  
```yaml
# values-prod.yaml 中的 Logstash Pipeline 配置
logstashPipeline:
  logstash.conf: |
    output {
      elasticsearch {
        index => "k8s-%{[kubernetes][labels][logIndex]}-%{+YYYY.MM.dd}"  # 动态索引名称
        hosts => ["elasticsearch-client:9200"]
        user => "elastic"
      }
    }
```
**参数说明**：  
- `%{[kubernetes][labels][logIndex]}`：从日志字段中提取 `kubernetes.labels.logIndex` 的值（即 Pod 的 `logIndex` 标签）。  
- `%{+YYYY.MM.dd}`：按日期分片索引（如 `2024.07.13`）。  
#### **7.4 更新 Logstash 配置**  
```bash
# 使用 Helm 更新 Logstash
helm upgrade --install logstash -f values-prod.yaml --namespace logging .
```
#### **7.5 测试 Pod 配置**  
**示例 Pod**：添加 `logging` 和 `logIndex` 标签。  
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: counter
  labels:
    logging: 'true'    # 触发 Fluentd 采集
    logIndex: 'test'    # 指定索引名称中的 logIndex 部分
spec:
  containers:
    - name: count
      image: busybox
      args: ["/bin/sh", "-c", "i=0; while true; do echo \"$i: $(date)\"; i=$((i+1)); sleep 1; done"]
```
**预期索引名称**：`k8s-test-2024.07.13`  
#### **7.6 验证步骤**  
1. **检查 Logstash 日志**：  
   ```bash
   kubectl logs -f logstash-0 -n logging
   ```
   **预期输出**：  
   ```json
   {
     "kubernetes" => {
       "labels" => {
         "logging" => "true",
         "logIndex" => "test"  # 动态提取的标签值
       }
     }
   }
   ```

2. **Kibana 创建索引模式**：  
   - 进入 **Stack Management > 索引模式 > 创建索引模式**。  
   - 输入 `k8s-test-*`，匹配动态生成的索引。  
   - 选择时间字段 `@timestamp`。  

3. **查询日志**：  
   
   - 在 **Discover** 页面选择 `k8s-test-*` 索引模式，查看日志数据。  
#### **7.7 最终效果**  
- 日志采集链路：  
  ```plaintext
  Pod（logging:true + logIndex:test） → Fluentd → Kafka → Logstash → ES（k8s-test-YYYY.MM.dd） → Kibana  
  ```
- 索引按服务名称和日期自动分片，便于管理和查询。