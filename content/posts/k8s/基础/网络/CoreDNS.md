---
title: "CoreDNS"
draft: false
tags: ["k8s", "基础", "网络"]
---

#### **一、CoreDNS 介绍**

- **作用**：负责 K8s 集群内的域名解析，实现服务注册与发现。
  - **服务注册**：
    - 当在 K8s 中创建一个 Service 对象时，CoreDNS 会自动检测到这个事件。
    - CoreDNS 将该 Service 的信息，如 IP 地址和端口，注册到其内部的 DNS 记录中。
  - **服务发现（DNS 查询流程）**：
    - 集群内的 Pod 配置 DNS 服务器为 `kubedns` Service 的 ClusterIP（通过 `/etc/resolv.conf` 中的 `nameserver` 字段）。
    - Pod 发送 DNS 查询请求到 `kubedns` Service。
    - Service 将请求负载均衡到后端 CoreDNS Pod。
    - CoreDNS 根据其内部注册的DNS记录，将查询请求解析为对应的IP地址和端口信息，并返回给请求者。
    - 请求者通过得到的 IP 地址和端口信息来访问目标 Service（一个微服务）。

- **核心组件**：
  - **CoreDNS Pod**：以 Deployment 或 DaemonSet 形式部署，监听 DNS 查询并提供响应。
  - **K8s Service（kubedns）**：作为 CoreDNS Pod 的前端，提供 ClusterIP（如 `10.96.0.10`），负载均衡 DNS 查询请求到 CoreDNS Pod。
    - **名称兼容性**：
      早期 K8s 默认 DNS 服务为 `kubedns`，现已被 CoreDNS 取代，但 Service 名称仍保留为 `kube-dns` 以保持向后兼容。

- **支持的域名类型**：
  1. **Service 资源**：格式为 `<svc-name>.<namespace>.svc.cluster.local`。
  2. **固定名称的 Pod**（通过 StatefulSet 或手动创建的裸 Pod）**+ 无头服务**：格式为 `<pod-name>.<headless-svc-name>.<namespace>.svc.cluster.local`。
- **核心功能**：
  - 提供稳定的域名访问方式，屏蔽后端服务 IP 变动。
  - 与 Service 结合，动态管理服务可达状态（通过 readinessProbe 探针，健康检查）。
#### **二、添加 CoreDNS 自定义解析记录**

> 通过添加自定义解析记录，可以显著扩展 CoreDNS 的功能，满足以下场景需求：
>
> - **解析外部服务**：
>   - 集群内的应用需要访问企业内部的非 K8s 服务（如数据库、遗留系统）或特定外部域名（如 `api.example.com`）。
>   - 通过自定义解析记录，将外部域名直接映射到目标 IP，避免依赖外部 DNS 服务器或复杂的网络代理配置。
> - **覆盖默认解析**：
>   - 在测试环境中，需要将生产环境的域名（如 `prod-service.company.com`）临时指向测试集群的 IP。
>   - 通过自定义解析记录，可以实现快速测试或故障转移，无需修改应用代码或配置。
> - **简化复杂域名**：
>   - 某些服务使用冗长的域名（如 `backend-service.data-analytics.namespace.svc.cluster.local`），应用需要更简短的别名（如 `backend`）。
>   - 通过自定义别名提升可读性和维护性。
> - **解决网络限制**：
>   - 集群所在网络限制直接访问外部 DNS 服务器，或需要绕过某些防火墙规则。
>   - 通过自定义解析直接指定目标 IP，避免依赖外部 DNS 解析。

##### 1. **操作步骤**：

- 编辑 CoreDNS 的 ConfigMap：
  ```bash
  kubectl edit configmap coredns -n kube-system
  ```
- 添加 `hosts` 插件块（示例）：
  ```yaml
  hosts {
      fallthrough  # 查询失败时转发到下一插件
  }
  ```
- 重启 CoreDNS：
  ```bash
  kubectl scale deployment coredns -n kube-system --replicas=0
  kubectl scale deployment coredns -n kube-system --replicas=1
  ```

##### 2. **验证**：

```bash
```
#### **三、为 Pod 定制解析记录**
**前提条件**：

1. Pod 名称固定（通过 StatefulSet 或手动创建的裸 Pod）。
2. 必须创建无头服务（ClusterIP 为 None）。
   - 为 Pod 提供一个稳定的网络标识（即 DNS 名称）

##### **3.1 正确方案：StatefulSet + 无头服务**
- **示例**：
  ```yaml
  apiVersion: v1
  kind: Service
  metadata:
    name: my-headless-svc
  spec:
    clusterIP: None
    selector:
      app: my-app
  ```
  - 生成的域名格式：`<pod-name>.<headless-svc-name>.<namespace>.svc.cluster.local`。

##### **3.2 错误尝试：Deployment + 无头服务**
- **失败原因**：
  1. Deployment 创建的 Pod 名称不固定（重启后变化）。
  2. 无法通过 `<pod-name>.<headless-svc-name>.<namespace>.svc.cluster.local` 解析到 Pod IP。

##### **3.3 手动为 Pod 定制解析**
- **步骤**：
  1. 创建裸 Pod 并指定 `hostname` 和 `subdomain`：
     ```yaml
     apiVersion: v1
     kind: Pod
     metadata:
       name: busybox1
     spec:
       hostname: busybox-1
       subdomain: default-subdomain
     ```
  2. 创建同名无头服务：
     ```yaml
     apiVersion: v1
     kind: Service
     metadata:
       name: default-subdomain
     spec:
       clusterIP: None
       selector:
         name: busybox
     ```
  3. **验证解析**：
     ```bash
     dig @10.96.0.10 busybox-1.default-subdomain.default.svc.cluster.local
     ```
#### **四、Pod 的 DNS 策略**
- **可选策略**（通过 `dnsPolicy` 字段配置）：
  1. **Default**：使用宿主机的 `/etc/resolv.conf`（不推荐，依赖节点配置）。
  2. **ClusterFirst（默认）**：优先使用集群 DNS（CoreDNS），失败时转发到上游 DNS。
  3. **ClusterFirstWithHostNet**：HostNetwork 模式下仍优先使用 CoreDNS。
  4. **None**：自定义 DNS 配置（需配合 `dnsConfig` 字段）。
#### **五、Pod 的 DNS 配置**
- **适用场景**：`dnsPolicy: None` 时，必须通过 `dnsConfig` 自定义配置。
- **配置字段**：
  
  - **nameservers**：DNS 服务器 IP 列表（最多 3 个）。
  - **searches**：DNS 搜索域列表（最多 6 个）。
  - **options**：自定义选项（如 `ndots`、`edns0`）。
  
    - `ndots: "5"` ：如果一个主机名包含至少5个点，DNS 解析器将假设它是一个 FQDN，并直接向配置的 nameservers 发送查询。如果主机名包含的点的数量少于5个，解析器将按照 `search` 列表中的域进行搜索尝试。
  
      - 例如，如果你尝试解析 `foo`，它将按照以下顺序尝试解析：
  
        - foo.ns1.svc.cluster-domain.example
  
        - foo.svc.cluster-domain.example
  
        - foo.cluster-domain.example
  
        - foo.domain.example
  
        - foo.example
  
        - foo
- **示例**：
  
  ```yaml
  # .spec.dnsConfig
  dnsConfig:
    nameservers:
      - 1.2.3.4
    searches:
      - foo.ns1.svc.cluster-domain.example
  	- foo.svc.cluster-domain.example
  	- foo.cluster-domain.example
  	- foo.domain.example
  	- foo.example
  	- foo
    options:
      - name: ndots
        value: "5"
  ```
