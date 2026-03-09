---
title: "Service"
draft: false
tags: ["k8s", "基础", "网络"]
---

### 1. Service是什么？
- **智能负载均衡器**：Service 是 K8s 中用于代理一组 Pod 的抽象层，提供统一的访问入口。
### 2. 为何使用 Service？
#### 2.1 关键问题解决
- **Pod IP 动态变化**  

   Pod 重启或重建后 IP 会变化，Service 通过稳定的 Cluster IP 屏蔽后端 Pod IP 的变化。

- **多副本动态管理**  

   Service 自动负载均衡到所有健康的 Pod，支持动态扩缩容。

#### 2.2 Service 的核心作用

- **动态管理 Pod 并感知 Pod 的 ip 地址、状态的变化**  

   - 通过 **标签选择器（Label Selector）** 动态关联并管理 Pod，能够自动感知 Pod 的变化（如 IP 变动、副本扩缩容）。其核心机制依赖 **Endpoints** 对象维护 Pod 的 IP+Port 列表，并实时监控 Pod 状态：当 Pod 的 IP 地址变化或未通过 `readinessProbe` 就绪检查时，Endpoints 会立即更新列表（摘除异常 Pod），确保 Service 仅将流量路由到健康的 Pod，从而实现负载均衡与故障自动恢复。

- **统一访问入口**  
  
   - **集群内访问**：  
     - Cluster IP：固定虚拟 IP，仅集群内部可访问。  只要svc不被删除重建，该地址不会变。
     
     - FQDN 域名：格式为 `<Service名称>.<命名空间>.svc.cluster.local`，由 **CoreDNS** 解析。  （域名 -> Cluster IP）
     
       - 在宿主机上使用 `dig` 命令解析 K8s svc 的 FQDN 域名时，需要明确指定 K8s 集群的 DNS 服务器（CoreDNS），因为宿主机默认的 DNS 配置可能无法识别集群内部域名。
     
         ```bash
         # 获取 CoreDNS 的 Cluster IP
         kubectl get svc -n kube-system | grep kube-dns
         
         dig @<CoreDNS-IP> <Service名称>.<命名空间>.svc.cluster.local
         ```
     
       - 或者可以修改宿主机的 DNS 配置（`/etc/resolv.conf`），添加 CoreDNS 的 Cluster IP 作为 DNS 服务器，如此，宿主机便能够自动解析 K8s 内部域名
     
         ```bash
         nameserver 10.96.0.10  # CoreDNS 的 Cluster IP
         ```
     
         注意：**此操作可能影响宿主机的其他 DNS 解析**，建议仅在调试时使用
     
   - **集群外访问**：  
     
     - NodePort：为 Service 分配一个**静态端口**，外部流量通过 `NodeIP:NodePort` 进入k8s集群
     - LoadBalancer：通过云厂商的负载均衡器暴露服务。  
   
- **微服务抽象**  

   每个 Service 对应一个微服务，简化服务间调用。
### 3. Service 的原理
#### 3.1 网络通信基础
- **依赖网络插件**：如 Flannel（VXLAN 模式）实现跨节点 Pod 通信，Service 仅负责负载均衡规则 。

#### 3.2 负载均衡模式

| **特性**               | **iptables**                  | **IPVS**                             |
| :--------------------- | :---------------------------- | :----------------------------------- |
| **设计目标**           | 通用防火墙规则管理            | 专为负载均衡设计                     |
| **底层实现**           | 基于链式规则匹配（线性遍历）  | 基于哈希表（直接查表，复杂度 O(1)）  |
| **性能**               | 规则数量多时性能下降          | 高性能，适合大规模服务               |
| **负载均衡算法**       | 仅支持随机均衡（`random`）    | 支持多种算法（RR、WRR、LC、SH 等）   |
| **会话保持（亲和性）** | 基于 `--probability` 权重模拟 | 原生支持会话保持（如 `sh` 调度算法） |
| **维护复杂度**         | 规则链复杂，调试困难          | 规则简洁，易于维护                   |
| **内核依赖**           | 默认支持（无需额外模块）      | 需加载 `ip_vs` 内核模块              |

> **补充**：
>
> - 当 kube-proxy 以 ipvs 代理模式启动时，kube-proxy 将验证节点上是否安装了 IPVS 模块，如果未安装，则 kube-proxy 将回退到 iptables 代理模式

#### 3.3 转发规则

- **全局一致性**：所有节点的 `kube-proxy` 维护相同的转发规则，动态感知 Service 和 Pod 变化。

  ```bash
  # 查看当前系统上所有配置的 IPVS 负载均衡规则
  ipvsadm -Ln
  ```

- **请求链路**：  
  
  请求 → Service（Cluster IP） → IPVS/iptables 计算目标 Pod → 网络插件封装转发。
### 4. Service 类型

#### 4.1 ClusterIP（默认）
- **特点**：仅在集群内部通过 Cluster IP 或 FQDN 访问。
- **配置示例**：
  ```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: my-service
  spec:
    selector:
      app: my-app
    ports:
      - protocol: TCP
        port: 80       # Service 端口
        targetPort: 80 # Pod 端口
    type: ClusterIP
  ```
  
  `ClusterIP` 类型的 Service 端口是虚拟的，并不直接对应于任何物理设备或网络接口，而是由 K8s 本身管理的。

#### 4.2 NodePort
- **特点**：

  - 在所有节点开放 `NodePort`（范围 30000-32767），外部通过 `<NodeIP>:<NodePort>` 访问。
  - 较高版本的 k8s 的 **NodePort 并不真实占用物理机的物理端口**。其流量通过 `kube-proxy` 的 **iptables/IPVS 规则** 转发到后端 Pod，物理机的端口本身并未被监听或占用

- **转发链路**：  

  外部请求 → NodeIP:NodePort → IPVS/iptables 规则 → Pod IP:targetPort

- **配置示例**：
  ```yaml
  spec:
    type: NodePort
    ports:
      - port: 80
        targetPort: 80
        nodePort: 31000
  ```

#### 4.3 LoadBalancer
- **特点**：自动申请云厂商的负载均衡器（无需人工部署），绑定各节点的 `NodePort`。

- **转发链路**：

  外部请求 → 云厂商负载均衡器 (External IP:Port) → NodeIP:NodePort → IPVS/iptables 规则 → Pod IP:targetPort。

- **适用场景**：公有云环境（如 AWS、GCP）。

- **配置示例**：
  ```yaml
  spec:
    type: LoadBalancer
  ```

#### 4.4 ExternalName
- **特点**：将 Service 映射到外部服务的域名。
- **典型应用场景**：

  - **连接外部数据库**：如果你的应用程序需要连接到一个运行在 K8s 集群外的数据库，可以使用 ExternalName 服务将数据库的 DNS 名称映射到集群内，从而使集群内的应用能够透明地访问外部数据库
  - **访问第三方 API 服务**

- **配置示例**：

  ```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: external-svc
  spec:
    type: ExternalName
    externalName: api.external.com
  # 外部服务后期需要迁移到集群内的话，可以使用ExternalName实现平滑过渡，确保服务迁移过程中内部应用能够无缝访问服务（只需修改对应的service配置，其FQDN并未改变）
  ```

#### 4.5 自定义 Endpoints（无域名外部服务）
- **场景**：外部服务只有 IP+Port，无域名时手动关联 Endpoints。
- **配置步骤**：
  
  1. 创建**无 Cluster IP** 的 Service：
     ```yaml
     apiVersion: v1
     kind: Service
     metadata:
       name: mysql-external
     spec:
       clusterIP: None
       ports:
         - port: 13306
     ```
  2. 创建**同名** Endpoints：
     ```yaml
     apiVersion: v1
     kind: Endpoints
     metadata:
       name: mysql-external
     subsets:
       - addresses:
           - ip: 192.168.1.100
         ports:
           - port: 3306
     ```

#### 4.6 注意

##### 会分配 Cluster IP 的 Service 类型：

| **Service 类型** | **是否分配 Cluster IP** | **说明**                                                     |
| :--------------- | :---------------------- | :----------------------------------------------------------- |
| **ClusterIP**    | ✅ 是（默认）            | 专为集群内通信设计，必须依赖 Cluster IP。                    |
| **NodePort**     | ✅ 是（默认）            | 在 ClusterIP 基础上扩展，额外开放节点端口供外部访问。        |
| **LoadBalancer** | ✅ 是（默认）            | 在 NodePort 基础上扩展，额外创建云厂商负载均衡器，但仍保留 Cluster IP。 |
| **ExternalName** | ❌ 否                    | 直接映射为外部域名（CNAME），不代理 Pod，因此不需要 Cluster IP。 |

##### **为什么大部分 Service 类型默认分配 Cluster IP？**

**（1）集群内部通信的稳定性**

- **核心作用**：Cluster IP 是 Service 的虚拟 IP，**与 Pod 生命周期解耦**。
  即使 Pod 重建或扩缩容，Cluster IP 保持不变，确保集群内其他组件（如其他 Service、Deployment）能通过固定地址访问服务。

**（2）服务发现与负载均衡**

- **DNS 解析**：Service 的 DNS 名称（如 `my-svc.my-namespace.svc.cluster.local`）解析到 Cluster IP，而不是直接解析到 Pod IP。
- **负载均衡**：流量通过 Cluster IP 进入 Service 后，由 `kube-proxy` 基于 IPVS/iptables 规则分发到后端 Pod。

**（3）设计一致性**

- **统一入口**：无论 Service 是否需要对外暴露（如 NodePort/LoadBalancer），集群内部组件始终通过 Cluster IP 访问服务，**保持行为一致**。
### 5. Kubernetes 中的 IP 类型
| **IP 类型**    | **描述**                              |
| -------------- | ------------------------------------- |
| **Node IP**    | 物理节点的静态 IP，用于外部通信。     |
| **Pod IP**     | Pod 的动态 IP，生命周期内可能变化。   |
| **Cluster IP** | Service 的虚拟 IP，稳定且集群内唯一。 |
### 6. 高级特性（了解）
#### 会话保持（Session Affinity）
- **作用**：同一客户端的请求始终转发到同一 Pod，影响负载均衡效果。
- **配置**：通过 `spec.sessionAffinity: ClientIP` 设置。

#### 获取客户端真实 IP

- **前提**：当服务需要处理来自集群外部的流量时，通常会通过负载均衡器（如云提供商的负载均衡器）来实现
- **`spec.externalTrafficPolicy: Local`**：
  - **Cluster（默认值）**：负载均衡器将外部流量转发到集群内部的某个节点，然后该节点上的 kube-proxy 将流量转发到目标 Pod。这种方式下，**Pod 看到的源 IP 地址是节点的 IP 地址**，而不是客户端的真实IP地址。
  - **Local**：负载均衡器直接将外部流量转发到节点上运行的目标 Pod，而**不经过 kube-proxy 的额外跳转**。这种方式下，Pod 可以直接看到客户端的真实 IP 地址。

- **影响**：减少网络跳数，但可能导致流量分布不均（负载均衡器会优先选择外部请求[curl 某个物理节点的ip+nodeport]时指定的节点上的 Pod 来转发流量），影响负载均衡效果。
