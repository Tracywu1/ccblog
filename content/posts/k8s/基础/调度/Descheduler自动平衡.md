---
title: "Descheduler自动平衡"
draft: false
tags: ["k8s", "基础", "调度"]
---

## **一、Descheduler 概述**
- **定义**：  

  Descheduler 是 K8s 的**集群均衡器**，用于解决**运行过程中** 因节点维护、驱逐等操作导致的分布不均问题。

  - **默认调度器的局限**：仅保证创建时的均匀调度，无法处理运行时的动态失衡。
  - **典型场景**：节点维护后，被驱逐的 Pod 不会自动回到原节点，导致资源分布不均。

- **为何需要 Descheduler**

  - **动态集群环境**：节点故障、维护、扩容等操作导致 Pod 分布失衡。
  - **手动干预不足**：删除 Pod 触发重建无法系统性解决分布问题。
  - **自动平衡需求**：确保集群长期运行的资源利用率和高可用性。

- **核心原理**

  - **不参与调度**：仅计算需驱逐的 Pod，触发驱逐后由 `kube-scheduler` 重新调度。
  - **策略驱动**：通过预定义策略（如低利用率节点处理、拓扑约束修复）实现均衡。
## 二、Descheduler 安装
### **1. 安装 Helm**
1. **下载 Helm**  
   - 官网地址：https://github.com/helm/helm/releases  
   - 下载 Linux 版本（示例版本 `v3.15.1`）：  
     ```bash
     wget https://get.helm.sh/helm-v3.15.1-linux-amd64.tar.gz
     ```

2. **解压并配置环境变量**  
   
   ```bash
   tar -zxvf helm-v3.15.1-linux-amd64.tar.gz
   mv linux-amd64/helm /usr/local/bin/
   ```
   - 验证安装：  
     ```bash
     helm version
     # 输出示例：
     # version.BuildInfo{version:"v3.15.1", GitCommit:"e211f2aa62992bd72586b395de50979e31231829"}
     ```
### **2. 安装 Descheduler**
1. **添加 Helm 仓库**  
   ```bash
   helm repo add descheduler https://kubernetes-sigs.github.io/descheduler
   ```

2. **检查集群优先级类**  

   Descheduler 默认以高优先级 Pod 运行，需确保存在 `system-cluster-critical`：  

   ```bash
   kubectl get priorityclass system-cluster-critical
   # 输出示例：
   # NAME                      VALUE        GLOBAL-DEFAULT   AGE
   # system-cluster-critical   2000000000   false            7d17h
   ```

3. **通过 Helm 安装 Descheduler**  
   - **默认安装（CronJob 模式）**  
     
     也支持 Deployment
     
     ```bash
     helm upgrade --install descheduler descheduler/descheduler \
       --set podsecurityPolicy.create=false \
       -n kube-system
     ```
     - **默认配置**：  
       - 执行周期为 `schedule: "*/2 * * * *"`（每 2 分钟运行一次）。  
       - 镜像地址：`registry.k8s.io/descheduler/descheduler:v0.30.1`。  
     
   - **自定义镜像（国内加速）**  
     
     ```bash
     helm upgrade --install descheduler descheduler/descheduler \
       --set podsecurityPolicy.create=false \
       -n kube-system
     ```
### **3. 验证安装**
1. **查看 Helm 部署状态**  
   ```bash
   helm list -n kube-system
   # 输出示例：
   # NAME         NAMESPACE    REVISION   STATUS     CHART               APP VERSION
   # descheduler  kube-system  1          deployed   descheduler-0.30.1  0.30.1
   ```

2. **检查 CronJob 和 Job**  
   ```bash
   kubectl -n kube-system get cronjob
   # 输出示例：
   # NAME           SCHEDULE      SUSPEND   ACTIVE   LAST SCHEDULE   AGE
   # descheduler    */2 * * * *   False     0        2m              10m
   
   kubectl -n kube-system get job
   # 输出示例：
   # NAME                     COMPLETIONS   DURATION   AGE
   # descheduler-28634828     1/1           45s        5m
   # descheduler-28634830     1/1           45s        3m
   ```

3. **查看 Descheduler Pod 日志**  
   ```bash
   kubectl -n kube-system get pods | grep descheduler
   # 输出示例：
   # descheduler-28634828-84cr6   0/1   Completed   0    10m
   # descheduler-28634830-vjlgd   0/1   Completed   0    8m
   
   kubectl -n kube-system logs descheduler-28634828-84cr6
   # 日志中搜索 "Evicted pod" 确认驱逐操作
   ```
### **4. 卸载 Descheduler**
```bash
helm uninstall descheduler -n kube-system
```
### **5. 注意事项**
1. **镜像加速问题**  
   - 默认镜像可能因网络问题拉取失败，建议替换为国内镜像（如阿里云）。  
2. **关键配置参数**  
   - **`podsecurityPolicy.create=false`**：禁用 Pod 安全策略（PSP），适用于未启用 PSP 的集群。  
   - **`schedule`**：CronJob 执行周期，默认每 2 分钟一次，可按需调整（如 `"0 */6 * * *"` 每 6 小时）。  
3. **资源保护**  
   - **PDB（PodDisruptionBudget）**：建议为关键服务配置 PDB，防止大规模驱逐导致服务中断。  
   - **优先级与 QoS**：高优先级 Pod（如 `system-cluster-critical`）默认不会被驱逐。
4. **最佳实践**
   - 结合日志监控和 PDB 策略，确保关键业务不受驱逐影响。
## **三、Descheduler 配置**

1. **默认策略配置**  

   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: descheduler
     namespace: kube-system
   data:
     policy.yaml: |
       apiVersion: "descheduler/v1alpha2"
       kind: "DeschedulerPolicy"
       profiles:
       - name: default
         pluginConfig:					   # 启用的相关插件/策略
         - args:
             evictLocalStoragePods: true  # 是否驱逐使用本地存储的 Pod
             ignorePvcPods: true          # 是否忽略带 PVC 的 Pod
           name: DefaultEvictor
         - name: RemoveDuplicates         # 删除同一节点上的重复 Pod（相同模板哈希）
         - args:
             includingInitContainers: true
             podRestartThreshold: 100     # 重启超过 100 次的 Pod 被驱逐
           name: RemovePodsHavingTooManyRestarts
         plugins:
           balance:
             enabled:
               - RemoveDuplicates
               - RemovePodsViolatingTopologySpreadConstraint  # 驱逐违反拓扑分布约束的 Pod
               - LowNodeUtilization       # 迁移低利用率节点的 Pod
           deschedule:
             enabled:
               - RemovePodsHavingTooManyRestarts
               - RemovePodsViolatingNodeTaints      # 驱逐违反节点污点的 Pod
               - RemovePodsViolatingNodeAffinity    # 驱逐违反节点亲和性的 Pod
   ```

2. **关键策略说明**  

   还有很多，可以去官网上查

   | 策略名称                                      | 作用描述                                                     |
   | :-------------------------------------------- | :----------------------------------------------------------- |
   | `RemoveDuplicates`                            | 确保同一节点上无重复 Pod（基于 Pod 模板哈希，相同即重复）。  |
   | `LowNodeUtilization`                          | 将负载从资源利用率低节点迁移到其他节点（以释放资源或关闭低资源利用率节点），优化资源分配，避免资源浪费。 |
   | `RemovePodsViolatingTopologySpreadConstraint` | 驱逐违反拓扑分布约束的 Pod，确保均匀分布。                   |
   | `RemovePodsHavingTooManyRestarts`             | 驱逐重启次数过多的 Pod（需配置 `podRestartThreshold`）。     |
   | `RemovePodsViolatingNodeTaints`               | 驱逐违法节点污点的 Pod                                       |
   | `RemovePodsViolatingNodeAffinity`             | 驱逐违反节点亲和性的 Pod                                     |
#### **五、使用案例**
1. **部署示例应用**  
   
   ```yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: descheduler-demo-pod
   spec:
     replicas: 6
     selector:
       matchLabels:
         app: descheduler-demo
     template:
       metadata:
         labels:
           app: descheduler-demo
       spec:
         tolerations:
         - key: "node-role.kubernetes.io/control-plane"  # 容忍 Master 污点，即允许调度到 master 上
           operator: "Exists"
           effect: "NoSchedule"
         - key: "node.kubernetes.io/unreachable"         # 容忍节点不可达污点（节点挂掉后，k8s 默认为集群打上该污点）
           operator: "Exists"
           effect: "NoExecute"
           tolerationSeconds: 10                         # 10 秒后驱逐
         containers:
         - name: nginx
           image: nginx:1.18
   ```
   
2. **模拟节点故障与恢复**  
   - **步骤 1**：停止节点 `k8s-node-02` 的 `kubelet`（模拟故障）。  
   - **步骤 2**：观察 Pod 被驱逐并调度到其他节点。  
   - **步骤 3**：恢复 `k8s-node-02` 后，Descheduler 重新平衡 Pod。
#### **六、PDB 策略保护业务**
- **作用**：防止一个服务的所有副本同时被驱逐导致业务中断。  
- **示例配置**：  
  ```yaml
  apiVersion: policy/v1
  kind: PodDisruptionBudget
  metadata:
    name: pdb-demo
  spec:
    maxUnavailable: 1       # 最多允许 1 个副本不可用
    selector:
      matchLabels:
        app: demo           # 匹配受保护的 Pod 标签
  ```
#### **七、注意事项**
1. **不可驱逐的 Pod**  
   - 关键性 Pod（如 `priorityClassName: system-cluster-critical`）。  
   - DaemonSet 管理的 Pod。  
   - 未由控制器（Deployment/RS/Job）管理的 Pod。  

2. **资源与存储限制**  

   - 默认不驱逐使用本地存储（`LocalStorage`）的 Pod，除非设置 `evictLocalStoragePods: true`。  
   - 默认不驱逐带 PVC 的 Pod，除非设置 `ignorePvcPods: true`。  

3. **驱逐优先级**  

   在 `LowNodeUtilization` 和 `RemovePodsViolatingInterPodAntiAffinity` 策略下，

   - 按优先级从低到高驱逐。  
   - 同优先级下，`BestEffort` 类型优先于 `Burstable` 和 `Guaranteed`。  

4. **调试与日志**  

   - 使用 `--v=4` 参数查看 `descheduler` 详细日志。（查找 Pods 驱逐失败原因）
   - 或者通过 describe descheduler completed pods （descheduler任务完成后会保留几个 pod）也可以查看日志 
   - 若驱逐违反 PDB 约束，操作会被拒绝。

5. `annotations` 中带有 `descheduler.alpha.kubernetes.io/evict` 字段的 Pod 都可以被驱逐，该注释用于覆盖阻止驱逐的检查，用户可以选择驱逐哪个 Pods