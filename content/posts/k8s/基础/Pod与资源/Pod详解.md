---
title: "Pod详解"
draft: false
tags: ["k8s", "基础", "Pod与资源"]
---

## 一、Pod介绍
### 1. Pod是什么
- **定义**：k8s中的最小工作单元，封装一个或多个容器

### 2. 为何使用Pod

- **特点**：
  - 屏蔽底层不同容器的差异化
  - 同一Pod内容器共享网络和存储卷
    - **共享网络**：同一Pod内容器通过localhost通信
    - **共享存储**：共享Volume卷实现数据持久化

### 3. Pod分类
#### (1) 普通Pod

创建 Pod 的请求是提交给 API Server的

| 类型               | 特点                                                        | 自愈能力          |
| ------------------ | ----------------------------------------------------------- | ----------------- |
| 自主式Pod（裸Pod） | （1）资源清单里指定的kind就是Pod<br />（2）无控制器资源管理 | 弱（仅容器重启）  |
| 控制器资源管理Pod  | 由Deployment/ReplicaSet等管理                               | 强（自动重建Pod） |

#### (2) 静态Pod
- **创建方式**：直接由kubelet通过配置文件/HTTP创建
- **特点**：绕过API Server，无etcd存储记录
## 二、Pod创建流程
[涉及Pod创建流程（含4-7较完整内容）]({{< relref "/posts/k8s/基础/网络/Kubernetes网络.md" >}})

**重点：Kubelet 创建容器部分**
## 三、Pod常见状态解析

Pod的状态实际上是Pause容器的状态

| 状态                | 触发场景                                        | 关键说明                                                     |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| `Pending`           | 调度中/镜像下载中                               | 节点资源不足时常见                                           |
| `Init:Error`        | Init容器执行失败                                |                                                              |
| `ContainerCreating` | 创建容器中（拉取镜像、挂载存储卷）              |                                                              |
| `ImagePullBackOff`  | 镜像拉取失败                                    | 检查镜像名称/权限                                            |
| `Completed`         | 容器正常退出                                    | 常见于Job类Pod                                               |
| `Unknown`           | 节点通信异常（NotReady），无法获取Pod状态       | 可能的异常原因：<br />（1）网络出问题；<br />（2）kubelet挂掉了，无法上报Pod状态<br />（3）节点宕机 |
| `Evicted`           | 节点资源（不可压缩资源）不足导致该Pod被**驱逐** | 需检查节点内存/磁盘                                          |
| `OOMKilled`         | 内存超限                                        | 属于k8s级别的OOM：针对某个 Pod，该 Pod 内的容器对内存的使用达到了 limits 的限定<br />需调整memory limits |
| `Terminating`       | 删除/终止进行中                                 | Pod 删除/终止流程：执行PreStop钩子 -> 终止进程（kill -15） -> 清理etcd记录 |

**总结**：

- Pod状态可用于**故障排查**
  - Pod状态字面上具有错误提示作用
  - Pod状态若长时间未流转至下一状态说明可能出现了异常

## 四、Pod重启策略

- **Always** ：容器**退出即重启**，无论退出状态是什么
- **OnFailure**：容器**异常退出**（状态码非0）时重启
- **Never**：无论容器以说明状态退出，**都不会重启**，依赖上层控制器处理失败。

| Pod类型                                          | 允许策略                                                     | 默认值 | 典型场景               |
| ------------------------------------------------ | ------------------------------------------------------------ | ------ | ---------------------- |
| `ReplicaSet`、`Deployment`、`DaemonSet`管理的Pod | Always<br />（因为它们希望Pod能一直运行）                    | Always | Deployment长期运行服务 |
| Job（一次性任务）类Pod                           | OnFailure/Never                                              | -      | 批处理任务             |
| 静态Pod                                          | 不允许设置<br />（因为静态Pod的固定策略是：只要 `Kubelet` 挂掉都会自动重启静态Pod） | -      | -                      |
| 裸Pod                                            | Always/OnFailure/Never                                       | Always | 测试环境使用           |
## 五、Pause容器

Pause容器挂掉了，整个Pod都会挂掉

### 1. 核心功能
- **共享网络**：所有容器共用同一IP和端口空间，可通过`localhost`直接通信
- **共享存储**：Volume挂载与 `container` 同级别（资源清单），由pause容器维护，容器间共享数据
- **僵尸进程回收**：作为PID 1进程，负责回收子进程。

### 2. sidecar模式应用

**sidecar设计模式**：

- 在主服务/容器旁边运行一个辅助服务/容器（Sidecar，边车），实现功能解耦与职责分离。
- Sidecar与主服务/容器共享相同的生命周期和资源环境，但承担不同的职责。

| 场景     | 实现方式                                                     |
| -------- | ------------------------------------------------------------ |
| 日志收集 | Sidecar容器通过与主容器共享Volume，收集各容器日志文件        |
| 流量染色 | Sidecar容器（如Envoy代理）通过与主容器共享网络，拦截进出流量，实现请求头标记 |

> 请求头标记可以实现流量分类，用于A/B测试、灰度发布或环境区分
## 六、Init容器
### 1. 核心特点

#### 1.1 启动时机

- **前置初始化**：在 `containers` 定义的业务容器启动**之前**启动，且必须完成所有初始化操作
- **顺序控制**：确保业务容器启动时，依赖环境（如网络、存储、服务）已就绪

#### 1.2 执行机制

| 特性                                    | 说明                                                         |
| :-------------------------------------- | :----------------------------------------------------------- |
| **单次执行**                            | 整个Pod生命周期中仅运行一次（除非Pod被重建）                 |
| **串行运行**                            | 多个Init容器按定义顺序**依次执行**，前一个成功后才启动下一个 |
| **镜像更新影响**（针对裸Pod，了解即可） | - 更新业务容器镜像：会重启业务容器，但不触发Pod重启，不重新执行Init容器<br />- 更新Init容器镜像：不触发Pod重启 |

> 如果是控制器资源管理的容器，更新业务/init容器镜像会重启Pod，那么init容器也会重新执行

#### 1.3 失败处理

- **重启策略**：运行失败时，依据Pod的 `restartPolicy` 决定是否重启
- **阻塞效应**：任意Init容器失败会导致整个Pod初始化终止

### 2. 典型场景

- **依赖检查**：验证数据库或API服务是否就绪。
- **配置初始化**：生成配置文件或下载密钥。
- **数据预加载**：从远程存储同步数据到Volume。
## 七、Hook钩子函数

以下两种钩子函数通常都是较简单的操作，可以同时存在于一张资源清单。

### 1. PostStart
- **触发时机**：与业务容器**同时启动**，异步运行
- **典型用途**：动态配置加载、服务注册
- **失败影响**：杀死容器并依据Pod重启策略处理
- **VS init容器**：
  - 选用init容器：**关键**前置条件检查、数据初始化，业务容器的运行强依赖于这些初始u啊
  - 选用PostStart：**非关键**初始化、服务注册等辅助操作（对业务容器的运行不是必需的，不会直接影响业务容器的启动），一般是为了第三方程序做准备，这些操作通常耗时较少，且较轻量


### 2. PreStop
- **触发时机**：容器终止前**必须完成**
- **典型用途**：
  
  - 优雅关闭（发送SIGTERM信号）
  - 资源释放（断开外部连接）
  
    ```sh
    # 以下强制删除命令，只是清理掉该资源在 etcd 中数据，并没有终止容器进程
    kubectl delete --force --grace-period=0 # grace:优雅
    ```
- **超时机制**：默认30秒后强制终止（发送SIGKILL信号）

  - 若超时后一直处于`Terminating`状态，可能是目标节点的`kubelet`挂掉了，可尝试重启`Kubelet`


### 3. 执行方式

- **Exec**：

  - 在容器内执行命令。（该命令消耗的资源会被计入容器的资源使用）

    - 这些命令源自业务容器的镜像

  - **使用场景**：动态配置加载、执行内部清理脚本等。

  - **以PostStart为例**：

    ```yaml
    # 在spec.containers下
    lifecycle:
      postStart:
        exec:
          command: ["/bin/sh", "-c", "echo Hello > /tmp/start.log"]
    ```

  - **以PreStop为例**：

    ```yaml
    # 在容器退出之前，优雅地关闭Nginx
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "nginx -s quit"]
    ```

- **HTTP Get**：

  - 向容器上特定的 `IP:端口`（endpoint）发送 HTTP 请求。
  - **使用场景**：通常用于触发容器内的某个HTTP服务或API，以执行特定的操作，如注册服务、更新状态等。
## 八、探针-Pod监控检查
### **1. 探针介绍**

- **什么是探针？**  
  - 探针是 K8s 用于检测容器或容器内服务是否正常运行的机制。通过周期性检查，确保 Pod 的健康状态，并根据结果采取相应操作（如重启、下线等）。


- **为何使用探针？**  
  - **自动维护服务状态**：周期性检测服务健康，自动触发重启或上下线。  


- **探针类型及作用**  

  | 探针类型           | 作用场景                                                     | 失败后果                                     |
  | ------------------ | ------------------------------------------------------------ | -------------------------------------------- |
  | **startupProbe**   | 检测容器是否完成启动（适用于启动时间长的应用）。 成功后才会运行其他探针。 | **连续**（存在失败次数阈值）失败会重启 Pod。 |
  | **livenessProbe**  | **周期性**检测容器是否存活（如死锁、服务僵死）。             | 失败会重启 Pod。                             |
  | **readinessProbe** | **周期性**检测容器是否就绪（如依赖服务未启动）。             | 失败会从 Service 移除Pod。                   |

  > k8s支持自定义就绪探针，以满足某些复杂应用对容器内服务可用状态的判断（内置的就绪检测的三种方式无法满足）

  - **关键区别**：  
    - `startupProbe` 仅在启动阶段运行一次，成功后不再执行。  
    - `livenessProbe` 和 `readinessProbe` 在容器生命周期内周期性执行。
  - **为什么不能用 `livenessProbe` 替代 `startupProbe`**：
    - **`startupProbe` 是启动阶段的“保护盾”**：专为长启动时间设计，避免误杀。
    - **`livenessProbe` 是运行时的“守护者”**：快速发现运行时故障，保障服务可用性。
      - 若仅用 `livenessProbe`，为了容忍长启动时间，将 `livenessProbe` 的任一参数调高，会导致运行时检测延迟，故障恢复时间变长
    - **两者分工协作**：`startupProbe` 成功后，`livenessProbe` 以更严格的策略接管检测，实现最佳平衡。
### **2. 探针检测方式**  

#### **2.1 Exec（执行命令）**  
- **原理**：在容器内执行命令，根据退出状态码（`$?`）判断健康（0 为成功，非 0 为失败）。  
- **示例配置**：  
  ```yaml
  # 在spec.containers下
  livenessProbe:
    exec:
      command:
        - cat
        - /tmp/healthy  # 检测文件是否存在
    initialDelaySeconds: 5  # 首次检测等待时间
    periodSeconds: 5        # 检测间隔（执行完后再间隔5s再执行，执行时间并没有被计入）
    failureThreshold: 3     # 连续失败 3 次才视为失败
  ```
  - **应用场景**：容器启动后创建 `/tmp/healthy`，30 秒后删除。探针检测到文件不存在时触发重启。
#### **2.2 HTTP Get（HTTP 请求）**  
- **原理**：向容器发送 HTTP 请求，状态码在 200-399 之间视为成功。  
- **示例配置**：  
  
  ```yaml
  livenessProbe:
    httpGet:
      path: /index.html
      port: 80
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 1  # 失败 1 次即重启
  ```
  - **失败场景**：若路径 `/index.html1` 不存在，Nginx 返回 404，触发重启。
#### **2.3 TCP Socket（端口探测）**  
- **原理**：尝试与容器指定端口建立 TCP 连接，成功建立视为健康。  
- **示例配置**：  
  ```yaml
  livenessProbe:
    tcpSocket:
      port: 80
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 3  # 连续失败 3 次触发重启
  ```
  - **应用场景**：检测 Web 服务器的 80 端口是否可连接。
#### **2.4 关键参数说明**  

| 参数                  | 说明                                               |
| --------------------- | -------------------------------------------------- |
| `initialDelaySeconds` | 容器启动后等待多久开始第一次探测（避免过早检测）。 |
| `periodSeconds`       | 探测间隔时间（默认 10s）。                         |
| `timeoutSeconds`      | 探测执行超时时间（默认 1s）。                      |
| `successThreshold`    | 连续成功次数视为探测通过（默认 1）。               |
| `failureThreshold`    | 连续失败次数视为探测失败（默认 3）。               |
### **3. 综合配置示例**  

##### **startupProbe + livenessProbe 组合**  
```yaml
spec:
  containers:
    - name: web
      image: nginx:1.18
      startupProbe:  # 应对启动时间长的场景
        httpGet:
          path: /test
          port: 80
        initialDelaySeconds: 5 # 建议设置为最快启动时间，如果某次启动时间刚好是该值，则可以减少等待时间
        failureThreshold: 13  # 尽量设置大点，允许长时间启动（13*10+5=135s，能覆盖整个启动时间可能范围即可）
        periodSeconds: 10
        successThreshold: 1
      livenessProbe:  # 启动后快速检测
        httpGet:
          path: /test
          port: 80
        failureThreshold: 1  # 失败立即重启
        periodSeconds: 10
```

**设计逻辑**：  

- `startupProbe` 允许较长的启动时间（130 秒），避免因启动慢被误杀。  
- `livenessProbe` 在启动成功后，以较短周期快速检测服务状态。

**注意事项**：

- **资源占用**：频繁探测可能增加资源消耗，需合理设置 `periodSeconds`。  
- **失败策略**：`failureThreshold` 需根据业务容忍度调整（如 `livenessProbe` 应快速失败，`startupProbe` 需宽松）。
## **九、资源申请与限制**

### 1. 介绍
#### **1.1 `requests` 与 `limits` 的区别**
- **`requests`（资源请求）**  
  - **作用**：调度器根据 `requests` 的值选择节点（预选阶段），但不实际占用资源。  
  - **特点**：  
    - Pod 可能获得超过 `requests` 的资源（节点资源空闲时）。  
    - 节点资源不足时，Pod 可能无法获得 `requests` 声明的资源。  

- **`limits`（资源限制）**  
  - **作用**：通过底层 `cgroup` 限制容器资源使用上限（硬限制）。  
  - **特点**：  
    - 实际限制容器资源使用，超限时触发不同行为（如 CPU 限频、内存 OOM Kill）。  

```yaml
resources:
  requests:  # 调度参考值
    cpu: "1"
    memory: "1Gi"
  limits:    # 实际资源限制
    cpu: "2"
    memory: "2Gi"
```
#### **1.2 资源范围规则**
```plaintext
requests ≤ limits ≤ 节点可用资源
```
- 若 `requests` 超过节点可用资源，Pod 无法调度（Pending 状态）。  
- 若容器资源使用超过 `limits`，根据资源类型触发不同行为（如 CPU 限频、内存 OOM Kill）。  
#### **1.3 资源类型与超限行为**

| **资源类型**                      | **可压缩性** | **超限行为**                               |
| --------------------------------- | ------------ | ------------------------------------------ |
| **CPU**                           | 可压缩       | 限制使用频率                               |
| **内存**                          | 不可压缩     | 触发 OOM Kill（k8s级别），Pod 被终止并重启 |
| **临时存储（ephemeral-storage）** | 不可压缩     | 写入失败，Pod 可能被驱逐                   |
#### **1.4 资源单位规范**
- **CPU**  
  - `1` = 1 核 CPU，`500m` = 0.5 核（等价于 `0.5`）。  
- **内存**  
  - `1Mi` = 1024 KiB，`1M` = 1000 KB。  
  - 示例：`3Mi` = 3 × 1024² Bytes，`3M` = 3 × 1000² Bytes。  
#### **1.5 扩展资源类型**
```yaml
# 即使不设置requests值，它也默认同limits值保持一致
resources:
  requests:
    cpu: "500m"                        # 请求 0.5 核 CPU
    memory: "256Mi"                    # 请求 256 MiB 内存
    ephemeral-storage: "1Gi"           # 请求临时存储（容器临时文件），重启后数据丢失
    nvidia.com/gpu: "1"                # 请求 GPU 资源
    hugepages-2Mi: "64Mi"              # 请求大页内存（需节点预分配）
    example.com/special-resource: "2"  # 自定义扩展资源
								 	   # 允许为节点上安装的特殊硬件或软件资源自定义资源类型，以在容器中指定这些资源的请求和限制 
  limits:
    cpu: "1"                           # 限制 1 核 CPU
    memory: "512Mi"                    # 内存超限触发 OOM
    ephemeral-storage: "2Gi"           # 临时存储限制
```

> **详解**：
>
> **1. `ephemeral-storage`**
>
> `ephemeral-storag` 主要是针对那些老旧的或第三方开发的，可能没有很好地配置临时文件的存储管理的软件。它们可能会产生大量的日志、缓存或其他临时文件，而且不易修改其行为。通过为这些容器设置ephemeral-storage请求和限制，可以确保它们有足够的临时存储空间，同时防止它们无限制地占用节点磁盘空间。
>
> 而一个设计优良的软件通常会有良好的临时文件管理机制，能够及时清除不再需要的临时文件，从而减少对磁盘空间的占用。在这种情况下，不需要特别设置`ephemeral-storage`请求和限制。
>
> **2. 在k8s中使用gpu**
>
> [联系容器内如何使用gpu]({{< relref "/posts/容器/01 容器技术核心基础.md" >}})
>
> 要使 K8s Pod 中的nvidia.com/gpu资源配置生效，需要在GPU节点上完成以下安装和配置： 
> （1） NVIDIA GPU 驱动程序：宿主机安装驱动程序，使操作系统能够识别和管理GPU。 
>
> （2）NVIDIA Container Runtime：容器安装该runtime，使容器运行时能够使用GPU。 
>
> （3）NVIDIA Device Plugin for Kubernetes（K8s Daemonset）：使 Kubernetes 能够识别、管理和调度 GPU 资源给 Pod。 
>
> 可以通过以下步骤部署 NVIDIA Device Plugin: 使用官方提供的YAML文件部署： `kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.13.0/nvidia-device-plugin.yaml`
>
> 这个 DaemonSet 会在集群中的每个节点上运行，并管理节点上的 GPU 资源，向 k8s API Server 报告这些资源，从而使 k8s 能够识别和分配 GPU 资源。
>
> **3. vgpu**
>
> 单个 Pod 独占整块 GPU，会造成资源浪费，于是出现了虚拟 GPU（vGPU）技术。
>
> vGPU 通过虚拟化技术将物理 GPU 拆分为多个虚拟 GPU（vGPU），供多个 Pod 共享使用，提升资源利用率。不同厂商/社区的方案差异较大，核心围绕 **算力隔离** 和 **显存隔离**。
>
> **4. 大页内存（hugepages）**
>
> [容器内存储备知识部分]({{< relref "/posts/容器/03 容器内存.md" >}})
#### **1.6 多容器资源调度逻辑**
- **调度步骤**：  
  1. 计算 `initContainers` 中所有容器的最大 `requests` 值（记为 **X**）。
     - 因为init容器是顺序执行，执行完一个后会释放资源  
  2. 计算所有常规容器的 `requests` 总和（记为 **Y**）。  
  3. 节点需满足 `max(X, Y) ≤ 节点可用资源`，否则 Pod 无法调度。  

**示例**：  
- `initContainer` 请求 `2Gi` 内存，常规容器总请求 `1.5Gi`。  
- 节点需至少预留 `2Gi` 内存才能调度 Pod。
#### **1.7 QoS 服务质量等级**
| **QoS 等级**   | **触发条件**                                                 | **驱逐优先级**   |
| -------------- | ------------------------------------------------------------ | ---------------- |
| **Guaranteed** | 所有容器均设置 `limits=requests`（且值不为 0）。             | 最高（最后驱逐） |
| **Burstable**  | 至少一个容器设置 `requests` 或 `limits`，且不满足 Guaranteed 条件。 | 中等             |
| **BestEffort** | 所有容器均未设置 `requests` 和 `limits`。                    | 最低（最先驱逐） |

**k8s自动平衡机制**：  

- 节点资源不足时，按 **BestEffort → Burstable → Guaranteed** 顺序驱逐 Pod。  
#### **1.8 底层 cgroup 参数（CPU 资源示例）**


- **`requests` 对应参数**：  
  - `cpu.shares`：在一个控制组目录树下，同一级控制组基于相对值分配 CPU 时间片（如group1和group2属于同一级控制组，group1下该值为1024，group2下该值为4096，则`group1:group2=4:1`，代表在一个5颗cpu的机器上，group1和group2都需要5颗cpu时，实际分配是：group1一颗，group2：3颗，即 `cpu=1000m` 在该场景下对应 `1024`）。  
    - 只有在CPU资源被完全分配完，且存在进一步分配需求时才会生效。
- **`limits` 对应参数**：  
  - `cpu.cfs_period_us` & `cpu.cfs_quota_us`：限制 CPU 使用时间（如 `cpu=1000m` 对应 `100000us` 周期内最多使用 `100000us`）。  
## 十、静态Pod

#### 1. **定义**：

- 由 **kubelet 直接管理** 的 Pod，其生命周期不依赖 K8s 控制平面（如 API Server、Deployment、DaemonSet 等）。
#### 2.  **关键特点**：

1. **独立于控制平面**：
   - 静态 Pod 的创建、更新、删除均由节点上的 `kubelet` 直接处理，**无需通过 API Server**。
   - 不会被控制器（如 Deployment、DaemonSet）关联或管理，也不受其扩缩容策略影响。
   - 通过将 Pod 的 YAML 文件放置在节点特定目录（默认为 `/etc/kubernetes/manifests`），由 `kubelet` 监控该目录并自动创建 Pod。

2. **健康监控与重启机制**：
   - `kubelet` 负责监控静态 Pod 的运行状态。虽然静态 Pod 不依赖控制器，但 `kubelet` 会执行以下操作：
     - 根据 Pod 中定义的 **livenessProbe** 和 **readinessProbe** 进行健康检测（与常规 Pod 一致）。
     - 当容器崩溃或探针失败时，`kubelet` 会自动重启 Pod。
   - **注意**：静态 Pod 的故障恢复仅由 `kubelet` 处理，缺乏控制器的高级恢复机制（如跨节点调度）。

3. **节点绑定特性**：
   - 静态 Pod **始终运行在配置所在的节点**，不会被调度到其他节点。
   - 原因：Pod 的 YAML 文件仅存在于当前节点的特定目录，其他节点的 `kubelet` 无法感知其存在。

4. **状态可见性与删除逻辑**：
   - **状态查看**：静态 Pod 的状态可通过 `kubectl get pods` 查看，但实际是 `kubelet` 向 API Server 注册的“镜像 Pod”（Mirror Pod），仅用于状态展示。
   - **删除行为**：
     - 执行 `kubectl delete pod` 会删除镜像 Pod，但 `kubelet` 会立即重新创建。
     - 彻底删除需**移除节点上的 YAML 文件**，`kubelet` 检测到文件删除后才会终止 Pod。
#### 3. **示例：创建静态 Pod**
1. **编辑 YAML 文件**（如 `static-web.yaml`）：
   ```yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: static-web
   spec:
     containers:
     - name: nginx
       image: nginx
       ports:
       - containerPort: 80
   ```
2. **放置到静态 Pod 目录**：
   
   ```bash
   sudo cp static-web.yaml /etc/kubernetes/manifests/
   ```
3. **验证运行状态**：
   ```bash
   kubectl get pods
   # 输出示例：STATIC-WEB-node1（镜像 Pod）
   ```

> 也可以**通过http创建**
>
> 需要为kubelet设置启动参数`-manifest-url=指定url地址`，kubelet会周期性地去该地址下载pod的定义文件，并以JSON/YAML格式的进行解析，当文件变化时会对应地终止或启动静态pod 
> 操作方式与`-pod-manifest-path=`本质一样，只不过一个是直接放在本地，一个是每次都通过url地址下载
#### 4. VS 裸Pod

**相同点**  
- YAML 定义文件可完全相同（kind都是Pod）。
**不同点**  

| **维度**     | **静态 Pod**                                          | **裸 Pod**                                     |
| ------------ | ----------------------------------------------------- | ---------------------------------------------- |
| **创建方式** | 将 YAML 文件放入节点目录 `/etc/kubernetes/manifests/` | 通过 `kubectl apply` 提交到 API Server         |
| **运行节点** | 仅运行在配置文件的所在节点                            | 可被调度到任意节点（遵循调度规则）             |
| **删除方式** | 需删除节点上的 YAML 文件                              | 通过 `kubectl delete pod` 直接删除（永久失效） |
## 十一、Downward API

> **意义**：
>
> - **信息注入**：容器中的应用可以轻松访问Pod 或 Pod 所在节点的元数据，而无需通过外部服务或配置文件。
> - **增强监控和日志记录**：可以用于将 Pods 和节点的元数据注入到监控工具或日志记录系统中，从而使得监控数据和日志更加丰富和易于分析。
### **1. 介绍**

#### 1.1 定义

**Downward API** 允许将 Pod 或 Pod 所在节点的元数据注入容器内部，支持两种形式：

- **环境变量**：将元数据设置为容器内的环境变量。
- **Volume 挂载**：将元数据以文件形式挂载到容器内部。

#### **1.2 可注入的元数据类型**

- Pod 名称、命名空间、IP 地址、调度节点名称。
- Pod 的标签（Labels）、注解（Annotations）。
- 容器的资源请求（Requests）与限制（Limits）。

#### **1.3 关键限制**
- **仅支持预定义信息**：只能获取容器启动前确定的元数据（如 Pod 名称、IP、资源约束）。
- **不支持运行时数据**：无法获取容器运行后生成的信息（如进程 PID），需通过 Sidecar 容器处理。
### **2. 注入方式与示例**
#### 2.1 **环境变量注入**
通过 `valueFrom.fieldRef` 或 `valueFrom.resourceFieldRef` 引用元数据。

##### **示例 1：注入 Pod 元数据**
```yaml
# env-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: env-pod
spec:
  containers:
  - name: env-pod
    image: busybox
    command: ["/bin/sh", "-c"]
    args:
    - while true; do
        env;
        sleep 300;
      done;
    env:
    - name: NODE_NAME           # 注入节点名称
      valueFrom:
        fieldRef:
          fieldPath: spec.nodeName
    - name: POD_NAME            # 注入 Pod 名称
      valueFrom:
        fieldRef:
          fieldPath: metadata.name
    - name: POD_NAMESPACE       # 注入命名空间
      valueFrom:
        fieldRef:
          fieldPath: metadata.namespace
    - name: POD_IP             # 注入 Pod IP
      valueFrom:
        fieldRef:
          fieldPath: status.podIP
```

##### **示例 2：注入容器资源限制**
```yaml
# resource-env-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: dapi-envars-resourcefieldref
spec:
  containers:
  - name: test-container
    image: busybox
    command: ["sh", "-c"]
    args:
    - while true; do
        printenv MY_CPU_REQUEST MY_CPU_LIMIT MY_MEM_REQUEST MY_MEM_LIMIT;
        sleep 10;
      done;
    resources:
      requests:
        memory: "32Mi"
        cpu: "1"
      limits:
        memory: "64Mi"
        cpu: "2"
    env:
    - name: MY_CPU_REQUEST      # 注入 CPU 请求值
      valueFrom:
        resourceFieldRef:
          containerName: test-container  # 必须指定容器名称
          resource: requests.cpu
    - name: MY_CPU_LIMIT        # 注入 CPU 限制值
      valueFrom:
        resourceFieldRef:
          containerName: test-container
          resource: limits.cpu
    - name: MY_MEM_REQUEST      # 注入内存请求值（32Mi）
      valueFrom:
        resourceFieldRef:
          containerName: test-container
          resource: requests.memory
    - name: MY_MEM_LIMIT        # 注入内存限制值（64Mi）
      valueFrom:
        resourceFieldRef:
          containerName: test-container
          resource: limits.memory
  restartPolicy: Never
```
#### 2.2 **Volume 挂载注入**
通过 `downwardAPI` 卷将元数据以文件形式挂载到容器。

##### **示例：挂载 Labels 和 Annotations**
```yaml
# volume-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: volume-pod
  labels:
    k8s-app: test-volume
    node-env: test
  annotations:
    gender: male
    build: test
spec:
  volumes:
  - name: podinfo
    downwardAPI:
      items:
      - path: labels        # 将 Labels 写入文件 /etc/podinfo/labels
        fieldRef:
          fieldPath: metadata.labels
      - path: annotations  # 将 Annotations 写入文件 /etc/podinfo/annotations
        fieldRef:
          fieldPath: metadata.annotations
  containers:
  - name: volume-pod
    image: busybox
    args: ["sleep", "3600"]
    volumeMounts:
    - name: podinfo
      mountPath: /etc/podinfo  # 挂载到容器内的目录
```

**挂载后的文件内容**：
```bash
# /etc/podinfo/labels
k8s-app="test-volume"
node-env="test"

# /etc/podinfo/annotations
gender="male"
build="test"
```
#### 2.3 **使用场景与选择建议**

| **方式**        | **适用场景**                                                 |
| --------------- | ------------------------------------------------------------ |
| **环境变量**    | 少量简单元数据（如 Pod 名称、IP），需在容器启动时静态获取。  |
| **Volume 挂载** | 复杂或动态更新的元数据（如 Labels、Annotations），需以文件形式持久化或与其他工具集成（如监控日志）。 |
## 十二、命名空间

| **操作**           | **命令示例**               | **说明**                                                     |
| :----------------- | :------------------------- | :----------------------------------------------------------- |
| 创建命名空间       | `kubectl create ns test`   | 或通过 YAML 定义                                             |
| 查看命名空间       | `kubectl get ns`           | 列出所有命名空间                                             |
| 指定资源命名空间   | `metadata.namespace: test` | 在 YAML 中定义                                               |
| 操作跨命名空间资源 | `kubectl -n test get pods` | 使用 `-n` 参数，不指认默认`default`                          |
| 删除命名空间       | `kubectl delete ns test`   | 级联删除所有资源（高危操作，若中途暂停删除操作，可能etcd数据库里的相关数据未删干净，导致k8s报各种各样的错） |
## 十三、标签
#### **核心概念**
- **作用**：
  1. **建立资源关联**：通过标签将不同资源逻辑关联（如 Service 通过标签选择 Pod）。
  2. **筛选资源**：根据标签条件过滤操作目标资源。
- **格式要求**：
  - 键值对形式：`key=value`。
  - 键名规范：
    - 支持字母、数字、`-`、`_`、`.`，且需以字母开头。
    - 最长 63 字符。
  - 值规范：最长 63 字符，可为空字符串。
#### **标签操作**
##### 1. **添加/更新标签**
- **方式 1：YAML 清单中定义**  
  
  在资源的 `metadata.labels` 字段中添加标签：
  
  ```yaml
  # deployment-with-labels.yaml
  apiVersion: v1
  kind: Deployment
  metadata:
    name: test
    labels: # 给Deployment资源本身打的标签
      env: prod      # 标签键值对
      tier: frontend
  spec:
    spec: 
    replicas: 3
    selector: # 选择器，用于确定哪些 Pod 属于这个 Deployment
      matchLabels: # 匹配标签，用于选择具有特定标签的 Pod
        app: nginx
    template:
      metadata:
        labels:
          app: nginx # 这个标签必须和matchLabels中的一个一致
    containers:
    - name: nginx
      image: nginx
  ```
  
- **方式 2：`kubectl label` 命令**  
  
  语法：`kubectl label <资源类型> <资源名称> <key>=<value>`  
  
  示例：
  
  ```bash
  # 为 Pod 添加标签
  kubectl label pods mypod app=web
  
  # 强制覆盖已有标签（需 --overwrite）
  kubectl label pods mypod app=backend --overwrite
  ```
  **支持资源类型**：Pod、Deployment、Node、Service 等。
##### 2. **查看标签**
- **查看资源的全部标签**：
  ```bash
  kubectl get pods test --show-labels
  ```
  输出示例：
  ```
  NAME    READY   STATUS    RESTARTS   AGE   LABELS
  mypod   1/1     Running   0          10m   env=prod,tier=frontend,app=nginx
  ```

- **筛选带特定标签的资源**：
  ```bash
  # 精确匹配键值对
  kubectl get pods -l env=prod
  
  # 筛选存在某键的标签（无论值）
  kubectl get pods -l env
  kubectl get pods -l env,tier # 多键
  
  # 多标签筛选（逻辑 AND）
  kubectl get pods -l env=prod,tier=frontend
  
  # 排除某键值对
  kubectl get pods -l 'env!=dev'
  
  # 集合操作（in/notin）
  kubectl get pods -l 'tier in (frontend,backend)'
  ```
##### 3. **删除标签**
- **方式 1：编辑 YAML 文件**  
  
  直接删除 `metadata.labels` 中的对应键值。
  
- **方式 2：`kubectl label` 命令**  
  
  语法：`kubectl label <资源类型> <资源名称> <key>-`  
  
  示例：
  
  ```bash
  # 删除 Pod 的 env 标签
  kubectl label pods mypod env-
  ```
#### **使用场景**
- **服务选择 Pod**：  
  
  Service 通过 `spec.selector` 匹配 Pod 标签，实现流量路由。
  
  ```yaml
  # service.yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: frontend-svc
  spec:
    selector:
      app: frontend  # 选择所有包含 app=frontend 标签的 Pod
    ports:
      - protocol: TCP
        port: 80
        targetPort: 9376
  ```
  
- **控制器管理资源**：  
  
  Deployment 通过标签关联 ReplicaSet 和 Pod。
  
  ```yaml
  # deployment.yaml
  apiVersion: apps/v1
  kind: Deployment
  metadata:
    name: frontend
  spec:
    selector:
      matchLabels:
        app: frontend  # 匹配 Pod 标签
    template:
      metadata:
        labels:
          app: frontend  # Pod 模板标签
      spec:
        containers: [...]
  ```
