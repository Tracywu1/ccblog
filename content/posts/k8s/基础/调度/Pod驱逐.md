---
title: "Pod驱逐"
draft: false
tags: ["k8s", "基础", "调度"]
---

### **1. Pod驱逐介绍**  
- **定义**：将Pod从当前节点移除的过程，可能导致Pod终止并重新调度。  
- **触发场景**：  
  1. **节点不可用**（由 `kube-controller-manager` 周期性检查并发起驱逐）：
     - 节点状态持续 `NotReady`（默认超过 5 分钟）后，驱逐所有 Pod。
  2. **节点资源压力**（由 `kubelet` 周期性检查并发起驱逐）：
     - 不可压缩资源（内存、磁盘）不足时，按 QoS 优先级驱逐部分 Pod。
### **2. Kube-controller-manager发起的驱逐**  
- **触发条件**：节点无存活 `kubelet` 进程上报状态（如宕机、kubelet 挂掉）。

- **流程**：

  前提：每个节点上的 `kubelet` 定期（通过 `node-status-update-frequency` 指定，默认间隔 10 秒）向`kube-apiserver` 上报节点的状态信息（包含节点的健康状态、资源使用情况等）

  1. `kube-controller-manager` （中的 node 控制器代码）周期性检查 `kube-apiserver` 中节点的状态信息（由 `node-monitor-period` 指定，默认每 5 秒）。

  2. 若超过 `node-monitor-grace-period`（默认 40 秒）没有收到 `kubelet` 发来的节点状态信息，标记节点为 `NotReady` 并打上 `NoExecute` 污点（`node.kubernetes.io/unreachable`和`node.kubernetes.io/not-ready`污点）。

  3. Pod 默认容忍 `NotReady`  或者 `unreachable` 污点的时长为 300 秒（通过 `tolerationSeconds` 配置）。

      **修改默认容忍时长的方法**：

     **（1）调整单个 Pod 的容忍时间**

     ```yaml
     # 在 Pod 的 YAML 中显式指定 tolerationSeconds
     tolerations:
       - key: "node.kubernetes.io/not-ready"
         operator: "Exists"
         effect: "NoExecute"
         tolerationSeconds: 100 # 容忍时间可自定义
         
       - key: "node.kubernetes.io/unreachable"
         operator: "Exists"
         effect: "NoExecute"
         tolerationSeconds: 100
     ```

     **（2）全局修改默认容忍时间**

     ```yaml
     # 编辑 Master 节点上的 kube-apiserver 配置文件
     spec:
       containers:
       - command:
         - kube-apiserver
         - --default-not-ready-toleration-seconds=60  # 全局默认值改为60秒
         - --default-unreachable-toleration-seconds=60
     ```

  4. 超时后，节点上所有 Pod 被驱逐。

  从检查节点状态并判断为 `NotReady`  异常，到完成工作负载pod的驱逐总周期默认约等于6分钟（5+40+300 s）

- **核心参数**：  
  - `node-monitor-period`：节点状态检查间隔（默认5秒）。  
  - `node-monitor-grace-period`：节点故障判定窗口（默认40秒）。  
  - `pod-eviction-timeout`（已弃用）：替换为污点（Taint）机制（K8s v1.27+）。  
### **3. Kubelet发起的驱逐（节点压力驱逐）**  

[Node-pressure Eviction | Kubernetes](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)
#### **3.1 节点压力驱逐**  

- **定义**：
  - `kubelet` 主动终止 Pod 以回收节点资源（如内存、磁盘）的过程。
  - 触发条件：不可压缩资源（内存、磁盘、inode、PID）达到预设阈值。
  
- **目的**：防止系统级 OOM（内存不足）或进程崩溃，避免 K8s 集群不稳定。

- **不可压缩资源 VS 可压缩资源**：

  | 资源类型                   | 是否触发驱逐 | 说明                                   |
  | :------------------------- | :----------- | :------------------------------------- |
  | **CPU（可压缩）**          | 否           | 资源不足时由系统内核动态调整权重分配。 |
  | **内存、磁盘（不可压缩）** | 是           | 资源不足时直接触发驱逐，无法动态调整。 |
#### **3.2 驱逐信号与阈值**  
##### **（1）驱逐信号**  
**定义**：驱逐信号是节点资源在特定时间点的状态指标，用于判断是否触发驱逐。kubelet 通过对比信号值与预设阈值决定是否驱逐 Pod。  

| 节点状态         | 驱逐信号                      | 描述                                                | 计算方法                                                     |
| ---------------- | ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| `MemoryPressure` | `memory.available`            | 节点可用内存（基于 cgroupfs 计算，非 `free -m`）。  | `node.status.capacity[memory] - node.stats.memory.workingSet` |
|                  | `allocatableMemory.available` | Pod 可用内存。                                      | `pod.allocatable - pod.workingSet`                           |
| `DiskPressure`   | `nodefs.available`            | 节点文件系统可用磁盘空间（如 `/var/lib/kubelet`）。 | `node.stats.fs.available`                                    |
|                  | `nodefs.inodesFree`           | 节点文件系统可用 inode 数量。                       | `node.stats.fs.inodesFree`                                   |
|                  | `imagefs.available`           | 容器运行时文件系统可用磁盘空间（如镜像存储路径）。  | `node.stats.runtime.imagefs.available`                       |
|                  | `imagefs.inodesFree`          | 容器运行时文件系统可用 inode 数量。                 | `node.stats.runtime.imagefs.inodesFree`                      |
| `PIDPressure`    | `pid.available`               | 可用进程 ID 数量（仅 Linux）。                      | `node.stats.rlimit.maxpid - node.stats.rlimit.curproc`       |

**关键说明**：  
- **`memory.available`**：基于 cgroupfs 计算，确保容器内准确监控。  
- `kubelet` 可识别以下两个特定的文件系统标识符：  
  - **`nodefs`**：节点的主要文件系统，用于存储卷、日志、`emptyDir` 等（路径如 `/var/lib/kubelet`）。  
  - **`imagefs`**：可选文件系统，容器运行时存储镜像和可写层（路径如 `/var/lib/containerd`）。  
##### **（2）驱逐条件**  

**条件格式**：`[eviction-signal][operator][quantity]`  
- **组成**：  
  - `eviction-signal`：驱逐信号（如 `memory.available`）。  
  - `operator`：关系运算符（如 `<`）。  
  - `quantity`：阈值（数值或百分比，如 `1Gi` 或 `10%`）。  

**示例**：  

```yaml
memory.available<10%   # 百分比形式
或
memory.available<1Gi    # 数值形式
```

- **限制**：同一信号不可同时使用百分比和数值。  
##### **（3）软驱逐与硬驱逐**  

| 类型       | 宽限期 | 停止条件                                   | 驱逐行为                                                     | 关键参数                                                     |
| ---------- | ------ | ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **软驱逐** | 有     | 资源恢复至软阈值以下。                     | 1. 触发后等待宽限期（`eviction-soft-grace-period`）。<br>2. 宽限期内未恢复则优雅终止（kill -15） Pod。 | --eviction-soft=memory.available<10%, nodefs.available<15%       # 触发阈值<br/>--eviction-soft-grace-period=memory.available=2m, nodefs.available=2m  # 宽限期（默认 2 分钟）<br/>--eviction-max-pod-grace-period=30         # Pod 优雅终止最大等待时间（秒），超过该时间，则强制终止 |
| **硬驱逐** | 无     | 回收至 `eviction-minimum-reclaim` 设定值。 | 立即强制终止（kill -9） Pod，无宽限期。                      | --eviction-hard=memory.available<256Mi     # 触发阈值<br/>--eviction-minimum-reclaim=memory.available=512Mi  # 最小回收量（避免反复驱逐） |

**资源压力检测与阈值判定**：

- **`--eviction-pressure-transition-period=30s`**：节点在检测到资源压力达到阈值后，需要持续30秒才能判定为确实达到了阈值。这是为了防止短暂的资源波动导致误判。（默认 5 分钟）  

**示例**：

- **软驱逐**：

  **修改 kubelet 配置文件**：

  ```yaml
  # 文件路径：/var/lib/kubelet/config.yaml
  evictionSoft:
    memory.available: "10%"      # 当可用内存 < 10% 时触发软驱逐
    nodefs.available: "15%"      # nodefs 可用空间 < 15% 时触发
    imagefs.available: "15%"     # imagefs 可用空间 < 15% 时触发
  evictionSoftGracePeriod:
    memory.available: "2m"       # 内存软驱逐宽限期（2 分钟）
    nodefs.available: "2m"       # nodefs 宽限期
    imagefs.available: "2m"      # imagefs 宽限期
  evictionMaxPodGracePeriod: 30  # Pod 优雅终止最大等待时间（30 秒）
  ```

  **通过启动参数配置（不推荐）**：

  ```bash
  --eviction-soft=memory.available<10%,nodefs.available<15%,imagefs.available<15% \
  --eviction-soft-grace-period=memory.available=2m,nodefs.available=2m,imagefs.available=2m \
  --eviction-max-pod-grace-period=30
  ```

- **硬驱逐**：

  **修改 kubelet 配置文件**：

  ```yaml
  # 文件路径：/var/lib/kubelet/config.yaml
  evictionHard:
    memory.available: "256Mi"    # 当可用内存 < 256Mi 时触发硬驱逐
    nodefs.available: "1Gi"      # nodefs 可用空间 < 1Gi 时触发
    imagefs.available: "1Gi"     # imagefs 可用空间 < 1Gi 时触发
  evictionMinimumReclaim:
    memory.available: "512Mi"    # 每次驱逐至少回收 512Mi 内存
    nodefs.available: "1Gi"      # 每次驱逐至少回收 1Gi nodefs 空间
    imagefs.available: "1Gi"     # 每次驱逐至少回收 1Gi imagefs 空间
  evictionPressureTransitionPeriod: "30s"  # 资源压力需持续 30 秒才触发驱逐
  ```

  **通过启动参数配置（不推荐）**：

  ```bash
  --eviction-hard=memory.available<256Mi,nodefs.available<1Gi,imagefs.available<1Gi \
  --eviction-minimum-reclaim=memory.available=512Mi,nodefs.available=1Gi,imagefs.available=1Gi \
  --eviction-pressure-transition-period=30s
  ```

- **限制最大保留的 Evicted Pod 数**

  **目标**：避免 Evicted Pod 过多影响集群。

  ##### **配置方法**

  1. **修改 kube-controller-manager 参数**：

     ```yaml
     # 文件路径：/etc/kubernetes/manifests/kube-controller-manager.yaml
     spec:
       containers:
       - command:
         - kube-controller-manager
         - --terminated-pod-gc-threshold=1  # 最多保留 1 个 Evicted Pod
     
     # 生效命令
     systemctl restart kubelet  
     ```

  **参数说明**：

  - `--terminated-pod-gc-threshold`：垃圾回收时保留的终止 Pod 数量（默认 12500）。
  - **设置为 0**：不限制（不推荐）。
#### **3.3 Pod驱逐流程**
当资源使用触发驱逐条件时，kubelet 启动驱逐任务，按优先级终止 Pod 以回收资源，直至资源使用量恢复至阈值以下或达到设定值。
**1. 资源监控与阈值对比**  

- **监控机制**：  
  - kubelet 通过内置的 `cAdvisor` 组件周期性采集节点资源使用数据（如内存、磁盘、inode、PID 等）。  
  - **监控频率**：由 `--node-status-update-frequency` 参数控制，默认 **10 秒**。  
- **阈值判定**：  
  - 将采集到的资源使用量与预设的驱逐阈值（软/硬）进行对比。  
  - 若达到阈值，触发驱逐流程。  
**2. 按 QoS 优先级驱逐 Pod**  

**优先级规则**：  
- **总体原则**：`BestEffort > Burstable > Guaranteed`。  
- **细分规则**：  

| QoS 等级       | 驱逐条件                                                     | 驱逐顺序                                                     |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **BestEffort** | 无资源请求（`requests`/`limits` 未定义）                     | 优先驱逐，按 **实际消耗资源量** 从高到低排序。               |
| **Burstable**  | 资源请求未完全满足（实际使用量可能超出 `requests`）          | - 若存在 Pod **实际使用量超出 `requests`**：驱逐超出量最大的 Pod。<br>- 若无超出：驱逐实际消耗最多的 Pod。 |
| **Guaranteed** | 资源请求与限制相等（`requests` = `limits`）且实际使用量未超出 `limits` | - 若存在 Pod **实际使用量超出 `requests`**：驱逐超出量最大的 Pod（理论上不会发生）。<br>- 若无超出：驱逐实际消耗最多的 Pod。 |

**磁盘资源特殊规则**：  
- **磁盘空间/inode 不足时**：  
  - 完全忽略 QoS 等级，直接按 **磁盘/inode 使用量** 从高到低驱逐 Pod。  
**3. 持续检查与重复驱逐**  

- **终止检查**：  
  - 每次驱逐后，kubelet 重新检查资源使用情况。  
  - 若资源仍未恢复至阈值以下，重复执行 **步骤 2**，继续驱逐下一优先级 Pod。  
- **终止条件**：  
  - 资源使用量降至阈值以下（软驱逐）或达到 `eviction-minimum-reclaim` 设定值（硬驱逐）。  
**4. 驱逐行为细节**  

- **优雅终止**：  
  - 软驱逐：允许 Pod 在 `eviction-max-pod-grace-period`（默认 30 秒）内优雅终止，超时后强制终止。  
  - 硬驱逐：立即强制终止，无宽限期。  
- **状态更新**：  
  - 被驱逐的 Pod 状态标记为 `Failed`，并记录 `Evicted` 事件。 
#### **3.4 驱逐示例**

##### **（1）内存不足引发的驱逐**  
**触发条件**：节点可用内存低于设定阈值（如 `memory.available < 10%` 或 `1Gi`）。  

**驱逐规则**：  

- **按 QoS 等级排序**：`BestEffort > Burstable > Guaranteed`。  
- **同等级内排序**：按内存实际使用量从高到低驱逐。  
##### **（2）磁盘空间不足引发的驱逐**  
**触发条件**：  
- **nodefs**：节点文件系统（如 `/var/lib/kubelet`）的磁盘空间或 inode 不足。  
- **imagefs**：容器运行时文件系统（如 `/var/lib/containerd`）的磁盘空间或 inode 不足。  

**默认阈值**：  
| 驱逐信号             | 触发条件         |
| -------------------- | ---------------- |
| `nodefs.available`   | < 10% 可用空间   |
| `nodefs.inodesFree`  | < 5% 可用 inode  |
| `imagefs.available`  | < 15% 可用空间   |
| `imagefs.inodesFree` | < 15% 可用 inode |
###### **场景 1：nodefs 不足**  
**触发条件**：  

- `/var/lib/kubelet` 空间不足（如日志、emptyDir 卷占满磁盘）。  

**驱逐流程**：  
1. **清理无效数据**：  
   - 删除已失效的 Pod 及其关联的临时文件（如终止的容器日志、emptyDir 卷）。  
2. **驱逐 Pod**：  
   - **不参考 QoS 等级**，按 Pod 对 `nodefs` 的使用量从高到低排序，驱逐占用最多的 Pod。  
   - 即使 `Guaranteed` Pod 占用大量磁盘空间，也会被优先驱逐。  
###### **场景 2：imagefs 不足**  
**触发条件**：  
- 容器镜像存储路径（如 `/var/lib/containerd`）空间不足。  

**驱逐流程**：  
1. **清理未使用的镜像**：  
   - 删除未被任何 Pod 引用的容器镜像和缓存。  
2. **驱逐 Pod**（仅在清理镜像后仍不足时触发）：  
   - 按 Pod 对 `imagefs` 的使用量从高到低排序，驱逐占用最多的 Pod。  
##### **（3）特殊场景说明**  
1. **nodefs 与 imagefs 的关联性**：  
   - 若 `nodefs` 和 `imagefs` 共享同一磁盘分区，两者可能同时触发驱逐。  
   - 需分别配置阈值以避免相互影响。  

2. **DaemonSet 的风险**：  
   - DaemonSet Pod 通常部署到所有节点，若其占用大量磁盘，可能被驱逐导致服务中断。  
   - **建议**：为 DaemonSet Pod 设置 `Guaranteed` QoS 并限制资源使用。  
#### **3.5 节点资源紧缺时的系统行为**  
##### **（1） 调度器的行为**

- **触发条件**：当节点资源（如内存、磁盘）达到驱逐阈值时，kubelet 将节点状态标记为资源压力（如 `MemoryPressure=True`）。
- **调度策略**：
  - 调度器（如 `kube-scheduler`）通过 Watch API Server 获取节点状态。
  - 若节点处于资源压力状态，调度器不再向该节点调度新 Pod。
- **关键机制**：
  - 节点状态由 kubelet 定期上报（默认 10 秒）。
  - 资源压力状态包括：`MemoryPressure`、`DiskPressure`、`PIDPressure`。
- **节点资源不足时，若有新的 pod 要调度进来，会发生什么？**
  - kubelet 会定期上报节点的资源使用情况给 API Server，并存储到 etcd 中。 节点控制器会监控这些信息，并根据资源使用情况更新节点的状态。例如，如果节点内存资源紧张，节点会被标记为 `MemoryPressure: True`。
  - 当一个节点被标记为 `MemoryPressure: True` 状态时， 即使有调度规则将 Pod 调度到该节点，该 Pod 也可能因为资源不足而无法正常启动，最终会被驱逐（Evicted）。
##### **（2） 节点的 OOM 行为**

**背景**：
当 kubelet 未及时回收内存导致系统级内存不足时，Linux 内核的 **OOM Killer** 将终止进程以释放内存。

**OOM Killer 选择策略**：

- **`oom_score_adj` 值**：kubelet 根据 Pod 的 QoS 等级为容器设置此值，影响进程被终止的优先级：

  | QoS 等级       | `oom_score_adj` 值                                           |
  | :------------- | :----------------------------------------------------------- |
  | **Guaranteed** | `-998`（极低优先级，几乎不会被 OOM Killer 选中）             |
  | **BestEffort** | `1000`（最高优先级，优先被终止）                             |
  | **Burstable**  | `max(2, 1000 - (1000 * memoryRequestBytes / machineMemoryCapacityBytes))`（动态计算） |

- **终止逻辑**：

  1. 计算进程的 `oom_score`（基于内存使用比例）。
  2. 将 `oom_score` 与 `oom_score_adj` 相加，得分最高的进程被终止。

- **与 kubelet 驱逐的区别**：

  - **OOM Killer**：强制终止进程，可能触发 Pod 重启（根据 `restartPolicy`）。
  - **kubelet 驱逐**：按 QoS 优先级优雅终止 Pod，状态标记为 `Evicted`。
##### **（3） DaemonSet 类型 Pod 的驱逐风险**

- **问题**：
  - DaemonSet Pod 具有自动重启特性，若被驱逐会反复重建，导致资源震荡。
  - kubelet 无法识别 DaemonSet Pod，无法为其定制驱逐策略。
- **解决方案**：
  - **QoS 等级**：将 DaemonSet Pod 设为 **Guaranteed**，减少被驱逐概率。
  - **资源限制**：明确设置 `requests` 和 `limits`，避免资源超用。
### 4. **测试驱逐配置**

##### **1. 人为制造内存压力**

**脚本 `increase-mem.sh`**：

```sh
#!/bin/bash
mkdir /tmp/memory
mount -t tmpfs -o size=700M tmpfs /tmp/memory  # 挂载 700M 临时内存
dd if=/dev/zero of=/tmp/memory/block           # 写入数据占满内存
sleep 120                                      # 等待驱逐触发
rm -rf /tmp/memory/block                       # 清理内存
umount /tmp/memory
rmdir /tmp/memory
```

##### **2. 测试 Pod 配置**

```yaml
# qos-demo1.yaml（部署到节点 k8s-node-02）
apiVersion: v1
kind: Pod
metadata:
  name: qos-demo1
spec:
  nodeName: k8s-node-02
  containers:
  - name: nginx
    image: centos:7
    command: ["sh", "-c", "sleep 1000000"]
    securityContext:
      privileged: true  # 启用特权模式（挂载 tmpfs 需要）
# qos-demo.yaml（部署到节点 k8s-node-01）
apiVersion: v1
kind: Pod
metadata:
  name: qos-demo
spec:
  nodeName: k8s-node-01
  containers:
  - name: nginx
    image: centos:7
    command: ["sh", "-c", "sleep 1000000"]
    securityContext:
      privileged: true
```

##### **3. 验证驱逐结果**

```bash
kubectl get pods -o wide | grep Evicted  # 查看 Evicted Pod
```
### **五、落地经验**
#### **核心结论**  
**kube-controller-manager 的驱逐时间不宜过短！**  

- **kubelet 发起的驱逐**：合理且必要，优先牺牲低优先级 Pod（如 `BestEffort`），保护节点稳定性。  
- **kube-controller-manager 发起的驱逐**：需谨慎，易因误判导致不必要的 Pod 驱逐。  
#### **1. kube-controller-manager 驱逐的风险**  
**触发场景**：  
- 节点心跳超时（标记为 `NotReady`）后触发驱逐。  
- **常见误判原因**：  
  - Kubelet 进程阻塞或停止（非节点故障）。  
  - 网络问题（交换机故障、NTP/DNS 异常）。  
  - 短暂基础设施抖动（非硬件故障）。  

**潜在问题**：  
- **有状态服务数据丢失**：若 Pod 使用本地存储，驱逐后异地重建可能导致数据丢失（如 MySQL）。  
- **IP 变化引发业务异常**：重建后 Pod IP 变化，依赖 IP 的业务需额外处理（如 Service/DNS）。  
- **双写破坏数据**：数据库类应用在驱逐后未及时终止，可能导致双写冲突。  
#### **2. 实际场景中的驱逐策略建议**  
##### **（1）关闭或限制 kube-controller-manager 驱逐**  
- **操作方式**：  
  - **延长驱逐超时时间**：调整 `--pod-eviction-timeout`（已弃用）或污点容忍时间。  
  - **禁用驱逐功能**：  
    ```yaml
    # 修改 kube-controller-manager 参数
    - --enable-pod-eviction=false
    ```
- **适用条件**：  
  - 业务未完全适配 K8s 特性（如依赖本地存储、固定 IP）。  
  - 无法保障分布式存储或服务高可用性。  

##### **（2）必须启用驱逐时的前提条件**  
- **业务设计优化**：  
  - **无状态化**：业务逻辑与数据分离，使用共享存储（如 Ceph、NFS）。  
  - **异常处理**：业务应容忍 Pod 重建和 IP 变化。  
- **基础设施保障**：  
  - **分布式存储**：确保数据持久化和跨节点可用性。  
  - **可靠的 Service/DNS**：通过 Service 或 DNS 屏蔽 Pod IP 变化。  
#### **3. Kubernetes 驱逐机制与传统架构的对比**  
| 架构类型       | 驱逐行为                                   | 管理模块影响                                             |
| -------------- | ------------------------------------------ | -------------------------------------------------------- |
| **Kubernetes** | 节点异常时驱逐所有 Pod，触发重建。         | 管理模块（如 kube-controller-manager）直接影响运行实例。 |
| **OpenStack**  | 计算节点异常时，管理节点不操作已有虚拟机。 | 管理模块与运行实例解耦。                                 |

**启示**：  
- Kubernetes 驱逐机制更激进，需业务层配合设计（如无状态、共享存储）。  
- 传统架构的“稳定性假设”在 Kubernetes 中不成立，需重新评估容错策略。  
#### **4. 配置建议与最佳实践**  
##### **（1）调整污点容忍时间**  
- **全局修改**（APIServer 参数）：  
  ```yaml
  - --default-not-ready-toleration-seconds=300  # 默认 300 秒
  - --default-unreachable-toleration-seconds=300
  ```
- **Pod 级修改**：  
  ```yaml
  tolerations:
    - key: "node.kubernetes.io/not-ready"
      operator: "Exists"
      effect: "NoExecute"
      tolerationSeconds: 600  # 容忍时间延长至 10 分钟
  ```

##### **（2）关键业务保护**  
- **QoS 等级**：设为 `Guaranteed`，避免被优先驱逐。  
- **优先级调度**：使用 `PriorityClass` 保障核心服务调度。  
  ```yaml
  apiVersion: scheduling.k8s.io/v1
  kind: PriorityClass
  metadata:
    name: high-priority
  value: 1000000  # 优先级数值越高，越不易被驱逐
  ```

##### **（3）监控与告警**  
- **监控指标**：  
  - 节点资源使用率（内存、磁盘、inode）。  
  - Pod Evicted 事件及驱逐原因。  
- **告警规则**：  
  - 节点持续 `NotReady` 超过阈值（如 10 分钟）。  
  - 关键 Pod 被驱逐或频繁重启。  
#### **5. 血泪教训总结**  
- **案例 1**：某 MySQL Pod 因节点短暂网络抖动被驱逐，本地数据丢失且重建后双写破坏数据库。  
  - **根因**：未使用共享存储 + kube-controller-manager 驱逐超时过短。  
  - **修复**：启用分布式存储（如 Rook Ceph）并调整污点容忍时间。  
- **案例 2**：DaemonSet Pod 使用 `BestEffort` QoS，频繁被驱逐导致服务震荡。  
  - **根因**：低 QoS 等级 + 无资源限制。  
  - **修复**：设为 `Guaranteed` 并配置合理 `requests/limits`。  
