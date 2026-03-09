---
title: "kube-prometheus manifests目录解析"
draft: false
tags: ["k8s", "进阶", "监控"]
---

## I. 引言：`kube-prometheus` 清单文件的解剖学



`kube-prometheus` 项目不仅是 Kubernetes 监控领域的一个工具集，更是一套经过精心设计和版本控制的、用于实现生产级监控堆栈的最佳实践范本 1。其核心理念在于通过一组声明式的 Kubernetes 清单（manifests），提供一个完整、开箱即用的监控解决方案。这些清单文件并非孤立的资源定义，而是一个相互关联、协同工作的有机整体，共同构成了覆盖数据采集、存储、查询、告警和可视化的全链路监控系统。



### `kube-prometheus` 的设计哲学



`kube-prometheus` 的价值在于其完整性。它捆绑了 Prometheus Operator、高可用的 Prometheus 实例、高可用的 Alertmanager、Grafana 以及多种关键的指标导出器（Exporters），如 `node-exporter` 和 `kube-state-metrics` 1。这与单独部署 Prometheus Operator 形成鲜明对比。单独的 Operator 只提供了管理监控组件的“大脑”（即控制器），而如何配置和部署 Prometheus、Alertmanager 等实际工作负载，则留给了用户自己 4。

`kube-prometheus` 的 `manifests` 目录正是填补了这一空白，提供了一套经过验证的“集群监控”配置典范，使用户能够快速启动一个功能完备的监控平台。

值得注意的是，`manifests` 目录下的这些 YAML 文件本身是由 `jsonnet` 模板库生成的 1。

`jsonnet` 允许通过编程方式生成和组合配置，提供了强大的定制和复用能力。尽管本报告的分析重点是最终生成的 YAML 清单，但理解其来源对于希望进行深度定制的用户至关重要。



### 表 1：Manifest 目录蓝图



为了系统性地理解 `manifests` 目录下的众多文件，下表提供了一个全面的蓝图。它将文件按其所属的核心组件和 Kubernetes 资源类型进行分类，并简要概述了各自的职责。这张表可以作为后续深度分析的索引和快速参考。

| 文件名 (前缀)              | Kubernetes Kind                                              | 组件                | 简明角色摘要                                                 |
| -------------------------- | ------------------------------------------------------------ | ------------------- | ------------------------------------------------------------ |
| `prometheus-operator-*`    | `Deployment`, `ServiceAccount`, `ClusterRole`, `ClusterRoleBinding` | Prometheus Operator | 定义并部署核心控制器，该控制器负责管理监控相关的自定义资源（CRD）。 |
| `prometheus-*`             | `Prometheus`, `ServiceAccount`, `ClusterRole`, `ClusterRoleBinding`, `Service`, `NetworkPolicy`, `PodDisruptionBudget` | Prometheus 实例     | 通过 `Prometheus` CRD 声明式地定义 Prometheus 服务实例、其高可用配置、抓取规则以及权限。 |
| `alertmanager-*`           | `Alertmanager`, `ServiceAccount`, `Service`, `Secret`, `ServiceMonitor`, `PrometheusRule`, `NetworkPolicy`, `PodDisruptionBudget` | Alertmanager        | 通过 `Alertmanager` CRD 定义告警管理器集群、其配置、网络访问策略及自我监控规则。 |
| `grafana-*`                | `Deployment`, `Service`, `Secret`, `ConfigMap`               | Grafana             | 部署 Grafana 服务，并通过 `Secret` 和 `ConfigMap` 自动配置数据源和预置仪表盘。 |
| `node-exporter-*`          | `DaemonSet`, `Service`, `ServiceAccount`, `ClusterRole`, `ClusterRoleBinding`, `ServiceMonitor` | node-exporter       | 在每个集群节点上部署 `node-exporter`，用于收集主机级别的物理指标。 |
| `kube-state-metrics-*`     | `Deployment`, `Service`, `ServiceAccount`, `ClusterRole`, `ClusterRoleBinding`, `ServiceMonitor`, `NetworkPolicy` | kube-state-metrics  | 部署 `kube-state-metrics`，用于从 Kubernetes API Server 获取并转换集群中各种对象的状态指标。 |
| `blackboxExporter-*`       | `Deployment`, `Service`, `ServiceAccount`, `ClusterRole`, `ClusterRoleBinding`, `ConfigMap` | blackbox-exporter   | 部署黑盒探测器，用于对网络端点（如 HTTP, TCP）进行可用性探测。 |
| `kubernetesControlPlane-*` | `ServiceMonitor`                                             | 控制平面监控        | 定义一系列 `ServiceMonitor`，用于抓取 Kubernetes 核心控制平面组件（如 API Server, CoreDNS, Kubelet）的指标。 |
| `*-prometheusRule.yaml`    | `PrometheusRule`                                             | 规则引擎            | 定义一系列 `PrometheusRule`，包含告警规则和记录规则，由 Prometheus 实例动态加载。 |



## II. 编排器：Prometheus Operator



Prometheus Operator 是整个监控堆栈的“大脑”和“指挥中心”。它通过实现 Kubernetes 的 Operator 模式，将 Prometheus、Alertmanager 等复杂有状态应用的部署和管理过程自动化、声明化。本节将深入分析定义 Operator 自身行为和权限的清单文件，揭示其作为核心编排器的运作机制。



### Operator 的部署 (`prometheus-operator-deployment.yaml`)



此文件定义了一个标准的 Kubernetes `Deployment` 资源，用于部署 Prometheus Operator 的 Pod。

- **部署规格分析**：该 `Deployment` 的 `spec.replicas` 被设置为 1。这是一个关键的架构决策，表明 Operator 作为控制器的角色，其核心任务是监听和协调资源状态，通常不需要多副本 6。Operator 的高可用性并非通过多副本来保证，而是依赖于 Kubernetes 自身的 

  `Deployment` 控制器来确保单个 Pod 的持续运行。

- **容器参数**：`spec.template.spec.containers` 中的 `args` 列表配置了 Operator 的核心行为。例如，`--kubelet-service` 指定了 Kubelet 服务的命名空间和名称，`--prometheus-config-reloader` 指定了用于动态重载 Prometheus 配置的 sidecar 容器镜像。这些参数允许在部署时对 Operator 的行为进行精细调整。

- **架构权衡**：Operator 的单副本设计是一个在控制平面复杂性和可用性之间的深思熟虑的权衡。如果 Operator Pod 发生故障，已经运行的 Prometheus 和 Alertmanager 实例会继续使用其最后一次的有效配置进行工作，监控和告警功能不会中断。风险在于，在 Operator 恢复之前，任何对 `ServiceMonitor`、`PrometheusRule` 等自定义资源的创建或修改都将不会被同步到 Prometheus 的配置中 6。这体现了其对监控数据平面的影响隔离，仅在控制平面上存在短暂的单点故障风险。



### Operator 的权限 (RBAC)



Operator 需要广泛且强大的权限来管理其所负责的资源。这通过一组 RBAC (Role-Based Access Control) 资源来实现，构成了 Operator 安全模型的核心。

- **`prometheus-operator-serviceAccount.yaml`**：此文件定义了一个名为 `prometheus-operator` 的 `ServiceAccount`。这个 `ServiceAccount` 将作为 Operator Pod 的身份标识，所有对 Kubernetes API 的请求都将使用这个身份进行认证。

- **`prometheus-operator-clusterRole.yaml`**：这是本节中最关键的权限定义文件。它定义了一个 `ClusterRole`，授予了 Operator 在整个集群范围内进行操作的权限。其 `rules` 字段的详细分析揭示了 Operator 的工作原理：

  - **自定义资源管理**：它对 `monitoring.coreos.com` API 组下的所有核心 CRD（如 `prometheuses`, `alertmanagers`, `servicemonitors`, `prometheusrules` 等）拥有完全的 `get`, `list`, `watch`, `create`, `update`, `patch`, `delete` 权限 7。这是其最基本的职责——管理这些自定义资源的全生命周期。

  - **工作负载和配置管理**：它同样拥有对 `apps/v1` 组下的 `StatefulSets` 和 `Deployments`，以及 `v1` 组下的 `ConfigMaps` 和 `Secrets` 的完全控制权 8。这正是 Operator 模式的核心体现。Operator 监听一个高层级的抽象资源（如 

    `Prometheus` CRD），然后将其“翻译”成一组具体的、底层的 Kubernetes 资源（一个 `StatefulSet` 用于部署 Prometheus Pod，一个 `ConfigMap` 用于存储其配置文件，以及一个 `Secret` 用于存放敏感数据）。

  - **Webhook 配置**：它还需要对 `admissionregistration.k8s.io` 组下的 `ValidatingWebhookConfigurations` 具有管理权限，以支持对 `PrometheusRule` 资源的语法验证，防止无效的规则被应用到集群中 6。

- **`prometheus-operator-clusterRoleBinding.yaml`**：此文件创建了一个 `ClusterRoleBinding`，将前面定义的 `prometheus-operator` `ClusterRole` 绑定到 `prometheus-operator` `ServiceAccount`。正是这个绑定操作，才真正将强大的权限授予了 Operator Pod。

- **安全模型的深层含义**：Operator 的 `ClusterRole` 权限极其广泛，使其在所管理的命名空间内几乎拥有对关键工作负载和配置资源的管理员级别控制。这揭示了一个重要的安全考量：对 `Prometheus` 或 `Alertmanager` 等 CRD 的创建或修改权限，实际上是一种间接创建 `StatefulSet` 和 `Secret` 的能力。因此，保护对 Operator 及其 CRD 的访问权限，与保护对 `StatefulSet` 的直接访问权限同等重要。这是采用 Operator 模式所带来的权限模型的涟漪效应，要求平台管理员必须将 CRD 视为一级安全对象来管理。



## III. 核心引擎：部署与配置 Prometheus



本节将深入剖析定义 Prometheus 监控引擎本身的相关清单。核心主题是**配置与实例的解耦**，展示了 `kube-prometheus` 如何通过自定义资源（CRD）以声明式、Kubernetes 原生的方式来定义和管理一个高可用的 Prometheus 集群。



### Prometheus 自定义资源 (`prometheus-prometheus.yaml`)



此文件的核心是一个 `kind: Prometheus` 的自定义资源，而非一个原生的 `Deployment` 或 `StatefulSet` 4。Prometheus Operator 会持续监听这类资源，并根据其 

`spec` 中定义的期望状态，自动创建和管理底层的 Kubernetes 资源。

- **`spec` 深度解析**:
  - `replicas: 2`：此字段直接声明了需要部署两个 Prometheus 实例。Operator 会据此创建一个包含两个 Pod 的 `StatefulSet`，并自动配置它们以实现高可用性。
  - `serviceAccountName: prometheus-k8s`：指定了 Prometheus Pod 运行时所使用的 `ServiceAccount`。这个身份对于后续的 RBAC 权限绑定至关重要，决定了 Prometheus Pod 是否有权限发现和抓取集群中的其他服务。
  - `ruleSelector`, `serviceMonitorSelector`, `podMonitorSelector`：这三个选择器是实现动态配置的核心机制。它们内部的 `matchLabels` 字段定义了一组标签选择条件。这等于告诉 Prometheus 实例：“请在集群中查找所有带有特定标签（例如 `release: prometheus`）的 `PrometheusRule`、`ServiceMonitor` 和 `PodMonitor` 资源，并将它们自动加载为你的告警/记录规则和抓取目标。” 10。正是这个机制，将分散定义的监控目标和规则动态地“织”入 Prometheus 的配置中，实现了配置的模块化和自动化。
  - `alerting`：此部分定义了 Prometheus 如何与 Alertmanager 通信。`alertmanagers` 字段列表指定了 Alertmanager 服务的地址，通常指向 `alertmanager-main` 这个 `Service`，从而将告警事件转发至告警处理管道 11。



### Prometheus 实例的权限 (RBAC)



与 Operator 自身需要广泛的管理权限不同，由 Operator 创建的 Prometheus 实例遵循最小权限原则，其权限被严格限制在“发现”和“读取”的范围内。

- **`prometheus-serviceAccount.yaml`**：创建一个名为 `prometheus-k8s` 的 `ServiceAccount`，作为 Prometheus Pod 的身份 14。

- **`prometheus-clusterRole.yaml`**：此 `ClusterRole` 定义了 Prometheus 实例所需的权限。与 Operator 的角色相比，其权限范围被显著缩小：

  - 它对 `nodes`, `services`, `endpoints`, `pods` 等核心资源只拥有 `get`, `list`, `watch` 的只读权限 8。这些权限足以让 Prometheus 通过 Kubernetes API 来发现抓取目标（例如，通过 

    `ServiceMonitor` 发现 Service 的 Endpoints）。

  - 它拥有对 `nodes/metrics` 的 `get` 权限，这是为了能够直接抓取每个节点上 Kubelet 暴露的指标。

  - **最小权限原则的体现**：这种权限分离设计是 `kube-prometheus` 安全模型的一大亮点。Prometheus *服务器* 本身不需要创建、删除或修改任何集群资源，它的核心任务只是读取和发现。通过仅授予只读权限，即使 Prometheus Pod 本身被攻破，其对集群造成的潜在破坏也被极大地限制了。这是对上一章节中提到的 Operator 与其管理对象之间权限分离设计的具体实践。



### 支持性资源



除了核心的 `Prometheus` CRD 和 RBAC 配置外，还有一系列标准的 Kubernetes 资源来支撑 Prometheus 实例的运行。

- **`prometheus-service.yaml`**：创建了一个名为 `prometheus-k8s` 的 `Service` 17。这个 

  `Service` 为两个 Prometheus Pod 提供了一个稳定的内部访问入口。无论是 Grafana 查询数据，还是其他应用需要访问 Prometheus API，都可以通过这个统一的 Service DNS 名称（`prometheus-k8s.monitoring.svc`）进行，而无需关心后端具体是哪个 Pod 在提供服务。

- **`prometheus-networkPolicy.yaml`**：这是一个 `NetworkPolicy` 资源，它定义了严格的网络访问规则。通常，它会限制只有来自 `monitoring` 命名空间内特定 Pod（如 Grafana 和 Alertmanager）的流量才能访问 Prometheus Pod 的端口。这增强了安全性，防止了来自集群其他部分的未授权访问。

- **`prometheus-podDisruptionBudget.yaml`**：定义了一个 `PodDisruptionBudget` (PDB)，确保在进行自愿性中断操作（如节点维护导致 Pod 驱逐）时，至少有一个 Prometheus 副本是可用的。这对于维持 Prometheus 服务的高可用性至关重要，避免了因计划内维护导致的监控数据中断。



## IV. 告警管道：从检测到通知



本节将追踪一个告警事件的完整生命周期，从 Prometheus 检测到异常并触发告警，到 Alertmanager 接收、处理并发送通知。此过程展示了 `kube-prometheus` 如何构建一个高可用、可配置的告警系统。



### Alertmanager 自定义资源 (`alertmanager-alertmanager.yaml`)



与 Prometheus 类似，Alertmanager 的部署也是通过一个 `kind: Alertmanager` 的自定义资源来声明的 2。Prometheus Operator 负责将这个 CRD 翻译成一个底层的 

`StatefulSet`。

- **`spec` 深度解析**:
  - `replicas: 3`：这是实现 Alertmanager 高可用性的关键配置。当副本数大于 1 时，Operator 会自动为这些 Alertmanager Pod 配置集群模式。这 3 个 Pod 会组成一个 gossip 协议的集群，相互同步告警的状态（如哪些告警已发送、哪些被抑制或静默）。这确保了在任何一个 Alertmanager Pod 发生故障时，告警通知不会重复发送或丢失，是生产环境中必不可少的配置 18。
  - `serviceAccountName: alertmanager-main`：定义了 Alertmanager Pod 运行所使用的身份。
  - `secrets:`：此字段用于指定包含 Alertmanager 主配置文件 `alertmanager.yaml` 的 `Secret` 名称。在 `kube-prometheus` 的默认配置中，此字段为空，Operator 会**默认**查找名为 `alertmanager-<Alertmanager CRD name>`（即 `alertmanager-main`）的 `Secret` 。



### Alertmanager 的配置与服务



一系列辅助资源共同构成了 Alertmanager 的完整功能。

- **`alertmanager-secret.yaml`**：此 `Secret` 资源至关重要，它包含了 Alertmanager 的核心配置文件 `alertmanager.yaml`。在 `kube-prometheus` 的默认清单中，这个配置文件非常精简，通常只定义了一个“空”的接收器（receiver），实际上会丢弃所有告警。这并非疏忽，而是一个设计好的“占位符”，旨在强制用户必须主动配置自己的通知渠道（如 Slack、PagerDuty、Email 等）才能使告警生效，从而避免了无意义的告警被触发而无人接收的情况 11。
- **`alertmanager-service.yaml`**：创建了名为 `alertmanager-main` 的 `Service`。这个 Service 有两个主要作用：一是为 Prometheus 提供一个稳定的端点，用于将触发的告警发送到 Alertmanager 集群；二是暴露 Alertmanager 的 Web UI，方便运维人员查看告警状态和管理静默规则。
- **`alertmanager-serviceMonitor.yaml`**：这个 `ServiceMonitor` 的作用是让 Prometheus *抓取 Alertmanager 自身的指标*。这实现了对告警系统本身的监控，例如可以监控 Alertmanager 的配置是否加载成功、处理的告警数量、通知发送的成功率等。
- **`alertmanager-prometheusRule.yaml`**：此文件定义了一组 `PrometheusRule`，专门用于监控 Alertmanager 集群的健康状况。例如，其中可能包含一条规则，当 Alertmanager 集群的成员数量少于预期（如少于 3 个）时触发告警。
- **自我监控与自我修复的闭环系统**：将以上各点综合来看，`kube-prometheus` 构建了一个高度弹性的闭环系统。`Prometheus` CRD 指向 `Alertmanager` 服务以发送告警。同时，`alertmanager-serviceMonitor.yaml` 和 `alertmanager-prometheusRule.yaml` 确保了 Prometheus 能够反过来监控 Alertmanager 的健康状态。如果 Alertmanager 出现问题，Prometheus 会发现并触发告警，通知运维人员。在底层，Prometheus Operator 会始终确保 Alertmanager 的 `StatefulSet` 满足 `replicas: 3` 的期望状态，如果 Pod 意外终止，会自动重建。这种设计使得整个监控堆栈具备了自我监控和一定程度的自我修复能力，是其生产可用性的重要保障。



## V. 数据源：指标导出器与服务发现



这是整个监控体系中交互最复杂、最能体现其自动化能力的部分。本节将详细阐述 `kube-prometheus` 如何部署各种指标导出器（Exporters），并通过 `ServiceMonitor` 这一关键的 CRD，将它们自动“连接”到 Prometheus，实现无需手动干预的服务发现。



### 表 2：ServiceMonitor 到 Service 的链接机制



`ServiceMonitor` 是 Prometheus Operator 实现服务发现的“粘合剂”。下表清晰地展示了 `ServiceMonitor` 如何通过标签选择器（label selector）与目标 `Service` 进行匹配，从而指导 Prometheus 发现并抓取指标端点。理解这个机制是排查“为什么我的服务没有被监控到”这类常见问题的关键。

| ServiceMonitor 资源                                   | 目标 Service         | 命名空间      | Selector Key:Value (来自 ServiceMonitor)       | 匹配的 Service Label                           | 目标端口名         |
| ----------------------------------------------------- | -------------------- | ------------- | ---------------------------------------------- | ---------------------------------------------- | ------------------ |
| `nodeExporter-serviceMonitor.yaml`                    | `node-exporter`      | `monitoring`  | `app.kubernetes.io/name: node-exporter`        | `app.kubernetes.io/name: node-exporter`        | `http-metrics`     |
| `kubeStateMetrics-serviceMonitor.yaml`                | `kube-state-metrics` | `monitoring`  | `app.kubernetes.io/name: kube-state-metrics`   | `app.kubernetes.io/name: kube-state-metrics`   | `http-metrics`     |
| `alertmanager-serviceMonitor.yaml`                    | `alertmanager-main`  | `monitoring`  | `app.kubernetes.io/name: alertmanager`         | `app.kubernetes.io/name: alertmanager`         | `web`              |
| `kubernetesControlPlane-serviceMonitorApiserver.yaml` | `kubernetes`         | `default`     | `component: apiserver`, `provider: kubernetes` | `component: apiserver`, `provider: kubernetes` | `https`            |
| `kubernetesControlPlane-serviceMonitorCoreDNS.yaml`   | `kube-dns`           | `kube-system` | `k8s-app: kube-dns`                            | `k8s-app: kube-dns`                            | `http-metrics-dns` |



### 节点级指标：`node-exporter`



- **`node-exporter-daemonset.yaml`**：此文件使用 `DaemonSet` 来部署 `node-exporter`。选择 `DaemonSet` 是因为其核心任务是收集每个节点的物理机指标（CPU、内存、磁盘、网络等）。`DaemonSet` 确保了集群中的每一个节点（或符合 `nodeSelector` 的节点）上都会且仅会运行一个 `node-exporter` Pod，从而实现了对整个集群物理资源的全面覆盖 21。文件内部的 

  `spec.template.spec` 中，通过 `hostPort` 将容器的 9100 端口直接暴露在节点的网络上，并通过 `volumes` 和 `volumeMounts` 将主机的 `/proc`、`/sys` 和 `/` 等关键目录挂载到容器内部，使得 `node-exporter` 能够读取到宿主机的内核和系统信息。

- **`node-exporter-service.yaml` & `nodeExporter-serviceMonitor.yaml`**：`node-exporter` 的 `Service` 并不承载流量，而是作为一个标签选择器，逻辑上聚合了所有由 `DaemonSet` 创建的 Pod。如上表所示，`nodeExporter-serviceMonitor.yaml` 文件中的 `ServiceMonitor` 通过标签 `app.kubernetes.io/name: node-exporter` 找到了这个 `Service`。Prometheus Operator 发现此匹配后，会进一步查找该 `Service` 关联的所有 `Endpoints`（即所有 `node-exporter` Pod 的 IP 地址），并为每一个 `Endpoint` 生成一个抓取配置。这样，Prometheus 就能自动抓取集群中所有节点上的指标 24。



### 集群状态指标：`kube-state-metrics`



- **`kubeStateMetrics-deployment.yaml`**：与 `node-exporter` 不同，`kube-state-metrics` 被部署为一个标准的 `Deployment` 1。这是因为它不需要在每个节点上运行。它的工作模式是连接到 Kubernetes API Server，查询集群中各种资源（如 Deployments, Pods, Nodes, PersistentVolumes 等）的状态、标签、注解等元数据，并将其转换为 Prometheus 的指标格式。因此，一个（或为高可用部署多个）

  `kube-state-metrics` Pod 就足以服务整个集群。

- **`kubeStateMetrics-service.yaml` & `kubeStateMetrics-serviceMonitor.yaml`**：同样，`ServiceMonitor` 通过标签选择器找到 `kube-state-metrics` 的 `Service`，进而发现其背后的 Pod 端点 1。Prometheus 抓取这个端点后，就能获取到关于整个集群资源对象状态的宝贵指标，例如“Deployment 的期望副本数与可用副本数”、“Pod 的当前阶段（Running/Pending/Failed）”等。

- **`kubeStateMetrics-clusterRole.yaml` & `...clusterRoleBinding.yaml`**：为了能够从 API Server 读取全集群的资源信息，`kube-state-metrics` 需要相应的 RBAC 权限。其 `ClusterRole` 授予了对多种 Kubernetes 资源的只读（`list`, `watch`）权限。



### 控制平面监控



`kube-prometheus` 的强大之处还在于它对 Kubernetes 控制平面自身的深入监控。`manifests` 目录包含了一系列专门为此设计的 `ServiceMonitor`，例如：

- `kubernetesControlPlane-serviceMonitorApiserver.yaml`
- `kubernetesControlPlane-serviceMonitorCoreDNS.yaml`
- `kubernetesControlPlane-serviceMonitorKubelet.yaml`
- `kubernetesControlPlane-serviceMonitorControllerManager.yaml`
- `kubernetesControlPlane-serviceMonitorScheduler.yaml`

这些 `ServiceMonitor` 的一个共同特点是，它们通常不与 `kube-prometheus` 自身部署的工作负载相关联，而是直接指向由 Kubernetes 集群自身创建和管理的核心服务。例如，`...Apiserver.yaml` 会指向 `default` 命名空间下的 `kubernetes` `Service`，而 `...CoreDNS.yaml` 会指向 `kube-system` 命名空间下的 `kube-dns` `Service`。这种设计体现了 `kube-prometheus` 作为一个“集群监控”解决方案的定位：它不仅监控运行在集群之上的应用，更对支撑集群运行的基础设施进行全面、深入的监控。



## VI. 可视化层：Grafana



Grafana 是 `kube-prometheus` 堆栈的默认可视化前端。本节将分析 Grafana 的部署方式，并重点揭示其如何被预配置，以实现与 Prometheus 的无缝集成和开箱即用的仪表盘体验。



### `grafana-deployment.yaml`



此文件定义了用于部署 Grafana 实例的 `Deployment` 资源。除了标准的容器定义外，其中一个设计尤为关键。

- **`k8s-sidecar` 容器**：在 Grafana Pod 的定义中，除了主 `grafana` 容器外，还有一个名为 `k8s-sidecar` 的辅助容器 6。这个 sidecar 容器的作用是持续监听 Kubernetes API，查找所有带有特定标签（如 

  `grafana_dashboard: "1"`）的 `ConfigMap` 资源。一旦发现新的或更新的 `ConfigMap`，它就会将其中的数据（即仪表盘的 JSON 定义）下载到 Grafana Pod 内的一个共享目录中。Grafana 主容器被配置为从这个目录动态加载仪表盘。

- **声明式仪表盘管理**：`k8s-sidecar` 的存在，是实现**GitOps 风格、声明式仪表盘管理**的核心机制。它将仪表盘从 Grafana 的内部数据库中解放出来，使其可以像其他 Kubernetes 资源一样被代码化、版本化和自动化部署。团队可以将仪表盘的 JSON 文件封装在 `ConfigMap` 中，并随应用一同部署。`k8s-sidecar` 会自动发现并加载它们，无需任何手动 UI 操作 5。这极大地简化了仪表盘的管理，尤其是在拥有多个团队和大量仪表盘的大型组织中。



### Grafana 的配置与仪表盘



- **`grafana-dashboardDatasources.yaml`**：这个文件名可能有些误导，因为它实际上是一个 `Secret` 资源，而非 `ConfigMap`。这个 `Secret` 包含了一个名为 `datasources.yaml` 的文件，其内容预先定义了 Grafana 的数据源 38。其中最重要的一条，是创建了一个名为 

  `prometheus` 的数据源，其 URL 直接指向了 Prometheus 的内部服务地址 `http://prometheus-k8s.monitoring.svc:9090`。**正是这个文件，使得整个监控堆栈能够“开箱即-用”**。没有它，用户在部署完所有组件后，还需要手动登录 Grafana UI，添加并配置 Prometheus 数据源，整个体验的自动化程度将大打折扣。

- **`grafana-dashboard-\*.yaml` 文件**：`manifests` 目录中包含大量以此模式命名的 `ConfigMap` 文件。每一个 `ConfigMap` 都包含一个完整的 Grafana 仪表盘的 JSON 定义，例如用于展示节点指标、Pod 资源使用情况、集群整体状态等的仪表盘。这些 `ConfigMap` 都被打上了 `k8s-sidecar` 所监听的标签，因此在部署后会被自动加载到 Grafana 中，为用户提供一套丰富且即时可用的预置视图。



## VII. 编码化的智能：Prometheus 规则



如果说 Exporter 是监控系统的“感官”，Prometheus 是“心脏”，那么 Prometheus 规则就是其“大脑”。本节将探讨 `kube-prometheus` 如何通过 `PrometheusRule` 这一自定义资源，将告警和记录规则作为一等公民在 Kubernetes 中进行管理。



### `PrometheusRule` 自定义资源



- **`kind: PrometheusRule`**：在 `manifests` 目录中，所有以 `*-prometheusRule.yaml` 结尾的文件，其资源类型都是 `kind: PrometheusRule` 2。这是由 Prometheus Operator 定义的一个 CRD，它允许用户以 Kubernetes 原生的方式来声明和管理 Prometheus 的规则，而不是通过修改庞大且集中的 

  `prometheus.yml` 配置文件。

- **`ruleSelector` 的作用**：回顾第三节中对 `prometheus-prometheus.yaml` 的分析，其 `spec.ruleSelector` 字段是连接 Prometheus 实例与这些 `PrometheusRule` 资源的桥梁。Prometheus 实例会根据这个选择器，自动发现并加载所有匹配标签的 `PrometheusRule` 对象。这种设计将规则的管理从 Prometheus 实例的核心配置中彻底解耦出来。

- **联邦式监控治理模型**：这种解耦架构带来了强大的组织和协作优势。一个中心化的平台团队可以负责维护 `kube-prometheus` 核心堆栈的生命周期，而各个业务应用团队则可以在自己的命名空间中，独立地创建和管理属于他们自己应用的 `PrometheusRule` 资源。只要这些 `PrometheusRule` 资源被打上了正确的标签（与中心 Prometheus 实例的 `ruleSelector` 匹配），它们就会被自动发现和加载。这使得在一个集中管理、统一运维的 Prometheus 实例之上，能够实现一种**联邦式的、权责下放的监控规则所有权模型**，极大地提升了可扩展性和团队自主性。



### 规则示例分析



`PrometheusRule` 资源可以包含两种类型的规则：告警规则（alerting rules）和记录规则（recording rules）。

- **告警规则 (Alerting Rules)**：以 `kubernetes-apps-prometheusRule.yaml` 文件中的 `KubePodCrashLooping` 告警为例。
  - `expr`: 其表达式 `rate(kube_pod_container_status_restarts_total{job="kube-state-metrics",namespace=~".+"}[5m]) * 60 * 5 > 0` 是一个 PromQL 查询，用于计算过去 5 分钟内 Pod 的重启速率，当该值大于 0 时（意味着有重启发生），条件成立。
  - `for`: `15m` 表示上述条件必须持续满足 15 分钟，告警才会从 `Pending` 状态转为 `Firing` 状态。这可以有效防止因短暂波动引起的告警风暴。
  - `labels`: 附加的标签，如 `severity: critical`，可用于告警的路由和分级。
  - `annotations`: 提供了更丰富的告警上下文信息，如 `summary` 和 `description`，这些信息通常会包含在发送给用户的通知中，帮助快速定位问题。
- **记录规则 (Recording Rules)**：以 `kube-prometheus-prometheusRule.yaml` 文件中的 `namespace_cpu:kube_pod_container_resource_requests:sum` 为例。
  - `expr`: `sum by (namespace) (kube_pod_container_resource_requests{job="kube-state-metrics", resource="cpu"})`。这个查询会按命名空间对所有 Pod 的 CPU 请求量进行求和。
  - `record`: `namespace_cpu:kube_pod_container_resource_requests:sum` 是新生成的时间序列的名称。
  - 记录规则的作用是预先计算那些查询成本较高或被频繁使用的 PromQL 表达式，并将结果存为一个新的、更简洁的时间序列。这样，当 Grafana 仪表盘或其他告警规则需要这个聚合数据时，可以直接查询这个预计算好的结果，而无需每次都执行复杂的 `sum` 操作。这极大地提升了查询性能，降低了 Prometheus 的负载。



## VIII. 综合与结论：追踪数据流



为了将前述所有分析融会贯通，本节将通过追踪一个具体指标在整个监控堆栈中的完整生命周期，来具象化地展示各个组件之间是如何协同工作的。这将为理解 `kube-prometheus` 的整体架构提供一个清晰的叙事线索。



### 一个指标的旅程：`node_cpu_seconds_total`



1. **生成 (Generation)**：在集群的某个工作节点上，Linux 内核持续更新 CPU 使用时间的统计信息，并通过 `/proc` 虚拟文件系统将其暴露出来。
2. **导出 (Export)**：运行在该节点上的 `node-exporter` Pod（由 `node-exporter-daemonset.yaml` 定义）读取 `/proc/stat` 文件，解析出 CPU 时间数据，并将其转换为 Prometheus 指标格式，即 `node_cpu_seconds_total`。该指标通过 Pod 的 `/metrics` 端点在 9100 端口上暴露。
3. **服务发现 (Service Discovery)**：`node-exporter-service.yaml` 定义的 `Service` 通过标签选择器逻辑上覆盖了所有 `node-exporter` Pod。`nodeExporter-serviceMonitor.yaml` 中定义的 `ServiceMonitor` 则通过匹配 `Service` 的标签（如 `app.kubernetes.io/name: node-exporter`）发现了这个 `Service`。
4. **目标选择 (Target Selection)**：`prometheus-prometheus.yaml` 中定义的 `Prometheus` 实例，其 `spec.serviceMonitorSelector` 字段的标签选择器与 `nodeExporter-serviceMonitor` 上的标签相匹配。
5. **抓取 (Scrape)**：Prometheus Operator 检测到这一系列匹配关系后，会自动更新 Prometheus 的配置文件（该配置存储在一个 `Secret` 中），并触发 Prometheus `StatefulSet` 的滚动更新（`scrape-configs`）。其中一个 Prometheus Pod 随即根据新配置，向目标 `node-exporter` Pod 的 IP 地址和 9100 端口发起 HTTP GET 请求，抓取 `/metrics` 端点的数据。
6. **存储 (Storage)**：抓取到的 `node_cpu_seconds_total` 指标及其值和时间戳被 Prometheus 实例接收，并存入其本地的时间序列数据库（TSDB）中。
7. **告警 (Alerting)**：一个在 `*-prometheusRule.yaml` 文件中定义的 `PrometheusRule`（例如名为 `NodeCPUHigh` 的告警规则）会周期性地对存储的指标执行 PromQL 查询，例如 `avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) < 0.1`。如果查询结果满足条件且持续时间超过 `for` 子句的设定，该规则会触发一个告警，并通过 `alerting` 配置将告警事件发送到 `alertmanager-main` 服务。
8. **可视化 (Visualization)**：一位运维工程师打开 Grafana 网页。`grafana-dashboardDatasources.yaml` 这个 `Secret` 已经预先配置好了 Grafana 到 `prometheus-k8s` 服务的连接。工程师点击打开名为 "Node Exporter / Nodes" 的仪表盘（该仪表盘的 JSON 定义由 `k8s-sidecar` 从某个 `ConfigMap` 中加载）。仪表盘中的一个图表面板会向 Prometheus 发送一个查询，例如 `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) by (instance)`，Prometheus 返回计算结果，Grafana 将其渲染成一个实时更新的 CPU 使用率图表。



### 表 3：组件 RBAC 权限总结



下表从安全角度对核心组件的 RBAC 权限进行了高层级的总结，为安全审计和权限管理提供了清晰的视图。

| 组件                | ServiceAccount 名称   | 关联的 ClusterRole 名称 | 关键权限摘要                                                 |
| ------------------- | --------------------- | ----------------------- | ------------------------------------------------------------ |
| Prometheus Operator | `prometheus-operator` | `prometheus-operator`   | 对监控类 CRD、`StatefulSet`、`ConfigMap`、`Secret` 等拥有完全的 CRUD 权限。 |
| Prometheus 实例     | `prometheus-k8s`      | `prometheus-k8s`        | 对 `nodes`, `services`, `endpoints`, `pods` 等核心资源拥有只读（`get`, `list`, `watch`）权限，用于服务发现。 |
| Alertmanager        | `alertmanager-main`   | (无默认 `ClusterRole`)  | 默认不需要访问 Kubernetes API 的权限。                       |
| kube-state-metrics  | `kube-state-metrics`  | `kube-state-metrics`    | 对绝大多数集群资源拥有只读（`list`, `watch`）权限，用于生成状态指标。 |
| node-exporter       | `node-exporter`       | `node-exporter`         | 拥有 `security.openshift.io` 下 `securitycontextconstraints` 的 `use` 权限（在 OpenShift 环境中），以访问主机资源。 |



### 结论性意见



对 `kube-prometheus` `manifests` 目录的深入分析揭示了一个设计精良、高度自动化的监控架构。其核心 architectural principles 可以总结为：

- **声明式 (Declarative)**：所有组件的部署和配置都通过 Kubernetes 原生的 YAML 清单来定义，用户只需描述“期望状态”，具体实现由 Operator 自动完成。
- **解耦 (Decoupled)**：通过 `ServiceMonitor` 和 `PrometheusRule` 等 CRD，将监控目标、告警规则与 Prometheus 实例本身解耦，实现了配置的模块化和动态化。
- **自我监控 (Self-Monitoring)**：监控堆栈自身也被纳入监控范围，Prometheus 监控着 Alertmanager、Exporter 等组件的健康状况，形成了可靠的闭环。
- **可扩展 (Extensible)**：基于 `jsonnet` 的生成机制和模块化的 CRD 设计，为用户提供了从简单配置到深度定制的平滑过渡路径，能够适应从小型集群到大型企业环境的各种需求。

总而言之，`kube-prometheus` 的 `manifests` 目录提供的不只是一堆配置文件，而是一个强大的、经过生产环境验证的监控基础平台。通过理解这些清单文件及其背后的设计思想，平台和 SRE 团队能够充满信心地使用、管理和扩展这一关键的云原生可观测性解决方案。