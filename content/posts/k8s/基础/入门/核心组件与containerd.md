---
title: "核心组件与containerd"
draft: false
tags: ["k8s", "基础", "入门"]
---

## 一、组件管理与静态/非静态Pod

### 1. 组件分布
- **Master节点**:
  - 2个系统服务: `kubelet`, `containerd`
  - 4个静态Pod: `kube-apiserver`, `kube-controller-manager`, `kube-scheduler`, `etcd`
- **Node节点**:
  - 2个系统服务: `kubelet`, `containerd`
  - 1个DaemonSet管理的Pod: `kube-proxy`

### 2. 静态Pod核心特性
- **本地管理**:
  - 配置文件存储在节点目录（如`/etc/kubernetes/manifests`）
  - 由kubelet直接监控创建，无需API Server
- **用途**:
  - 运行关键系统组件（如控制平面组件）
  - `kubeadm`部署的集群默认使用静态Pod运行控制平面
- **生命周期**:
  - 不受Deployment/DaemonSet管理
  - 节点宕机时不会自动迁移
- **配置更新**:
  - 修改配置文件后，kubelet自动重启Pod
- **集群可见性**:
  - 名称附带节点后缀（如`my-pod-node1`）
  - 删除需在节点本地操作

### 3. 静态Pod vs 普通Pod

| **特性**     | **静态Pod**         | **普通Pod**                   |
| ------------ | ------------------- | ----------------------------- |
| **创建方式** | kubelet读取本地文件 | 通过API Server提交（kubectl） |
| **调度管理** | 无控制器管理        | 由控制器（Deployment等）管理  |
| **高可用性** | 依赖节点存活        | 可跨节点重建                  |
| **配置更新** | 直接修改本地文件    | `kubectl apply`更新           |
## 二、containerd vs Docker

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/v2-506c2575e6bd73d014afbf29d3850ef9_1440w.jpg" alt="img" style="zoom:50%;" />

[^CRI]: Container Runtime Interface，容器运行时接口，是 K8s 定义的一组接口（API），用于将 K8s 的控制平面（如 `kubelet`）与底层的容器运行时解耦。允许用户根据需求选择不同的容器运行时，只要该运行时支持 CRI。
[^OCI]: Open Container Initiative) ，开放容器倡议，定义了容器镜像的格式和如何在操作系统上运行容器（如 `runc`）。

> docker应该改为dockerd

| **特性**          | **Docker**                                                   | **containerd**                                               |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **架构层级**      | 上层工具链（包含构建、CLI等）                                | 底层容器运行时，专注运行容器                                 |
| **调用链路**      | 用户→Docker CLI→containerd                                   | 用户直接操作containerd                                       |
| **日志路径**      | `/var/lib/docker/containers/`                                | `/var/log/pods/`（带软链接）                                 |
| **配置文件**      | `/etc/docker/daemon.json`<br />持久化数据目录（包含镜像、容器、网络等数据）：`/var/lib/docker`<br />Docker守护进程运行时临时数据目录：`/var/run/`<br />通常包括`/var/run/docker.sock`（Docker守护进程的套接字文件）、`/var/run/docker.pid`（Docker守护进程的PID文件）等。 | `/etc/containerd/config.toml`<br />持久化数据目录（包括Snapshots、Content、Metadata及各种插件的数据）：root = `/var/lib/containerd`<br />运行时产生的临时数据的目录（包括sockets、pid、挂载点、运行时状态及无需持久化的插件数据）：state = `/run/containerd` |
| **Stream Server** | 内置API支持交互式命令                                        | 需额外配置（如通过CRI插件）                                  |
| **CNI网络**       | 使用Docker自带的网络模型                                     | 依赖CNI插件配置                                              |

> ### 1. 简介：什么是 Stream Server？
>
> **定义**：
>  Stream Server 是容器运行时中​**​处理流式 I/O 通信的核心组件​**​，为以下操作提供底层支持：
>
> - `kubectl exec`（交互式命令执行）
> - `kubectl attach`（附加到运行中容器）
> - `kubectl logs`（实时日志流）
> - `kubectl port-forward`（端口转发）
>
> **核心作用**：
>
> - **建立双向数据通道**：在容器内部进程与外部客户端（如 `kubectl`）之间转发 **stdin/stdout/stderr 数据流**或**网络流量**。
> - **解决安全问题**：隔离高风险操作，避免核心运行时直接暴露流式接口。
>
> ------
>
> ### **2. Docker 中的 Stream Server**
>
> **实现方式**：
>
> - **内置 API 支持**：Docker 的守护进程 `dockerd` **原生集成流式处理能力**，无需独立组件。
> - **工作原理**：
>   1. 执行 `docker exec -it` 时，Docker CLI 请求 `dockerd` API（通过 UNIX Socket `/var/run/docker.sock`）。
>   2. `dockerd` 直接处理流式请求：
>      - 连接容器进程的 stdin/stdout/stderr；
>      - 配置 TTY 伪终端；
>      - 建立客户端与容器间的**双向数据流通道**。
> - **Kubernetes 适配**：
>   - 通过 `kubelet` 内置的 `dockershim` 适配层，将 CRI 请求转换为 Docker API 请求。
>   - `kubectl` 数据流路径：`kubectl` → API Server → `kubelet` (`dockershim`) → `dockerd` → 容器。
> - 对于 `docker exec`来说，流处理逻辑是 `dockerd`内置的。对于 `kubectl exec`，流需要多经过 `kubelet`(`dockershim`) 这一层代理，但最终仍然是 `dockerd`在做流式处理的“脏活累活”
>
> **特点**：
>
> - **高度集成**：流式处理是 `dockerd` 的内置功能，无需额外配置。
> - **简单性**：依赖 Docker 自身 API，无端口暴露问题。
>
> ------
>
> ### **3. Containerd 中的 Stream Server**
>
> **实现方式**：
>
> - **独立组件**：由 `containerd` 的 **CRI 插件**动态启动，作为独立进程运行。
> - **工作原理**：
>   1. `kubelet` 通过 CRI 发送流式请求（如 `ExecRequest`）；
>   2. CRI 插件启动 Stream Server 进程，并返回其**监听地址和端口**（如 `:10000`）；
>   3. `kubectl` **直连 Stream Server** 端口，数据流路径：
>       `kubectl` → Stream Server（节点）→ 容器。
>
> **配置要求**：
>
> - **端口开放**：需在节点防火墙/安全组中开放 Stream Server 端口（默认范围 `10000-20000`），否则 `kubectl exec` 会失败。
>
> - **配置文件**（`/etc/containerd/config.toml`）：
>
>   ```
>   [plugins."io.containerd.grpc.v1.cri"]
>     stream_server_address = "0.0.0.0"       # 监听所有 IP
>     stream_server_port = "10000"            # 固定端口（或范围）
>   ```
>
> **设计动机**：
>
> - **安全性**：隔离流式操作，避免核心 `containerd` 守护进程被攻击。
> - **模块化**：符合 Containerd 轻量级、专注核心运行的定位。
>
> ------
>
> ### **关键差异总结**
>
> | **特性**         | **Docker**                          | **Containerd**             |
> | ---------------- | ----------------------------------- | -------------------------- |
> | **流式处理主体** | `dockerd` 内置支持                  | 独立的 Stream Server 进程  |
> | **架构**         | 单体守护进程                        | 模块化设计（CRI 插件管理） |
> | **K8s 网络配置** | 无需额外配置                        | 需开放节点端口             |
> | **安全隔离**     | 较低（所有功能在 `dockerd` 内运行） | 较高（隔离流式操作）       |
> | **K8s 兼容性**   | 需 `dockershim`（已弃用）           | 原生 CRI 支持              |
>
> ⚠️ **注意**：Kubernetes 已弃用 Docker（移除非 CRI 标准的 `dockershim`），推荐使用 Containerd 或 CRI-O 作为运行时。
>
> ------
>
> ### （拓展）当 k8s 的容器运行时从Docker切换到containerd后，为什么有时会发现 `kubectl exec` 或 `kubectl logs -f` 等交互式命令超时或失败？请解释两者的实现机制有何核心差异。
>
> **回答：**
>
> `kubectl exec` 这类交互式命令在Docker和containerd作为运行时的情况下，其底层的**流式I/O（Stream）处理机制**完全不同，这是导致切换后可能出现问题的根本原因。
>
> 根据文档，两者的核心差异在于**Stream Server的实现方式和位置**：
>
> - **Docker (通过 dockershim)**：
>
> - - **实现方式**：流式处理能力是**内置在Docker守护进程** `dockerd` **内部的**。
>   - **工作流**：当用户执行`kubectl exec`时，请求会通过 `API Server` -> `kubelet` -> `dockershim` 适配层，最终由`dockershim`将CRI的流式请求转换为Docker API调用，并与`dockerd`建立流通道。整个数据流都在`kubelet`和`dockerd`之间通过本地的Unix Socket进行，**无需暴露额外的端口**。
>
> - **containerd (原生CRI)**：
>
> - - **实现方式**：流式处理是由`containerd`的CRI插件动态启动的一个**独立的Stream Server进程**来负责的，这体现了containerd的模块化和安全隔离设计。
>   - **工作流**：当`kubelet`收到流式请求后，它会通过CRI接口向containerd请求，CRI插件会启动Stream Server并返回其**监听的地址和端口**（如 `0.0.0.0:10000`）给`kubelet`，`kubelet`再将这个地址返回给API Server。最关键的一步是，`kubectl`客户端会**直接与目标节点上的这个Stream Server端口建立连接**来传输数据。
>   - **配置要求**：正因为`kubectl`需要直接访问节点上的端口，所以必须在节点的**防火墙或安全组中，放行Stream Server所使用的端口范围**（默认为`10000-20000`）。
>
> **结论：**
> 因此，从Docker切换到containerd后`kubectl exec`失败，最常见的原因就是**节点的防火墙或安全组策略没有为containerd的Stream Server开放所需端口**，导致`kubectl`客户端无法连接到节点上的流处理服务，从而导致超时或失败。
## 三、kubelet配置与日志轮转

### 日志轮转配置步骤
1. **定位kubelet配置**:
   
   ```bash
   systemctl status kubelet  # 查看配置文件路径（如/usr/lib/systemd/system/kubelet.service.d/10-kubeadm.conf）
   ```
2. **修改参数文件**:
   
   - 编辑`/var/lib/kubelet/kubeadm-flags.env`，添加日志参数：
     ```
     KUBELET_KUBEADM_ARGS="--container-log-max-files=5 --container-log-max-size='5Ki'"
     ```
3. **重启服务**:
   ```bash
   systemctl daemon-reload
   systemctl restart kubelet
   ```
## 四、containerd客户端命令

| **命令**       | **来源**                          | **用途**                      | 多命名空间            | 镜像构建           | Pod管理    | 镜像加速 |
| -------------- | --------------------------------- | ----------------------------- | --------------------------------- | --------------------------------- | --------------------------------- | --------------------------------- |
| `crictl`（了解） | Kubernetes                        | 调试容器运行时（兼容CRI）     | 默认`k8s.io`，不可修改（docker也不支持，默认`moby`） | 不支持         | ✔️      | 自动生效 |
| `ctr`          | containerd原生                    | 底层容器管理（镜像/容器操作） | 支持（需`-n`指定）<br />默认有`default`和`k8s.io` | 不支持 | 不支持 | 需手动指定 |
| `nerdctl`        | containerd社区 | 类似Docker的体验（支持Compose等） |支持（需`-n`指定）|✔️ (需buildkit)|不支持|自动生效<br />（自动加载 `/etc/containerd/certs.d` 配置，无需额外参数。）|

> **CRI** ： Kubernetes 为容器运行时定义的标准接口，使得 Kubernetes 可以与不同的容器运行时（如 Docker、Containerd、CRI-O 等）进行通信。
>
> 为什么 `crictl` 不支持多命名空间？
>
> 因为它的设计目标是与容器运行时进行直接交互，而命名空间的管理是 Kubernetes 的职责。如果你需要跨命名空间管理容器，建议使用 `kubectl`。
>
> ### 在采用 `containerd` 的K8s节点上排查问题时，有 `ctr`、`crictl`、`nerdctl` 等多个命令行工具。请简述这三个工具的定位和核心用途，并说明在什么场景下你会优先选择使用哪一个？
>
> **回答：**
>
> | 工具      | 定位与核心用途                                               | 优先使用场景                                                 | 关键注意事项                                                 |
> | --------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
> | `ctr`     | **containerd的原生底层客户端**。它直接与containerd进行低级别交互，用于调试containerd自身或进行核心的镜像、容器操作。  <br />**特点**：支持多命名空间，K8s相关的资源在`k8s.io`空间，其他在`default`空间。操作命令较为底层，不提供用户友好的高级功能。 | 1.  **深度调试containerd**：当怀疑containerd守护进程本身有问题时，使用`ctr`直接操作。守护进程状态检查 (ctr --version)事件监控 (ctr events)<br />2. **跨命名空间管理**：需要操作非K8s（即`default`命名空间）的镜像或容器时。  <br />3. **底层镜像操作**：如调试镜像文件系统（`ctr image mount`，手动挂载镜像检查内容）或管理不同平台的镜像层。 | ⚠️ **不操作 K8s 资源**<br />K8s Pod 在 k8s.io空间<br />修改可能破坏集群状态<br />🚫 无 Pod 概念、无日志查看功能 |
> | `crictl`  | **K8s CRI标准调试工具**。它的设计目标是提供一个统一的、与具体容器运行时无关的接口，用于验证和调试CRI兼容的运行时（如containerd、CRI-O）与kubelet的集成情况。 <br />**特点**：**以Pod为中心**，所有操作都围绕K8s的概念展开（如`crictl pods`、`crictl inspectp`）。它只能看到`k8s.io`命名空间下的资源，无法修改。 | 1. **排查K8s Pod问题**：当`kubectl describe pod`信息不足时，用`crictl ps`查看Pod内的容器状态，用`crictl logs`查看日志，用`crictl inspect`查看容器的底层配置。  <br />2. **验证CRI兼容性**：在部署或升级集群时，用`crictl info`确保kubelet能与容器运行时正常通信。 | 🔒 **只读安全**<br />无创建/删除权限<br />仅查看 k8s.io空间资源<br />📌 命令以 Pod 为中心（pods/inspectp） |
> | `nerdctl` | **兼容Docker CLI的 containerd 高级客户端**。它的目标是为习惯使用Docker命令行的用户提供一个无缝的迁移体验。<br />**特点**：命令和参数与`docker`高度兼容，支持`nerdctl build`（需`buildkit`支持）、`nerdctl login`、`nerdctl compose`等高级功能。它能自动加载镜像加速配置。 | 1. **日常开发与测试**：在节点上进行镜像构建、打标签、推送到私有仓库等开发流程时。  <br />2. **快速运维操作**：当需要一个功能丰富且语法熟悉的工具来快速启动测试容器或管理网络时。  <br />3. **替代Docker CLI**：在已经移除Docker的K8s节点上，作为`docker`命令的直接替代品使用。 | 🌟 **功能增强**<br />支持 Rootless 容器<br />集成 Compose (nerdctl compose)<br />⚠️ 依赖 buildkitd构建镜像 |
>
> **总结我的选择策略：**
>
> - **排查K8s Pod故障**，首选`crictl`，因为它最贴近K8s的视角。
> - **需要构建镜像或进行复杂的镜像管理**，首选`nerdctl`，因为它功能最全且用户体验最好。
> - **怀疑containerd本身工作不正常或需进行底层命名空间操作**时，才会使用`ctr`。
### 消除Warning（可选）

### 1. **crictl配置**

**作用**：配置 `crictl` 连接containerd的运行时端点，避免操作时出现警告。

#### **1. 1 配置方法（二选一）**

##### **方法1：手动创建配置文件**

```sh
cat > /etc/crictl.yaml << 'EOF'
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false
EOF
```

##### **方法2：通过命令自动生成**

```sh
crictl config runtime-endpoint unix:///run/containerd/containerd.sock
crictl config image-endpoint unix:///run/containerd/containerd.sock
```
#### **1.2 验证配置**

```sh
crictl images  # 无警告即配置成功
```
### 2. **nerdctl安装与配置**

#### 2.1 安装nerdctl

```sh
# 下载并解压
wget https://github.com/containerd/nerdctl/releases/download/v1.7.6/nerdctl-1.7.6-linux-amd64.tar.gz
mkdir -p /usr/local/containerd/bin/
tar -zxvf nerdctl-1.7.6-linux-amd64.tar.gz -C /usr/local/containerd/bin/

# 创建软链接至 /usr/local/bin/，保证命令全局可用
ln -s /usr/local/containerd/bin/nerdctl /usr/local/bin/nerdctl

# 验证安装
nerdctl version  # 若提示buildkit未安装，继续下一步
```

#### 2.2 安装bulidkit（依赖项）

**作用**：支持 `nerdctl build` 命令构建镜像。
##### **2.2.1 下载并安装**

```sh
wget https://github.com/moby/buildkit/releases/download/v0.13.2/buildkit-v0.13.2.linux-amd64.tar.gz
tar -zxvf buildkit-v0.13.2.linux-amd64.tar.gz -C /buildkit/

# 解压后得到一个bin目录，把这个bin目录放到$PATH里去
vim /etc/profile
# 添加
export PATH=/buildkit/bin/:$PATH
# 使生效
source /etc/profile

# 当然，也可以使用创建软链接至/usr/local/bin/的方法
ln -s /buildkit/buildkitd /usr/local/bin/buildkitd
ln -s /buildkit/buildctl /usr/local/bin/buildctl
```
##### **2.2.2 配置systemd服务**

```sh
cat > /etc/systemd/system/buildkit.service << EOF
[Unit]
Description=BuildKit
[Service]
ExecStart=/usr/local/bin/buildkitd --oci-worker=false --containerd-worker=true
[Install]
WantedBy=multi-user.target
EOF

# 启动服务
systemctl daemon-reload
systemctl enable --now buildkit
```
##### **2.2.3 验证安装**

```sh
nerdctl version  # 不再提示buildkit警告
buildctl --version  # 输出版本信息
```
## 五、containerd配置镜像加速

或者[在阿里云个人版实例创建镜像仓库、设置构建规则_容器镜像服务(ACR)心](https://help.aliyun.com/zh/acr/user-guide/create-a-repository-and-build-images)

### **1. 新版本配置方法（推荐）**
**核心思想**：将镜像仓库配置独立存放在指定目录中，避免直接修改主配置文件，实现动态加载且无需频繁重启containerd。
#### **1.1 配置步骤**
##### **1.1.1 修改主配置文件**  

编辑 `/etc/containerd/config.toml`，启用镜像仓库独立配置目录：  

```toml
[plugins."io.containerd.grpc.v1.cri".registry]
  config_path = "/etc/containerd/certs.d"  # 指定镜像仓库配置目录
```
**生效操作**：  
```bash
systemctl daemon-reload
systemctl restart containerd

# 后续在/etc/containerd/certs.d中修改配置无需重启
```
##### **1.1.2 镜像仓库目录结构**  

- **目录规则**：  
  第一级目录为镜像仓库的域名或IP地址，第二级为 `hosts.toml` 文件。  
  示例：  
  
  ```bash
  /etc/containerd/certs.d/
  ├── docker.io
  │   └── hosts.toml
  └── 192.168.11.20
      └── hosts.toml
  ```
##### **1.1.3 配置镜像加速示例**  

**场景1：私有Harbor仓库配置**  

1. **创建目录及文件**：  
   ```bash
   mkdir -p /etc/containerd/certs.d/harbor.node.com
   ```
2. **编辑 `hosts.toml`**：  
   
   ```toml
   # 指定了镜像仓库的服务器地址
   server = "https://harbor.node.com"
   
   [host."https://harbor.node.com"] # 加速源
     capabilities = ["pull", "resolve"] # 配置镜像仓库支持的能力
     skip_verify = true  # 跳过HTTPS证书验证
   ```
**场景2：Docker Hub镜像加速**  

1. **创建目录及文件**：  
   ```bash
   mkdir -p /etc/containerd/certs.d/docker.io
   ```
2. **编辑 `hosts.toml`**：  
   ```toml
   server = "https://docker.io"
   
   # 添加多个镜像加速源
   [host."https://registry-1.docker.io"]
     capabilities = ["pull", "resolve"]
   
   [host."https://docker.211678.top"]
     capabilities = ["pull", "resolve"]
   
   [host."https://docker.m.daocloud.io"]
     capabilities = ["pull", "resolve"]
   
   [host."https://dockerproxy.cn"]
     capabilities = ["pull", "resolve"]
   ```
#### **1.2 验证配置**
##### **方法1：使用 `nerdctl`**  

`nerdctl` 自动加载 `/etc/containerd/certs.d` 配置：  

```bash
nerdctl pull docker.io/library/centos:7
```

##### **方法2：使用 `ctr`**  

需显式指定 `--hosts-dir` 参数：  

```bash
ctr image pull docker.io/library/centos:7 --hosts-dir=/etc/containerd/certs.d
```

**预期输出**：  
```bash
docker.io/library/centos:7:	resolved
|++++++++++++++++++++++++++++++++++++++|
manifest-sha256:dead07b4d8ed7e29e98de0f4504d87e8880d4347859d839686a31da35a3b532f: done
...
```
### **2. 旧版本配置方法（已废弃）**
**说明**：直接修改 `/etc/containerd/config.toml`，需重启containerd生效，不推荐长期使用。  

**示例配置**：  
```toml
[plugins."io.containerd.grpc.v1.cri".registry.mirrors]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
    endpoint = ["https://registry-1.docker.io", "https://mirror.aliyuncs.com"]
```
### **3. 常见问题排查**
- **镜像拉取失败**：  

  检查 `hosts.toml` 语法、域名拼写及网络连通性。

- **配置未生效**：  

  确认 `config_path` 路径正确，且无主配置文件中冲突的镜像仓库配置。

- **证书错误**：  

  私有仓库启用 `skip_verify = true` 或提供有效CA证书路径。
## 六、客户端命令详解

### **1. 镜像操作命令**

#### **1.1 命令对比**
| **操作**           | **docker**                              | **ctr（containerd）**                                        | **crictl（Kubernetes）**                                     | **nerdctl**                              |
| ------------------ | --------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------- |
| **查看镜像列表**   | `docker images`                         | `ctr image ls`                                               | `crictl images`                                              | `nerdctl images`                         |
| **拉取镜像**       | `docker pull nginx:alpine`              | `ctr image pull docker.io/library/nginx:alpine`              | `crictl pull nginx:alpine`                                   | `nerdctl pull nginx:alpine`              |
| **打标签**         | `docker tag nginx:alpine my-nginx:v1`   | `ctr image tag nginx:alpine my-nginx:v1`                     | 不支持                                                       | `nerdctl tag nginx:alpine my-nginx:v1`   |
| **推送镜像**       | `docker push my-nginx:v1`               | `ctr image push my-nginx:v1`                                 | 不支持                                                       | `nerdctl push my-nginx:v1`               |
| **删除镜像**       | `docker rmi my-nginx:v1`                | `ctr image rm my-nginx:v1`                                   | `crictl rmi my-nginx:v1`                                     | `nerdctl rmi my-nginx:v1`                |
| **查看镜像详情**   | `docker inspect nginx:alpine`           | 无                                                           | `crictl inspecti nginx:alpine`                               | `nerdctl inspect nginx:alpine`           |
| **导出镜像**       | `docker save -o nginx.tar nginx:alpine` | `ctr image export nginx.tar docker.io/library/nginx:alpine`  | 不支持                                                       | `nerdctl save -o nginx.tar nginx:alpine` |
| **导入镜像**       | `docker load -i nginx.tar`              | `ctr image import nginx.tar`                                 | 不支持                                                       | `nerdctl load -i nginx.tar`              |
| **登录镜像仓库**   | `docker login`                          | 不支持<br />理由：`ctr` 工具主要是用于底层的容器操作和管理，而不是直接与镜像仓库交互 | 不支持<br />理由：`crictl` 工具主要用于管理pod和容器，而不是直接与镜像仓库交互 | `nerdctl login`                          |
| **清理停止的容器** | `docker container prune`                |                                                              |                                                              | `nerdctl container prune`                |
#### **1.2 关键工具详解**
##### **（1）ctr（containerd）**
```bash
# 1. 查看镜像（默认default命名空间）
ctr image ls
ctr image ls -q # 只查看镜像地址
ctr -n k8s.io image ls  # 查看k8s.io命名空间镜像

# 2. 拉取镜像（需指定完整地址）
ctr image pull docker.io/library/nginx:alpine --hosts-dir=/etc/containerd/certs.d

# 3. 导出镜像（需指定名称空间）
ctr -n k8s.io image export coredns.tar.gz registry.cn-hangzhou.aliyuncs.com/google_containers/coredns:v1.11.1

# 4. 导入镜像（处理多平台问题）
ctr image pull --all-platforms docker.io/library/nginx:alpine
ctr image export --all-platforms nginx.tar.gz docker.io/library/nginx:alpine
ctr image import nginx.tar.gz

# 5. 镜像挂载（调试文件系统）
ctr image mount docker.io/library/nginx:alpine /mnt
ctr image unmount /mnt

# 6. 命名空间管理
ctr ns ls             # 列出所有命名空间
ctr ns create test    # 创建新命名空间
cs ns rm yest		  # 删除命名空间
ctr -n test image ls  # 查看特定命名空间镜像

# 补充：重新打标签
tr image tag docker.io/library/nginx:alpine harbor.k8s.local/course/nginx:alpine 
# 具体作用：
# 创建引用：在本地镜像存储中为同一个镜像数据创建一个新的标签（引用）。这意味着 docker.io/library/nginx:alpine 和 harbor.k8s.local/course/nginx:alpine 指向的是同一个镜像数据。
# 准备推送：通过给镜像打上符合私有镜像仓库命名规范的标签，为后续将镜像推送到私有镜像仓库做好了准备。推送时，可以使用这个新标签来指定要推送的镜像。
```
##### **（2） crictl（Kubernetes）**
```bash
# 1. 所有操作默认在k8s.io命名空间
crictl images          # 等同于 `ctr -n k8s.io image ls`

# 2. 镜像拉取（仅限k8s.io空间）
crictl pull nginx:alpine

# 3. 镜像清理（删除未使用镜像）
crictl rmi --prune
```
##### **（3） nerdctl**
```bash
# 1. 镜像构建（依赖buildkit）
# 如果不用-f指定构建的文件，默认找的文件不是dockerfile，而是containerfile
nerdctl build -t test:v1.0 -f Dockerfile .

# 2. 登录镜像仓库
nerdctl login --username=user --password=pass registry.example.com
nerdctl logout registry.example.com

# 3. 多平台构建（需buildkit支持）
nerdctl build --platform=linux/amd64,linux/arm64 -t multi-arch:v1 .
```
#### **1.3 镜像构建依赖（nerdctl）**
##### 安装buildkit
```bash
# 下载并解压
wget https://github.com/moby/buildkit/releases/download/v0.13.2/buildkit-v0.13.2.linux-amd64.tar.gz
tar -zxvf buildkit-v0.13.2.linux-amd64.tar.gz -C /usr/local/

# 创建软链接
ln -s /usr/local/bin/buildkitd /usr/local/bin/buildkitd
ln -s /usr/local/bin/buildctl /usr/local/bin/buildctl

# 配置systemd服务
cat > /etc/systemd/system/buildkit.service << EOF
[Unit]
Description=BuildKit
[Service]
ExecStart=/usr/local/bin/buildkitd --oci-worker=false --containerd-worker=true
[Install]
WantedBy=multi-user.target
EOF

# 启动服务
systemctl daemon-reload
systemctl enable --now buildkit
```
### **2. 容器操作命令**

#### **2.1 命令对比**
| **操作**             | **docker**                | **ctr（containerd）**                  | **crictl（Kubernetes）**  | **nerdctl**                |
| -------------------- | ------------------------- | -------------------------------------- | ------------------------- | -------------------------- |
| **查看运行中容器**   | `docker ps`               | `ctr task ls`/`ctr container ls`       | `crictl ps`               | `nerdctl ps`               |
| **创建容器**         | `docker create`           | `ctr container create`                 | `crictl create`           | `nerdctl create`           |
| **运行容器**         | `docker run -d nginx`     | `ctr run -d nginx`                     | 不支持（以Pod为单位）     | `nerdctl run -d nginx`     |
| **启动/停止容器**    | `docker start/stop <ID>`  | `ctr task start/kill <ID>`             | `crictl start/stop <ID>`  | `nerdctl start/stop <ID>`  |
| **删除容器**         | `docker rm <ID>`          | `ctr container rm <ID>`                | `crictl rm <ID>`          | `nerdctl rm <ID>`          |
| **进入容器执行命令** | `docker exec -it <ID> sh` | `ctr task exec --exec-id 0 -t <ID> sh` | `crictl exec -it <ID> sh` | `nerdctl exec -it <ID> sh` |
| **查看容器日志**     | `docker logs <ID>`        | 无                                     | `crictl logs <ID>`        | `nerdctl logs <ID>`        |
| **查看容器详情**     | `docker inspect <ID>`     | `ctr container info <ID>`              | `crictl inspect <ID>`     | `nerdctl inspect <ID>`     |
| **清空不用的容器**   | `docker image prune`      | 无                                     | `crictl rmi --prune`      | `nerdctl image prune`      |
#### **2.2 关键工具详解**
##### **（1）ctr（containerd）**
```bash
# 1. 创建容器(前提：镜像存在)
ctr container create docker.io/library/nginx:alpine nginx

# 2. 启动容器（任务管理）
ctr task start -d nginx   # 启动
ctr task ls               # 查看“运行中”任务
ctr task pause nginx      # 暂停
ctr task resume nginx     # 恢复
ctr task kill nginx       # 终止
ctr task rm nginx         # 删除任务（必须先kill）

# 3. 进入容器(id随便取，只要独一无二就行)
ctr task exec --exec-id 0 -t nginx sh

# 4. 查看资源使用
ctr task metrics nginx    # CPU/内存监控
ctr task ps nginx         # 查看宿主机PID
```
##### **（2）nerdctl**
```bash
# 1. 运行容器（支持Docker参数）
nerdctl run -d -p 80:80 --name=nginx --restart=always nginx:alpine

# 2. 容器管理
nerdctl stop nginx        # 停止
nerdctl rm -f nginx       # 强制删除
nerdctl logs -f nginx     # 实时日志

# 3. 容器网络
nerdctl network ls        # 查看网络
nerdctl network create mynet
```
### **3. Pod操作命令（仅crictl支持）**
```bash
# 1. 查看Pod列表
crictl pods

# 2. 查看Pod详情
crictl inspectp <Pod_ID>

# 3. 删除Pod
crictl rmp <Pod_ID>
```
### **4. 通用操作与调试**
#### **4.1 清理无用资源**
```bash
# 清理未使用镜像
docker image prune
nerdctl image prune
crictl rmi --prune

# 清理停止的容器
docker container prune
nerdctl container prune
```

#### **4.2查看帮助**
```bash
docker --help/h
ctr --help/h
crictl --help/h
nerdctl --help/h
```
### **5. 注意事项**
1. **ctr命名空间**:
   - 默认操作在`default`命名空间，Kubernetes相关镜像在`k8s.io`。
   - 拉取镜像时需指定完整地址（如`docker.io/library/nginx:alpine`）。

2. **crictl限制**:
   - 所有操作默认在`k8s.io`命名空间，无法修改。
   - 仅用于调试Kubernetes管理的容器，不推荐直接操作。

3. **nerdctl兼容性**:
   - 支持大部分Docker命令，但构建依赖`buildkit`。
   - 镜像加速配置自动加载`/etc/containerd/certs.d`。

4. **镜像导入导出**:
   - 使用`ctr`导入时需处理多平台问题（`--all-platforms`）。
   - `nerdctl save/load`与Docker完全兼容。
## 七、关键路径与调试

### 1. 常见路径
- **containerd日志**: `/var/log/containerd/`
- **kubelet日志**: `/var/log/kubelet.log`
- **静态Pod配置**: `/etc/kubernetes/manifests/`

### 2. 排错场景
- **容器运行时错误**: 检查containerd日志及服务状态。
- **节点NotReady**: 检查kubelet日志及网络插件状态。



