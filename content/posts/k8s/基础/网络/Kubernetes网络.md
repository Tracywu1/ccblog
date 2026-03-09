---
title: "Kubernetes网络"
draft: false
tags: ["k8s", "基础", "网络"]
---

## 一、Pod的三种使用方式

| 类型                     | 创建方式                                                     | 管理方式                                                     | 特点                                                         | 使用场景                                          | 注意事项                   |
| :----------------------- | ------------------------------------------------------------ | :----------------------------------------------------------- | :----------------------------------------------------------- | :------------------------------------------------ | :------------------------- |
| **Kubelet管理的静态Pod** | 1. Kubelet定期扫描`/etc/kubernetes/manifests/`目录下的YAML文件 <br />2. 直接创建Pod | Kubelet直接管理（无需API Server）                            | - 部署关键系统组件（如kube-apiserver、kube-scheduler） <br />- 节点重启后自动恢复 <br />- 不受控制器管理 | 关键系统组件部署                                  | 删除需手动删除对应YAML文件 |
| **控制器管理的Pod**      | 通过控制器资源（Deployment、StatefulSet等）定义创建          | 由控制器管理（如Deployment、StatefulSet、DaemonSet、Job/CronJob） | - **Deployment**：滚动更新、版本回滚 <br />- **StatefulSet**：有序部署，稳定网络和存储 <br />- **DaemonSet**：每节点一个副本 <br />- **Job/CronJob**：批处理任务 - 支持自动扩缩容（HPA）、故障自愈 | 生产环境中的无状态/有状态应用、守护进程、定时任务 | 生产环境推荐使用           |
| **裸Pod（Bare Pod）**    | 直接通过`kubectl run`命令或YAML文件创建                      | 无控制器管理                                                 | - 容器故障自动重启（依赖`restartPolicy`） <br />- 节点故障时不会自动迁移 <br />- 无副本保持能力 | 临时测试或调试                                    | 生产环境不推荐             |
## 二、🌟🌟🌟Pod创建流程（非静态Pod）

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250412003303691.png" alt="image-20250412003303691" style="zoom:50%;" align='left'/>

> 0、controller-manager、scheduler、kubelet均监听API-Server，只watch自己关注的资源  
>
> 1、kubectl提交创建pod副本的请求---> API-server
>
> 2、创建pod副本的事件记入ETCD 
>
> 3、上报事件给 API-server
>
> 4、controller-manager从API-server那里watch到创建pod副本的事件，会调用具体的控制器来工作，不同的控制器有不同的特性，例如Replicaset控制器，该控制器的核心作用就是控制pod数到指定个数，如果kubectl提交过来的是创建3个pod，而当前pod为2个，则需要新增一个pod
>
> 5、创建Pod的事件提交给API-server 
>
> 6、 API-server将该事件记入ETCD
>
> 7、上报
>
> 8、scheduler从API-server那里watch到创建pod副本的事件，负责选出一个工作节点来创建pod，筛选过程分为两个阶段
>
> - （1） 预选：根据污点、选择器等筛选出符合条件的节点
>
> - （2） 优选：从筛出的节点里进行打分，选择资源最优的
> - 如果没有节点被选中来运行Pod，那么Pod的状态将会变为`Pending`
>
> 9、将选出的节点提交给API-server 
>
> 10、记入etcd
>
> 11、上报
>
> 12、指定的工作节点上的的kubelet组件watch到创建POD的事件，开始创建POD 
>
> +list-watch机制（长连接、短连接）

#### **阶段 0：组件初始化与全量同步**

- **Controller Manager**：
  - 执行 **List 操作** 获取所有 `ReplicaSet` 和 `Pod` 的全量数据。
  - 记录当前 `Resource Version`，建立 **Watch 长连接** 监听后续变更。
- **Scheduler**：
  - 执行 **List 操作** 获取所有未调度的 `Pod` 全量数据。
  - 基于 `Resource Version` 建立 **Watch 连接**，持续监听新创建的 `Pod`。
- **Kubelet**：
  - 执行 **List 操作** 获取已分配到本节点的 `Pod` 全量数据。
  - 建立 **Watch 连接**，监听本节点 `Pod` 的创建/更新事件。
#### **阶段 1：用户提交请求**

```bash
# 用户创建 ReplicaSet（隐含 Pod 模板）
$ kubectl apply -f replicaset.yaml
```

#### **阶段 2：API Server 写入 ReplicaSet**

1. **API Server** 接收请求，将 ReplicaSet 定义写入 **etcd**。
2. **触发事件**：生成 `ReplicaSet Added` 事件，广播给监听 `ReplicaSet` 的组件。
#### **阶段 3：Controller Manager 调谐**

1. **Watch 触发**：
   - Controller Manager 的 ReplicaSet 控制器监听到 `ReplicaSet Added` 事件。
   - 对比 `spec.replicas` 和当前 Pod 数量（初始为 0），触发调谐逻辑。
2. **创建 Pod**：
   - 发起创建 Pod 的请求（携带 ReplicaSet 的标签选择器）。
3. **API Server 处理**：
   - 将 Pod 定义写入 etcd（此时 `spec.nodeName` 为空，标记为未调度）。
   - 生成 `Pod Added` 事件。
#### **阶段 4：Scheduler 监听与调度**

1. **Watch 触发**：
   - Scheduler 监听到 `Pod Added` 事件（未调度状态）。
2. **调度决策**：
   - **预选（Filter）**：排除不满足条件的节点（如资源不足）。
   - **优选（Score）**：对候选节点评分（如负载均衡、亲和性）。
3. **绑定节点**：
   - 更新 Pod 的 `spec.nodeName` 为目标节点（如 `node-1`）。
   - API Server 将更新后的 Pod 写入 etcd，生成 `Pod Updated` 事件。
#### 🌟🌟🌟**阶段 5：Kubelet 创建容器**

1. **Watch 触发**：
   - 目标节点（如 `node-1`）的 Kubelet 监听到 `Pod Updated` 事件（`spec.nodeName` 指向自身）。
2. **容器创建流程**：
   - **Step 1：拉取镜像**
     - 检查本地镜像缓存，若缺失则从容器仓库拉取。

   - **Step 2：创建 Pause 容器**
     - 调用容器引擎（如 containerd）创建 Infra/pause 容器，初始化共享网络命名空间（container 模式）。
     - 每个 pod 都有一个 pause 容器

   - **Step 3：配置网络**

     - 调用 CNI 插件（如 Calico）为 Pod 分配 IP，设置网络规则（路由、iptables）。

   - **Step 4：创建业务容器**
     - 以共享网络模式启动业务容器（如 Nginx），挂载存储卷（如有）。

     - `get pods` 只显示业务容器

3. **状态上报**：
   - Kubelet 将 Pod 状态（`Running`）更新至 API Server，写入 etcd。

##### **业务容器完整的生命周期**：

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250412200427018.png" alt="image-20250412200427018" style="zoom: 30%;" align='left'/>

- **Init 容器阶段**

  - **核心机制**：

    - 按**顺序执行** Pod 中定义的 `initContainers`，前一个成功后才会启动下一个。
    - 所有 Init 容器必须成功退出（Exit Code 0），否则 Pod 状态为 `Init:Error`，并触发重启策略（默认 Never 不重启）。

  - **典型场景**：

    - 等待依赖服务就绪（如数据库启动）。
    - 下载配置文件或密钥（如从 Vault 获取敏感信息）。
    - 初始化数据库或数据卷（如执行 `mysql -uroot < init.sql`）。

  - **关键配置**：

    ```yaml
    spec:
      initContainers:
      - name: init-db
        image: busybox
        command: ['sh', '-c', 'until nslookup mysql-service; do sleep 2; done']
        # nslookup：name server lookup，查询 DNS（域名系统）以获取域名或 IP 地址映射或其他 DNS 记录，此处是查询 mysql 服务是否可用
    ```

- **主容器启动阶段**

  > **主容器**：非官方名词，可以理解为**负责主要业务逻辑**的容器，即**业务**容器；而按照 “**一个容器挂掉了，整个Pod的所有容器都挂掉**” 这一维度来理解，**Pause**容器可以被视为“主容器”。

  - ##### **PostStart 钩子**

    钩子函数由 `kubelet` 来触发执行，因为容器是由 `kubelet` 来创建的。

    - **触发时机**：容器启动的同时立即执行（与容器主进程并行，不阻塞启动）。

    - **执行方式**：

      - **Exec**：在容器内执行命令。

        ```yaml
        lifecycle:
          postStart:
            exec:
              command: ["/bin/sh", "-c", "echo Hello > /tmp/start.log"]
        ```

      - **HTTP Get**：向容器 IP 发送 HTTP 请求。

        ```yaml
        lifecycle:
          postStart:
            httpGet:
              path: /init
              port: 8080
        ```

    - **注意事项**：

      - 钩子执行失败会导致容器终止（根据重启策略决定是否重启）。
      - 钩子最长执行时间：默认为 30 秒（可通过 `terminationGracePeriodSeconds` 调整）。

  - **startupProbe**：

    - 在容器启动后对容器健康状态进行监测，判断容器是否启动成功

- **容器运行阶段**

  持续监测

  - **存活探针（livenessProbe）**：（略）
  - **就绪探针（readnessProbe）**：（略）

- **容器终止阶段**

  - ##### **PreStop 钩子**

    在容器终止之前执行

    - **触发时机**：

      - Pod 被删除（手动删除或滚动更新）。
      - 节点资源不足引发驱逐（如内存压力）。
      - 探针连续失败触发重启。

    - **执行方式**：同 PostStart，支持 Exec/HTTP Get。

      ```yaml
      # 在容器退出之前，优雅地关闭Nginx
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "nginx -s quit"]
      ```

    - **关键用途**：

      - 优雅关闭应用（如结束事务、释放连接）。
      - 通知监控系统下线事件。

  - ##### **优雅终止流程**

    1. **触发终止**：发送 SIGTERM 信号。
    2. **执行 PreStop 钩子**（最长 `terminationGracePeriodSeconds`，默认 30 秒）。
    3. **等待钩子完成**：超时后发送 SIGKILL 强制终止。
    4. **清理资源**：删除容器、释放 IP、卸载存储卷。

- **钩子 VS 探针**

  |              | 钩子（Hooks）                       | 探针（Probes）                              |
  | :----------- | :---------------------------------- | ------------------------------------------- |
  | **目的**     | 执行特定操作（初始化/清理）         | 健康检查（判断容器是否存活或就绪）          |
  | **触发时机** | 明确的生命周期事件（启动后/终止前） | 周期性检查（如每 10 秒一次）                |
  | **结果影响** | 失败可能导致容器终止                | 失败触发重启（Liveness）或摘流（Readiness） |
#### **阶段 6：Controller Manager 终态确认**

1. **Watch 触发**：
   - Controller Manager 监听到 Pod 状态变更为 `Running`。
2. **更新 ReplicaSet 状态**：
   - 将 `ReplicaSet.status.availableReplicas` 更新为 1。
   - API Server 写入 etcd，流程闭环。
#### 补充：调谐（Reconciliation）VS 调度（Scheduling）

| 特性     | 调谐（控制器）                                     | 调度（Scheduler）                      |
| -------- | -------------------------------------------------- | -------------------------------------- |
| 作用范围 | 维护所有资源对象的期望状态（Deployment/Service等） | 专责Pod的节点分配                      |
| 触发条件 | 资源状态变化、定时同步                             | 新Pod创建、节点故障等                  |
| 核心机制 | 对比实际状态与spec声明，通过API Server进行修正     | 基于节点资源、亲和性等策略选择最优节点 |
| 典型操作 | 扩缩副本、滚动更新                                 | Bind操作（将Pod绑定到节点）            |
## 三、k8s网络知识储备

### 1. 大二层网络

#### **1.1 核心概念**

- **定义**：
  大二层（数据链路层）网络将所有 k8s 节点上的 Pod 逻辑上置于同一个二层网络（同一广播域），确保 Pod 可直接通过 MAC 地址通信。
- **目的**：
  支持 Pod 跨节点自由漂移，无需复杂路由配置。

> **二层通信**
>
> ```mermaid
> graph LR
>     A[主机A] -->|广播ARP请求| B[目标IP的MAC?]
>     B -->|单播响应| C[主机B的MAC]
>     A -->|目标MAC=B_MAC| D[发送数据帧]
> ```
>
> - **依赖广播域（Broadcast Domain）**：所有设备需在同一逻辑二层网络（如交换机连接）。
> - **无路由介入**：不涉及 IP 地址和路由器决策。
>
> **三层通信**
>
> ```mermaid
> graph LR
>     A[源主机] -->|发送IP包| R1[路由器]
>     R1 -->|查路由表| R2[下一跳]
>     R2 -->|最终跳| B[目标主机]
> ```
>
> - **跨子网能力**：通过路由器连接不同二层网络。
> - **依赖路由协议**：使用路由表（Routing Table）决策转发路径。
>
> - **关键流程**：
>
>   以主机 `192.168.1.10` → 目标 `10.1.2.20` 跨网段通信为例：
>
>   **步骤1：判断目标网络**
>
>   - 源主机对比自身子网掩码：
>
>     ```
>     192.168.1.10/24 ≠ 10.1.2.20/24 → 需经网关
>     ```
>
>   **步骤2：发送至默认网关**
>
>   - **ARP 查询网关 MAC**
>
>   - 构造 **以太网帧**：
>
>     ```
>     外层DST_MAC: 网关MAC  
>     内层DST_IP: 10.1.2.20  
>     ```
>
>   **步骤3：路由器逐跳转发**
>
>   每台路由器：
>
>   1. 解封装以太网帧
>
>   2. 根据 **目标IP查路由表**
>
>      ```
>      $ ip route show
>      10.1.2.0/24 via 172.16.1.1 dev eth1
>      ```
>
>   3. 重新封装帧（更新源/目标MAC）
>
>   **步骤4：到达目标网络**
>
>   - 末跳路由器 **ARP 查询目标主机 MAC**
>   - 直连发送至目标

#### **1.2 构建方式**

- **核心组件**：
  - **虚拟交换机**：如 `cni0` 网桥（节点内部 Pod 互联）。
  - **物理网络**：底层支持二层或三层网络（如物理交换机、VXLAN 隧道）。
- **关键特性**：
  1. 由虚拟设备（cni0）和物理设备共同组成逻辑大交换机。
  2. 节点启动时自动建立基础大二层网络。
  3. 用户创建的每个网络（如多租户网络）会被分配唯一的段 ID（如 VXLAN VNI）。

#### **1.3 二层隔离实现对比**

| **场景**     | **Kubernetes**                    | **云平台**                       |
| :----------- | :-------------------------------- | :------------------------------- |
| **隔离需求** | 不同命名空间的 Pod 需要隔离       | 不同租户的云主机需要隔离         |
| **实现方式** | 基于**命名空间**（NetworkPolicy） | VLAN/VXLAN 划分虚拟局域网        |
| **典型问题** | 依赖网络策略而非二层隔离          | VLAN ID 限制（最多 4096，12bit） |
### 2. **协议封装技术**

[在容器技术核心基础的网络模式部分有涉及](C:\Users\Lenovo\桌面\SRE\技术相关\Docker\容器技术\01 容器技术核心基础.md)

#### **2.1 VLAN 模式**

- **原理**：
  通过 VLAN ID 划分虚拟局域网，不同租户的机器隔离在不同 VLAN。
- **问题**：
  1. 物理网络必须支持二层（灵活性差）。
  2. VLAN ID 上限 4096，限制网络规模。

#### **2.2 GRE 隧道**（已逐渐被VXLAN替代）

- **封装结构**：
  - **Delivery 头**：IP 协议（外层 IP 地址）。
  - **GRE 头**：GRE ID（类似 VLAN ID）。
    - **封包解包设备**：br-tun设备
  - **Payload**：原始数据帧。
- **缺点**：
  - 需维护全量节点隧道关系（N² 复杂度）。
    - GRE是一种 **点对点隧道协议**，每个节点需要与其他所有节点建立独立的隧道连接。
  - 广播流量无法组播，效率低。
    - 广播流量（如 ARP 请求）必须通过 **单播复制** 发送到所有节点
      - **带宽浪费**：同一广播包被多次复制传输。（发送N次）
      - **处理延迟**：节点需逐个处理广播包，无法并行化。
      - **广播风暴风险**：大规模集群中广播流量指数级增长。
  - 集群规模大的情况下，GRE效率会变得非常低
  - 需手动管理隧道端点（IP 地址）

#### **2.3 VXLAN 隧道**（云平台常用）

- **封装结构**：

  - **Delivery 头**：UDP 协议（外层 IP + 端口8472）。
  - **VXLAN 头**：VNI（24 位，支持 1600 万虚拟网络）。
    - **封包解包设备**：VTEP设备（对应k8s中每个节点上的flannel.1）
  - **Payload**：原始数据帧。

- **数据流向**

  <img src="C:\Users\Lenovo\AppData\Roaming\Typora\typora-user-images\image-20250412230908221.png" alt="image-20250412230908221" style="zoom:33%;" align='left'/>

- **优势**：
  - **组播支持**：新节点自动加入组播组，广播流量高效分发。
    - 一次发送 \+ 网络设备智能复制 ——> 广播流量大幅度降低
    
    > - **VXLAN协议层**：支持单播（基础）和组播（RFC可选方案），但**组播已被现代实现淘汰**
    > - **最佳实践**：
    >   - 无论物理网络是否支持组播，生产环境均采用 **头端复制单播**（Head-end Replication）
    >   - 通过控制平面（Flannel/etcd, Calico/BGP, EVPN）**主动同步节点信息**（预先填充FDB表），规避泛洪
    > - **云环境强制约束**：公有云完全禁用组播，必须100%依赖单播方案
    > - **未来方向**：
    >   - **BGP EVPN 已成为控制平面标准**（数据中心场景）
    >   - 分布式键值存储（如 etcd）是轻量化方案（K8s网络插件常用）
    
  - **无状态传输**：基于 UDP，无需维护隧道状态。
  
  - **自动化管理**：通常由编排工具（如 Docker Swarm、Kubernetes CNI）自动配置。
  
- **Flannel 实现细节**（k8s）：
  
  - **VTEP 设备**：`flannel.1`（负责封包/解包）。可通过 `ip a` 查看
  
  - **VNI 固定为 1**：所有集群节点使用同一个虚拟网络。租户隔离需配置不同的 VNI（如多租户集群）
  
  - **静态 MAC 分配**：由 `flanneld` （进程）维护，避免 ARP 广播。
  
    ```sh
    # 查看arp表
    ip neighbor
    # 会显示所有节点都有一个静态MAC（PERMANENT）
    ```

#### 2.4 **VXLAN vs VLAN**

| **特性**     | **VXLAN**             | **VLAN**               |
| :----------- | :-------------------- | :--------------------- |
| **隔离标识** | VNI（24 位，1600 万） | VLAN ID（12 位，4096） |
| **封装协议** | UDP（IP 协议 17）     | 以太网帧头（802.1Q）   |
| **网络要求** | 支持三层网络          | 要求二层网络           |
| **适用场景** | 大规模云环境          | 小型本地集群           |
### 3. CIDR与子网划分

CIDR 规划在线工具：[子网划分计算器](https://www.itwenda.com/tools/ziwang.html)

#### **3.1 k8s 网络划分原则**

- **核心要求**：
  1. **IP 唯一性**：每个 Pod 拥有唯一 IP（大二层网络无 NAT）。 
  2. **节点标识性**：Pod IP 可反映所属节点（简化路由）。

#### **3.2 子网划分策略**

- **初始配置**：
  指定全局 Pod 网段（如 `10.244.0.0/16`）。
- **节点子网分配**：
  - **掩码长度**：通常为 `/24`（如 `10.244.1.0/24`）。
  - **容量计算**：每个节点最多 254 个 Pod（`2^(32-24) - 2`）。但是实际上k8s建议最多110个。
- **规模限制**：
  - **节点数上限**：`2^(24-16) = 256` 个节点（若初始网段为 `/16`）。
  - **示例**：`10.244.0.0/16` 划分为 256 个 `/24` 子网，支持 256 个节点（一个节点一个子网）。

#### **3.3 子网划分的实际影响**

| **特性**       | **说明**                                                     |
| :------------- | :----------------------------------------------------------- |
| **IP 标识性**  | Pod IP 前两段（如 `10.244.1.x`）标识节点，即可以直接确定该 pod 属于哪台物理机，简化路由决策，提供发包效率（类似于点对点，但优于GRE 单播复制） |
| **跨子网通信** | 不同节点子网的 Pod 仍可直接二层通信（大二层网络特性）。      |
| **扩展性限制** | `/16` + `/24` 划分限制集群规模为 256 节点（需调整初始网段如 `/12`）。 |

> 为什么pod子网划分后，不同节点子网的 Pod 仍可直接二层通信？
>
> 首先要明确一点，pod子网划分仅仅是为了让节点具有标识性。
>
> Pod 子网是一个逻辑覆盖网络（如 `10.244.0.0/16`），与底层节点物理子网（如 `192.168.1.0/24`）解耦，通过 **VXLAN/IP-in-IP 隧道封装** 或 **BGP 路由协议** 穿透物理网络隔离。经底层网络传输到目标节点后解封装，使 Pod 感知不到跨子网的存在；同时通过 ARP 代理（当 Pod 发送 ARP 请求时，节点（或 CNI 插件）代理响应，返回目标 Pod 所在节点的 MAC 地址）和虚拟网络设备（覆盖网络（如 VXLAN）通过虚拟隧道扩展了二层广播域，使跨子网的 Pod 能感知彼此），Pod 误认为彼此处于同一广播域。这种设计使得不同物理子网的节点间 Pod 流量能够透明转发，实现逻辑上的二层直连通信。

#### **3.4 示例：Flannel 网络配置**

```yaml
# flanneld 配置示例（kube-flannel.yml）
net-conf.json: |
  {
    "Network": "10.244.0.0/16",
    "Backend": {
      "Type": "vxlan",
      "VNI": 1,	# 所有集群节点使用同一个虚拟网络。租户隔离需配置不同的 VNI（如多租户集群）
      "Port": 8472
    }
  }
```
## 四、k8s网络架构

### 1. 核心需求
- **所有Pod跨节点直接通信**（大二层网络）
- 每个Pod拥有唯一IP地址（IP-per-Pod模型）
- 支持网络策略（Network Policies）

### 2. 网络模型实现

一些用于系统服务的Pod使用的是host网络模式，与宿主机共享网络

#### （1）Flannel插件
##### a.🌟🌟🌟 VxLAN模式
- **架构组件**：

  - `cni0`：节点网桥（相当于一个二层交换机），连接Pod的veth pair

  - `flannel.1`：VTEP设备，处理VXLAN封/解包

  - `veth对`：由CNI插件创建

    ```sh
    # Pod内查看eth0关联的veth设备（获取 eth0 接口的 iflink 值）
    # iflink：逻辑上连接在一起的接口（比如 veth pair）会共享相同的 iflink 值
    cat /sys/class/net/eth0/iflink
    
    # 宿主机上查看cni0关联的veth设备
    # 会列出所有网络接口，如果某个 veth 接口的 iflink 值与 pod 内 eth0 的 iflink 值相同，那么这两个接口就是一对 veth 接口
    bridge link show
    ```

- **三张核心表**：

  ```mermaid
  sequenceDiagram
      PodA->>NodeA VTEP: 发往PodB IP
      NodeA VTEP->>ARP表: 查询PodB网段→VTEP_B_MAC
      NodeA VTEP->>FDB表: VTEP_B_MAC→NodeB_IP
      NodeA VTEP->>封装: 构造内层帧: DST_MAC=VTEP_B_MAC
      NodeA VTEP->>物理网络: 发送至NodeB_IP
      NodeB VTEP->>解封: 提取内层帧
      NodeB VTEP->>PodB: 根据DST_MAC转发
  ```

  >  `eth0` 在发送时会 **独立进行ARP查询**（解析网关或目标物理IP的MAC），与VXLAN的ARP表无关，故外层MAC地址由主机物理网络协议栈处理，不依赖 `flannel.1` 的ARP表

  由`flanneld`进程动态维护（从 etcd 获取集群 Pod 网络信息）：

  1. **路由表（Route Table）**

     - **作用**：决定数据包的转发路径。

     - **规则**：

       - 本地 Pod 网段流量（如 `10.244.0.1/24`）直接通过 `cni0` 网桥转发。
       - 跨节点 Pod 网段流量（如 `10.244.1.1/24`）交给 `flannel.1` 设备处理。

       > `10.244.0.1/24`等节点的逻辑网段地址，是一个**逻辑标记**，代表整个目标节点的Pod网络（非具体设备IP）

     - **查看方式**：`route -n`（`-n`：不进行主机名解析）

       ```
       $ route -n
       Destination     Gateway         Genmask         Flags Metric Ref Use Iface
       10.244.0.0      0.0.0.0         255.255.255.0   U     0      0     0 cni0      # 本地 Pod 网段
       10.244.0.1      10.244.0.0      255.255.255.0   UG    0      0     0 flannel.1  # 目标为 Node1 的 Pod 网段
       ```

  2. **ARP 表（Address Resolution Protocol Table）**

     - **作用**：

       - 解析目标 Pod 所在节点的 `flannel.1` 设备的 MAC 地址，用于封装**内层 Original L2 Frame**。

       - 处理**虚拟网络层的身份映射**（网段→MAC）

     - **特点**：条目是静态的（永久不过期），避免频繁 ARP 请求。

     - **查看方式**：`ip neigh show`

       ```
       10.244.1.0 dev flannel.1 lladdr 56:8c:12:0d:3a:9f PERMANENT	# 目标为 Node1 的 flannel.1 设备的 MAC 地址
       ```

  3. **FDB 表（Forwarding Database Table）**

     - **作用**：

       - 根据目标节点的  `flannel.1` 的 MAC 地址，找到目标节点的宿主机 IP 地址，用于封装**外层 Outer IP Header**。

       - 处理**底层物理网络的寻址**（虚拟 MAC→物理IP）
     
     - **查看方式**：`bridge fdb show dev flannel.1`
     
       ```
       56:8c:12:0d:3a:9f dst 192.168.50.3 self permanent
       ```
     
     > 已知虚拟MAC → 获得物理IP的实现流程：
     >
     > 1. **注册上报（控制平面）**
     >
     >    - 每个节点启动时：
     >      - 生成唯一的 **虚拟 VTEP MAC**（如 `56:8c:12:0d:3a:9f`）
     >      - 将 **物理 IP + VTEP MAC** 注册到 etcd/K8s API。
     >
     > 2. **动态学习（控制平面）**
     >
     >    - `flanneld` 进程监听存储变更：
     >      - 发现新节点时（如物理 IP `192.168.50.3` + MAC `56:8c:...`）
     >      - 调用 **Linux Netlink 接口**，写入本地内核。
     >
     > 3. **内核写入 FDB 表（数据平面）**
     >
     >    ```
     >    bridge fdb add 56:8c:12:0d:3a:9f dst 192.168.50.3 dev flannel.1
     >    ```
     >
     >    - 生成永久静态表项：
     >      ​**​虚拟 MAC → 物理 IP​**​ 的映射关系。

- **通信流程**：

  - **同节点**：通过cni0网桥直接转发

    <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250412003356309.png" alt="image-20250412003356309" style="zoom: 33%;" align='left'/>

    1. 源Pod发送数据包至其eth0接口
    2. 数据包通过veth对传输到其在cni0网桥对应的接口
    3. cni0网桥将数据包发送到宿主机的网络命名空间
    4. 宿主机路由表判断为同网段通信
       - 路由判决：`route -n`
         - 如果是同网段，直接交给cni0来转发（二层通信），不需要封包（在当前节点的两个pod通信）	
         - 如果不同网段，则交给flannel.1设备来处理，需要封装vxlan协议包（跨节点的两个pod通信）
    5. 数据包由cni0网桥直接二层转发至目标pod在cni0的接口，无需VXLAN封装
    6. 目标Pod通过其veth对接收数据包

  - **跨节点**：

    <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250412003413210.png" alt="image-20250412003413210" style="zoom:33%;" align='left'/>

    1. 查路由表指向flannel.1
    2. ARP表获取目标VTEP MAC
    3. FDB表获取目标节点IP
    4. 封装VxLAN包（外层UDP+内层原始帧）

- **优缺点**：

  - **优点**：
    - 允许物理网络架构可以是二层也可以是三层；通用性强
      - ✅ **三层网络**：通过路由器转发（经多个三层跳点）
        - 路由器根据目标 IP (`NodeB_IP`) 路由转发
      - ✅ **二层网络**：直连交换机转发（单广播域）
        - VTEP 之间通过 MAC 地址直连（交换机学习 MAC 表）
      - **VXLAN 将物理网络降级为单纯的 IP 传输管道**，只要 VTEP 端点之间能通过 IP 通信（无论中间经过多少路由器），就能建立虚拟大二层网络。
    
  - **缺点**：
    - 在集群规模较大时，VXLAN的转发效率相对较低
      - VXLAN封装和解封装过程带来额会外开销
      - 大规模网络中的广播和组播管理复杂性


##### b. Host-GW模式（了解即可）
- **核心机制**：
  - 节点作为网关，通过路由表直接转发
  - 宿主机之间必须二层连通（即宿主机在同一局域网或 VLAN 中）
    - 路由表中下一跳的宿主机 IP 需要能通过 **ARP 协议解析 MAC 地址**，而 ARP 仅在二层网络中有效。

- **通信流程**：

  - 同节点内的通信流程同Vxlan

  - **Pod A → Pod B（跨节点）**：

    <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250414162609761.png" alt="image-20250414162609761" style="zoom:33%;" align = 'left'/>

    1. Pod A 发送数据包到目标 Pod B 的 IP。
    2. 源宿主机路由表匹配到目标 Pod 网段，将下一跳指向目标宿主机的 IP。
    3. 通过二层网络直接转发到目标宿主机（无需封装）。
    4. 目标宿主机通过 `cni0` 网桥将数据包传递给 Pod B。

- **配置方法**：

  1. **修改 Flannel 配置**

     - 修改 `kube-flannel` ConfigMap，将 `Backend.Type` 设置为 `host-gw`：

       ```yaml
       apiVersion: v1
       kind: ConfigMap
       metadata:
         name: kube-flannel-cfg
         namespace: kube-flannel
       data:
         net-conf.json: |
           {
             "Network": "10.244.0.0/16",
             "Backend": {
               "Type": "host-gw"  # 修改为 host-gw
             }
           }
       ```

     - **重启 Flannel Pod**：

       ```bash
       kubectl rollout restart daemonset/kube-flannel-ds -n kube-flannel
       ```

  2. **部署时指定模式**

     - 在初始部署 Flannel 时，直接配置 `net-conf.json` 中的 `Backend.Type` 为 `host-gw`（参考 [kube-flannel.yml](https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml)）。

- **优缺点**：

  - **优点**：
    - **高性能**：无隧道封装开销，转发路径更短。集群规模大的情况下，转发效率更高。
    -  **配置简单**：仅依赖路由表维护。

  - **缺点**：
    - **依赖二层网络**：宿主机需在同一二层网络。（灵活性差）
    - **云平台限制**：部分云厂商禁止自定义路由条目。


#### （2）Calico插件
##### a.🌟🌟🌟 BGP模式

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250412003512348.png" alt="image-20250412003512348" style="zoom:33%;" align='left'/>

- **核心原理**：

  通过将宿主机视为**路由器**，利用 **BGP 协议**自动交换路由信息，实现跨节点 Pod 通信。

  - **核心思想**：
    - 宿主机之间通过 BGP 协议广播本机 Pod 子网的路由信息（Pod 子网和宿主机 IP 映射），动态维护路由表。
    - **无中心化数据库**：路由信息由节点间直接同步，不依赖 etcd 或中心存储。

- **关键组件及作用**

  <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250414165342135.png" alt="image-20250414165342135" style="zoom: 30%;" />

  1. **CNI 插件**
     - **功能**：为 Pod 创建 `veth pair`，一端在 Pod 网络命名空间（`eth0`），另一端连接到宿主机网络。
     - **作用**：打通 Pod 与宿主机的网络通道。
  2. **Felix（守护进程）**
     - **部署方式**：以 `DaemonSet` 运行在每台宿主机上。
     - **核心职责**：
       - 维护宿主机路由表（写入 Linux 内核的 FIB【网络设备（如路由器）中用于快速转发数据包的关键数据结构】转发信息库）。
       - 管理网络设备（如创建路由规则、ACL 策略）。
       - 监控节点状态并同步路由信息。
  3. **BIRD（BGP 客户端）**
     - **功能**：
       - 读取 Felix 写入内核的路由信息。
       - 通过 **BGP 协议**将路由广播给其他宿主机（BGP Peer）。
       - 学习其他节点的路由信息并更新本地路由表。
     - **作用**：实现路由信息的分布式同步，替代中心化存储（如 etcd）。

- **通信流程**

  - **同节点**
    - **ARP 解析与路由查询**
      - Pod A 发送数据包到 Pod B。
      - Pod A 的网络命名空间通过本地路由表查询，发现目标 IP 属于同一节点上的另一个 Pod。
      - 通过 ARP 解析获取 Pod B 的 MAC 地址（如果未缓存）。
    - **本地 veth 转发**
      - Pod A 和 Pod B 通过各自的 `veth pair` 连接到节点的根命名空间（root namespace）。
      - 数据包通过 `veth pair` 直接转发到 Pod B 的虚拟网卡，无需经过物理网卡或 BGP 路由。
    - **内核路由与转发**
      - Linux 内核根据本地路由表和 ARP 表完成二层转发，流量不离开节点。
  - **不同节点**
    - **路由学习阶段（BGP 路由分发）**
      - **节点注册路由**
        每个节点上的 Calico BGP 客户端（如 BIRD）将本节点 Pod 的 CIDR 块（如 `10.244.1.0/24`）通过 BGP 协议宣告给其他节点。
        - 若**集群规模较小**，采用 **全互联模式（Node-to-Node Mesh）**：每个节点与所有其他节点建立 BGP 对等体
          - 每个节点与其他所有节点建立 BGP 连接（一对一互联）。
          - 每个节点向所有邻居节点宣告本节点的 Pod CIDR 路由。
          - 所有节点通过 BGP 协议（通过交换网络可达性信息（如路径列表）来决定最佳路径）同步集群内的全局路由表。
          - 若集群有 **N 个节点**，总连接数为 **N × (N-1)/2**（每对节点间一条连接）。
        - 若**集群规模较大**，采用 **路由反射器（Route Reflector）**：指定少数节点作为路由反射器（RR），其他节点仅与 RR 建立 BGP 连接，由 RR 集中代理路由分发。
          - RR 负责收集集群内所有节点的路由信息，并反射（转发）给其他节点。
          - 若集群有 **N 个节点** 和 **R 个路由反射器**，总连接数为 **N × R**。
      - **路由表同步**
        所有节点通过 BGP 学习到集群内其他节点的 Pod CIDR 路由，并将这些路由写入本地 Linux 路由表。
    - **数据包转发阶段**
      - **Pod A 发起请求**
        Pod A（节点 Node1）发送数据包到 Pod B（节点 Node2）。
      - **源节点路由查询**
        - Pod A 的流量通过 `veth pair` 进入 Node1 的根命名空间。
        - Node1 查询本地路由表，发现目标 IP（Pod B）属于 Node2 的 Pod CIDR（如 `10.244.2.0/24`）。
        - 路由表指示下一跳为 Node2 的物理 IP（如 `192.168.1.2`）。
      - **跨节点物理网络传输**
        - Node1 通过物理网卡（如 `eth0`）将数据包发送到 Node2 的物理 IP。
        - 底层网络（如数据中心交换机）根据三层路由将数据包传递到 Node2。
      - **目标节点处理**
        - Node2 收到数据包后，查询本地路由表，发现目标 IP 属于本节点的 Pod CIDR。
        - 流量通过 `veth pair` 转发到 Pod B 的虚拟网卡。

- **优缺点**

  | **优点**                                      | **缺点**                                                     |
  | :-------------------------------------------- | :----------------------------------------------------------- |
  | 1. **高性能**：无隧道封装开销，直接路由转发。 | 1.**Calico 纯 BGP 模式要求物理网络支持 BGP 路由协议**，否则需启用 IPIP 隧道或依赖二层连通性。 |
  | 2. **大规模支持**：BGP 协议适合大型集群。     | 2. **云平台限制**：部分云厂商限制 BGP 会话。                 |
  | 3. **去中心化**：无需 etcd，扩展性强。        | 3. **维护成本高**：需专业网络知识管理 BGP 对等。             |

  > **BGP 协议本身是纯三层路由协议**，其运作不依赖二层网络，仅需宿主机之间**三层 IP 可达**（例如通过路由器互联）

- **VS Host-GW**：

  | **特性**         | **Host-GW 模式（Flannel）**                 | **BGP 模式（Calico）**                              |
  | :--------------- | :------------------------------------------ | :-------------------------------------------------- |
  | **路由维护方式** | `flanneld` 从 etcd 获取信息，静态维护路由表 | BGP 协议动态交换路由信息，无中心化依赖              |
  | **网络设备**     | 依赖 `cni0` 网桥                            | 不创建 `cni0`，直接通过宿主机路由转发，转发效率更高 |
  | **适用毁灭**     | 中小规模集群                                | 超大规模集群（如千节点以上）                        |

##### b. IPIP隧道模式（了解即可）

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250412003616766.png" alt="image-20250412003616766" style="zoom:33%;" align='left'/>

- **核心原理**：

  - 协议封装

    - 工具：tunl0设备

    - 在原始IP包外添加新IP头（协议号4）

      <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250414202239435.png" alt="image-20250414202239435" style="zoom:15%;" align='left'>

- **特点**：

  - 可跨三层网络
  - 性能略优于VXLAN
  - 但维护成本较高
