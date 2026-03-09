---
title: "Ingress"
draft: false
tags: ["k8s", "基础", "网络"]
---

## **一、储备知识**
### **1. Service 对外暴露服务的两种类型**
- **NodePort**：  
  
  在集群节点的指定端口（30000-32767）暴露服务，适用于小规模集群或自建负载均衡场景。
  
- **LoadBalancer**：  
  
  自动创建云厂商的负载均衡器（如 AWS ELB、GCP CLB），适用于云环境和大规模集群。

### **2. 单体服务 vs 微服务**
| **类型**     | **特点**                                                     |
| ------------ | ------------------------------------------------------------ |
| **单体服务** | 整个应用由一个服务构成，所有功能集中在一个代码库中。         |
| **微服务**   | 应用拆分为多个独立服务，每个服务单独部署、监听端口，通过 RESTful API 通信。 |

> **K8s 优势**：天然适合运行微服务架构，支持动态扩缩容和故障自愈。
### **3. 暴露单体服务**
#### **1. 部署模式**
- 单体服务运行在一个或多个 Pod 中（由 Deployment/StatefulSet 管理）。
- 通过 Service 代理 Pod，选择 `NodePort` 或 `LoadBalancer` 类型对外暴露。

#### **2. 两种暴露方案**

<img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/c819963c020b730acd5ac44492c67f7938446735.jpg" alt="img" style="zoom: 20%;" />

| **方案**                      | **适用场景**                                          | **流程**                                                     |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| **NodePort + 自建负载均衡**   | 小规模集群，需手动管理负载均衡（如 HAProxy、Nginx）。 | 用户请求 → 外部负载均衡（IP:Port） → 节点 IP:NodePort → kube-proxy → Pod IP:Port。 |
| **LoadBalancer + 云负载均衡** | 云环境，自动管理负载均衡（如 AWS ELB）。              | 用户请求 → 云负载均衡（IP:Port） → 节点 IP:NodePort → kube-proxy → Pod IP:Port。 |

> - 负载均衡器提供一个**稳定、单一的访问入口点**（通常是 **VIP 或域名**）。
> - 负载均衡器持续**监控后端节点（NodePort）的健康状态**。如果某个节点不健康（如 TCP 连接失败、HTTP 状态码异常），负载均衡器会自动将其从后端池中移除，不再将流量路由给它。当节点恢复健康后，再自动加回。客户端完全感知不到后端节点的故障和恢复。

#### **3. 总结**
- 单体服务只需一个 Service 对外暴露，负载均衡逻辑由外部或云平台完成。
### **4. 暴露微服务**
#### **1. 核心挑战**
- 每个微服务独立部署，需单独创建 Service 代理。
- 需要统一入口进行 **七层流量分发**（如按 HTTP 路径转发到不同微服务）。

#### **2. 引入 Ingress**
- **作用**：作为集群内七层负载均衡器，根据规则（如 URI 路径、域名）将请求路由到后端 Service。
- **组成**：  
  - **Ingress Controller**：运行在 Pod 中的反向代理（如 Nginx、Traefik），负责流量转发。  
    - **正向代理**：
      - 位于**客户端（用户）和互联网之间**，代表**客户端**向外部服务器发起请求，隐藏客户端身份（如公司内网代理/VPN）。
    - **反向代理**：
      - 位于**服务端（服务器集群）和客户端之间**，代表**服务器**接收客户端请求，将请求转发给后端真实服务器，隐藏服务器细节。
  - **Ingress 资源**：定义路由规则的 K8s 对象（YAML 配置）。

#### **3. Ingress 架构**
```text
用户请求
│
↓
外部负载均衡（NodePort/LoadBalancer）：暴露 ingress pod 的 svc
│
↓
Ingress Controller（Pod 中的 Nginx） → 根据 Ingress 规则路由
│
↓
目标微服务的 Service → Pod
```
### **5. 关键总结**
| **维度**         | **单体服务**                | **微服务**                                 |
| ---------------- | --------------------------- | ------------------------------------------ |
| **Service 数量** | 1 个 Service 暴露所有功能。 | 每个微服务对应一个 Service。               |
| **流量入口**     | 直接通过 Service 暴露。     | 依赖 Ingress 作为统一入口，按规则路由。    |
| **负载均衡层级** | 四层（TCP/UDP）负载均衡。   | 七层（HTTP/HTTPS）负载均衡，支持路径分发。 |
| **适用场景**     | 简单应用，功能集中。        | 复杂应用，模块解耦，独立扩展。             |
## 二、介绍

#### 1. **Ingress 是什么？**
- **定义**：Ingress 是 K8s 中一种**七层（应用层）流量转发机制**，实现七层负载均衡。

- **工作原理**：
  - 当请求到达 Ingress 时，会**匹配 URL 的路径部分**。
  
  - 根据路径规则，将请求分发到不同的后端 Service（Service 简称 `svc`）。
  
    <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/9aea6fdd12e3d36aa0a314aa53ba5f0638446735.jpg" alt="img" style="zoom: 50%;" />
  
- **与 Service 的关系**：
  - Service 接收到请求后，基于标签选择器（Label Selector）找到匹配的 Pod，并通过负载均衡策略（如 IPVS）将请求转发到目标 Pod。
  - **关键条件**：Service 的负载均衡能力依赖于其 `ClusterIP`（需显式或隐式分配）。
#### 2. **为何使用 Ingress？**
- **核心目的**：通过七层负载均衡将微服务重新整合成一个整体，对外提供统一入口。
- **优势**：
  - 统一管理多个微服务的访问入口。
  - 支持基于 URL 路径的精细化路由策略。
  - 避免为每个微服务单独暴露外部访问端点。
#### 3. **引入 Ingress 后的完整流量路径**
![image-20250424152946127](https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250424152946127.png)

1. **用户发起请求**

   → 用户通过浏览器或客户端访问应用的公网域名（如 `app.example.com`）。
   → DNS 解析该域名到 ​**​外部负载均衡的公网 IP​**​。

2. **负载均衡转发至集群节点**

   → 外部负载均衡将流量分发到 K8s 集群的 ​**​某个节点的 `NodePort`​**​（端口范围 30000-32767）。
   → 目标地址为：`节点的物理 IP:NodePort`。
   ​**​注​**​：此处的 NodePort 是暴露 `Ingress Controller` 的 Service（类型为 `NodePort` ）。

   - 若 Service 类型为 `LoadBalancer`：**用户发起请求** -> **DNS 解析到云 LB 的公网 VIP** -> **云 LB 直接将流量路由到后端健康的 `Ingress Controller Pod`**（PodIP:targetPort） -> 4、5步

3. **Ingress Controller Service 路由**

   → 节点上的 `kube-proxy` 通过 ​**​iptables/ipvs 规则​**​，将 `NodePort` 的流量转发到后端的 ​**​Ingress Controller Pod​**​（如 Nginx Pod）。
   → 此步骤由 `Ingress Controller` 专属的 Service 实现。

4. **Ingress Controller 处理 L7 路由**

   → Ingress Controller（如 Nginx）解析 HTTP(S) 请求的 ​**​Host 头、URL 路径​**​（如 `/api` 或 `/static`）。
   → 根据预定义的 ​**​Ingress 资源规则​**​，将请求转发到对应的后端 Service。

5. **后端 Service 到 Pod**

   → 请求到达目标 Service（如 `svc1`）。
   → `kube-proxy` 再次通过 ​**​iptables/ipvs​**​ 执行负载均衡，将流量分发到 ​**​Service 关联的 Pod​**​（如 `pod1`, `pod2`, `pod3`）。
   → 最终由 Pod 中的容器处理请求并返回响应。
## 三、 **Ingress 对象与 Ingress Controller**
### 1. **Ingress 控制器（Ingress Controller）**
- **作用**：运行在 Pod 中的负载均衡软件（如 Nginx、Traefik），负责实际流量转发。
- **核心功能**：
  1. 监听 K8s API 中 Ingress 对象的配置变更，动态更新负载均衡规则。
  2. 将请求转发给 Service 时，使用 Service 的 **FQDN（全限定域名）** 而非 IP（依赖 k8s 的 CoreDNS 解析）。
- **管理机制**：
  - 由 K8s 控制器（如 Deployment、DaemonSet）管理，确保 Pod 的自愈能力。
  - 控制器组件通常包含两部分：
    - **七层负载均衡软件**（如 Nginx）。
    - **守护进程**：负责监听配置变更并更新负载均衡规则。

### 2. **Ingress 对象（Ingress Resource）**
- **定义**：一种 K8s 资源，通过 YAML 清单声明路由规则，用于**向 Ingress 控制器注入配置**。
- **功能**：
  - 定义 URL 路径 与 Service 的映射关系。
  - 配置 TLS 证书、重定向规则等高级特性。
- **与控制器关系**：
  - Ingress 控制器持续监听 Ingress 对象的变化，并实时更新负载均衡配置。
## 四、Ingress 的部署方案
### **方案 1：需要创建 Service（非 `hostNetwork` 模式）**

- **核心特点**：
  - Ingress Controller Pod **不直接使用宿主机网络**，通过 Service 对外暴露。
  - 需使用 **Deployment 控制器** 部署 Ingress Controller Pod。
  - 根据 Service 类型分为两种子方案：

#### **1.1 Service 类型为 `LoadBalancer`**

- **适用场景**：
  - 云服务环境（如 AWS、GCP、阿里云等），支持自动创建云负载均衡器。
- **工作流程**：
  1. Deployment 创建 Ingress Controller Pod（非 `hostNetwork`）。
  2. Service 类型为 `LoadBalancer`，自动分配外部 IP（或域名）。
  3. 云平台为该 Service 创建负载均衡器，将流量转发到 Ingress Pod。
- **优点**：
  - 自动集成云平台负载均衡器，支持高可用和弹性伸缩。
  - 无需手动管理节点 IP 或端口。
- **缺点**：
  - 依赖云平台功能，本地环境（如裸金属集群）无法使用。

#### **1.2 Service 类型为 `NodePort`**

- **适用场景**：

  - 本地或混合环境（无云负载均衡器支持）。

- **工作流程**：

  1. Deployment 创建 Ingress Controller Pod（非 `hostNetwork`）。
  2. Service 类型为 `NodePort`，在集群所有节点上开放固定端口（如 30000-32767）。
  3. 外部流量通过节点的 IP + 端口访问 Ingress Controller。

- **优点**：

  - 适用于非云环境。
  - 灵活性高，可手动配置外部负载均衡器（如 HAProxy、Nginx）。

- **缺点**：

  - 需手动维护节点 IP 列表和端口映射。
  - 流量路径较长：`客户端 → NodePort → Service → Ingress Controller Pod → Service → Pod`。

- **部署示例**：

  - **下载 yaml**：

    下载部署 ingress-controller 的 yaml 文件（含 Deployment 创建 Ingress Controller Pod 以及 Service）

    ```bash
    wget --no-check-certificate https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.1/deploy/static/provider/cloud/deploy.yaml
    ```

    最新版本见下述地址：

    https://github.com/kubernetes/ingress-nginx/blob/main/deploy/static/provider/baremetal/deploy.yaml

  - **修改 yaml 文件的镜像地址**：

    修改 yaml 文件的镜像地址为我们私人仓库中对应的镜像地址

  -  **应用与测试**：

    - **创建服务**：

      创建服务1：gowebip，service名为gowebip，端口为8888

      ```yaml
      # gowebip-svc.yaml
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        labels:
          app: gowebip
        name: gowebip
      spec: 
        replicas: 2
        selector: 
          matchLabels:
            app: gowebip     
        strategy: {}
        template:                
          metadata:
            labels:
              app: gowebip
          spec:                  
            containers:
            - image: nginx:1.18
              name: nginx
apiVersion: v1
      kind: Service
      metadata:
        creationTimestamp: null
        labels:
          app: gowebip
        name: gowebip
      spec:
        ports:
        - port: 8888
          protocol: TCP
          targetPort: 80
        selector:
          app: gowebip
        type: ClusterIP
      status:
        loadBalancer: {}
      ```

      创建服务1：gowebhost，service名为gowehost，端口为9999

      ```yaml
      # gowebhost-svc.yaml
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        labels:
          app: gowebhost
        name: gowebhost
      spec: 
        replicas: 2
        selector: 
          matchLabels:
            app: gowebhost     
        strategy: {}
        template:                
          metadata:
            labels:
              app: gowebhost
          spec:                  
            containers:
            - image: nginx:1.18
              name: nginx
apiVersion: v1
      kind: Service
      metadata:
        creationTimestamp: null
        labels:
          app: gowebhost
        name: gowebhost
      spec:
        ports:
        - port: 9999
          protocol: TCP
          targetPort: 80
        selector:
          app: gowebhost
        type: ClusterIP
      status:
        loadBalancer: {}
      ```

      应用

      ```bash
      kubectl apply -f gowebip-svc.yaml
      kubectl apply -f gowebhost-svc.yaml
      ```

    - **创建 ingress 对象资源**：

      ```yaml
      apiVersion: networking.k8s.io/v1  # kubectl explain ingress.apiVersion，用之前查一下，以免出错
      kind: Ingress
      metadata:
        name: ingress-test
        namespace: default
        annotations:
          # kubernetes.io/ingress.class: "nginx" 旧版本
          # 开启use-regex，启用path的正则匹配 
          nginx.ingress.kubernetes.io/use-regex: "true"
      spec:
        ingressClassName: nginx # 新版本
        rules:
          # 定义域名
          - host: test.ingress.com # nginx.conf有对应的配置，即server_name test.ingress.com，若使用 ip 会无法对应，导致无法进行转发
            http:
              paths:
                # 不同path转发到不同端口
                - path: /ip
                  pathType: Prefix
                  backend:
                    service:
                      name: gowebip # FQDN
                      port: 
                        number: 8888
                - path: /host
                  pathType: Prefix
                  backend:
                    service:
                      name: gowebhost
                      port: 
                        number: 9999
      ```
    
  **ingress 对象资源详解**
    
  - **`ingressClassName: nginx` 字段**：
    
    > 总结：一个**关联器**，用来指定当前这个Ingress规则应该由集群中的哪一个Ingress控制器（如Nginx、Traefik）来处理和生效。这在集群中存在多个不同类型的Ingress控制器时至关重要。
    
    - **关联Ingress资源与控制器**
          - 当集群中存在**多个Ingress控制器**（如Nginx、Traefik、HAProxy等）时，通过`ingressClassName`字段明确该Ingress规则由哪个控制器生效。
    
    - **工作原理**：
    
      - **依赖IngressClass资源**
    
        - `ingressClassName`的值需对应集群中已定义的**IngressClass资源名称**。
    
        - IngressClass定义了控制器的类型及其实现。例如：
    
          ```yaml
              apiVersion: networking.k8s.io/v1
              kind: IngressClass
              metadata:
                name: nginx  # 此名称需与Ingress中的`ingressClassName`匹配
                annotations: # 将nginx设置为默认的 Ingress 控制器
                  ingressclass.kubernetes.io/is-default-class: "true"
              spec:
                controller: k8s.io/nginx  # 指定控制器类型（如Nginx）
              ```
    
      - **控制器监听机制**
    
        - Ingress控制器（如Nginx Ingress Controller）会监听**匹配其IngressClass名称**的Ingress资源。（在控制器的yaml文件有相关配置）
    
        - **Q：如果 Ingress 资源和控制器的命名空间不同，是否会影响路由？**
    
          - **不会**。只要控制器配置为监听所有命名空间（默认行为），无论 Ingress 资源在哪个命名空间，均会被正确处理。
    
        - **Q：如何限制控制器仅处理特定命名空间的 Ingress 资源？**
    
          - 在控制器启动参数中添加 `--watch-namespace=<namespace>`，例如：
    
            ```yaml
                # deploy.yaml（Nginx 控制器配置片段）
                args:
                  - /nginx-ingress-controller
                  - --watch-namespace=default  # 仅监听 default 命名空间
                ```
    
    - K8s 集群中存在多个 Ingress 控制器集群时，为了指定默认的 Ingress 控制器，可以将一个 IngressClass 对象的 `ingressclass.kubernetes.io/is-default-class` 注解设置为 `true`。这样，任何未明确指定 ingressClassName 的 Ingress 对象都会自动使用这个默认的 IngressClass。如果集群中**多个 IngressClass 被标记为默认**，**准入控制器会阻止创建新的未指定 ingressClassName 的 Ingress 对象**。因此，最佳实践是**确保集群中最多只有一个 IngressClass 被标记为默认**。
    
  - **`rules`字段**：
    
    - **作用**：定义请求的路由转发规则，控制流量如何从 Ingress 控制器分发到后端服务。
    
    - **组成**：
    
      - `host`：匹配请求的域名。
    
        - **功能**：匹配 HTTP 请求头中的 `Host` 字段值，支持两种匹配方式：
              - **精确匹配**：`host: test.ingress.com`（仅匹配该域名）。
              - **通配符匹配**：`host: *.example.com`（匹配所有子域名，如 `app.example.com`、`api.example.com`）。
            - **注意事项**：
              - 若省略 `host`，规则将匹配 **所有域名和 IP 的请求**。
              - 通配符仅支持前缀匹配（如 `*.example.com`），且大多数控制器不支持后缀通配符（如 `example.*`）。
    
      - `http.paths`：
    
        - **功能**：定义路径规则列表，每个路径包含：
    
          - `path`：URL 路径（如 `/api`）。
    
          - `pathType`：
    
            - **作用**：定义路径匹配的规则类型，支持以下三种：
    
              | **类型**                   | **行为**                                                 | **示例**                                     |
                  | :------------------------- | :------------------------------------------------------- | :------------------------------------------- |
                  | **Exact**                  | 精确匹配路径（区分大小写）。                             | `/api` 仅匹配 `/api`，不匹配 `/api/`。       |
                  | **Prefix**                 | 前缀匹配（区分大小写）。                                 | `/docs` 匹配 `/docs`、`/docs/`、`/docs/v1`。 |
                  | **ImplementationSpecific** | 匹配逻辑由 Ingress 控制器决定（如 Nginx 的正则表达式）。 | 取决于控制器实现。                           |
    
            - 所有路径必须显式指定 `pathType`。
    
            - **优先级**：当多个路径重叠时，优先级顺序为 `Exact` > `Prefix` > `ImplementationSpecific`。
    
          - `backend`：关联的后端服务或资源。
    
            - **功能**：定义流量转发的目标，支持两种后端类型（**互斥**，不可同时配置）：
                  - **Service 后端**：关联 K8s Service。
                  - **Resource 后端**：关联自定义资源（如对象存储）。
    
      - **匹配逻辑**：
    
        - 请求需同时满足 `host` 和 `path` 规则才会被转发到指定后端。

### **方案 2：无需创建 Service（`hostNetwork` 模式）**

- **核心特点**：
  - Ingress Controller Pod **直接使用宿主机网络**，无需通过 Service 暴露。
  - 使用 **DaemonSet 控制器** 部署 Ingress Controller Pod。
- **工作流程**：
  1. DaemonSet 在指定节点（通常为边缘节点）上部署 Ingress Controller Pod，并启用 `hostNetwork: true`。
  2. Ingress Controller Pod 直接监听宿主机的 80/443 端口。
  3. 外部流量通过节点 IP + 端口直接访问 Ingress Controller Pod。
- **优点**：
  - **转发路径更短，效率更高**：省去 Service 转发环节，流量直达 Ingress Controller Pod。
- **缺点**：
  - **端口冲突风险**：若宿主机已占用 80/443 端口，Pod 无法启动。在部署之前要记得检查。
- **部署示例**：
  - **修改 deploy.yaml**（之前下载的部署 ingress-controller 的 yaml 文件）：
    - 注释 ingress-nginx-controller 的 svc
    - 修改 Kind 为 Daemonset
    - 把 DaemonSet 不支持的字段（`apply` 报错的时候会显示）都注释掉
    - 设置`.template.spec.hostNetwork: true`

## 五、构建 TLS 站点

访问的是后端服务的 443 端口（https），同样要确保 443 端口不被占用。

### 1. 准备证书

```sh
openssl genrsa -out tls.key 2048
openssl req -new -x509 -key tls.key -out tls.crt -subj/C=CN/ST=ShangHai/L=ShangHai/0=Ingress/CN=test.ingress.com # 证书的域名要与 ingress 资源的 host 一致
```

### 2. 生成 Secret

```sh
# 创建一个 TLS 类型的 Secret，名称为 ingress-tls，指定证书文件 tls.crt，私钥文件 tls.key。
kubectl -n default create secret tls ingress-tls --cert=tls.crt --key=tls.kry
```

### 3. 修改 ingress 对象的 yaml 文件

指定 secretName，引用包含 `test.ingress.com` 的公用名称的证书

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-test
  namespace: default
  annotations:
    nginx.ingress.kubernetes.io/use-regex: "true"
spec:
  # 新增配置
  tls:
    - hosts:
      - test.ingress.com
      secretName: ingress-tls
  ingressClassName: nginx
  rules:
    - host: test.ingress.com 
      http:
        paths:
          - path: /ip
            pathType: Prefix
            backend:
              service:
                name: gowebip
                port: 
                  number: 8888
          - path: /host
            pathType: Prefix
            backend:
              service:
                name: gowebhost
                port: 
                  number: 9999
```

## 六、nginx ingress常用语法（了解）

[Ingress-Nginx Controller](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/#service-upstream)

### 1. 域名重定向（不能重定向至 /）

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-test
  namespace: default
  annotations:
    # 域名重定向
    nginx.ingress.kubernetes.io/rewrite-target: https://www.baidu.com
spec:
  ingressClassName: nginx
  rules:
    - host: test.ingress.com 
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gowebip
                port: 
                  number: 8888
```

`http://test.ingress.com` -> `https://www.baidu.com`

### 2. 设置 ingress 白名单

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-test
  namespace: default
  annotations:
    # 设置 ingress 白名单
   nginx.ingress.kubernetes.io/whitelist-source-range: 192.168.71.12,192.168.71.13
spec:
  ingressClassName: nginx
  rules:
    - host: test.ingress.com 
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gowebip
                port: 
                  number: 8888
```

只能在192.168.71.12,192.168.71.13这两台机器上访问成功 `curl test.ingress.com`，其他的机器都会报`403 Forbidden`

### 3. 域名永久重定向

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-test
  namespace: default
  annotations:
    # 设置 ingress 白名单
   nginx.ingress.kubernetes.io/permanent-redirect: https://www.baidu.com
spec:
  ingressClassName: nginx
  rules:
    - host: test.ingress.com 
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gowebip
                port: 
                  number: 8888
```

### 4. 使用正则方式匹配

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress-test
  namespace: default
  annotations:
    # 启用 path 的正则匹配
    nginx.ingress.kubernetes.io/use-regex: "true"
spec:
  ingressClassName: nginx
  rules:
    - host: test.ingress.com 
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: gowebip
                port: 
                  number: 8888
```
## 七、发布策略
### **1. 发布的核心概念**
- **定义**：发布是将新版本代码部署到生产环境并替换旧版本的过程。
- **核心挑战**：
  1. **服务中断**：发布期间可能导致短暂的服务不可用。
  2. **回滚困难**：新版本出现问题时需快速恢复至旧版本。
- **核心目标**：**最小化停机时间**，确保服务持续可用。
### **2. 滚动发布（Rolling Update）**
##### **定义与流程**
- **流程**：
  1. 逐步替换旧版本实例：先启动新版本实例，再停止一个旧版本实例，循环直至全部替换。
  2. 例如：原环境有 10 个实例，每次新增 1 个新实例，同时停用 1 个旧实例。
- **关键特点**：
  - **单套环境**：新老版本在发布过程中共存。
  - **平滑过渡**：逐实例替换，用户无感知。

##### **优缺点**
| **优点**                                                     | **缺点**                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. **资源节省**：仅需少量额外资源（如新增 1 台机器）。<br>2. **最小停机时间**：用户请求不会完全中断。<br>3. **简单易用**：K8s 原生支持。 | 1. **稳定性风险**：新老版本共存，问题定位困难。<br>2. **缺乏流量控制**：无法隔离新版本流量。 |

##### **适用场景**
- 小版本迭代或非关键服务更新。
- 资源有限的环境。
### **3. 蓝绿发布（Blue-Green Deployment）**
##### **定义与流程**
- **流程**：
  1. **双环境部署**：  
     - **蓝环境（Blue）**：运行旧版本。  
     - **绿环境（Green）**：部署新版本。  
  2. **流量切换**：通过负载均衡器将流量从蓝环境逐步切换到绿环境（如先切 20% 流量，验证后全量切换）。  
  3. **回滚机制**：若新版本异常，立即将流量切回蓝环境。（负载均衡移除绿环境的实例，让流量全部达到蓝环境）

- **关键特点**：
  - **环境隔离**：新旧版本完全独立，无共存。
  - **资源冗余**：需维护两套相同规模的环境（如原 10 台机器，新环境也需 10 台）。

##### **优缺点**
| **优点**                                                     | **缺点**                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. **快速回滚**：直接切回旧环境，恢复时间短。<br>2. **零共存风险**：新旧版本完全隔离。<br>3. **流量精准控制**：支持按比例分配流量。 | 1. **资源消耗翻倍**：需维护两套环境。<br>2. **部署成本高**：适用于关键业务或高可用场景。 |

##### **适用场景**
- 大版本更新或关键业务发布。
- 需要严格验证新版本稳定性的场景。
### **4. 金丝雀发布（Canary Release）**
##### **定义与流程**
- **流程**：
  1. **小范围部署**：先部署少量新版本实例（如 10% 的实例）。
  2. **流量控制**：将部分用户请求（如 5% 流量）导向新版本。
  3. **逐步验证**：根据监控指标（错误率、延迟等）逐步扩大流量比例，直至全量切换。

- **关键特点**：
  - **流量维度控制**：基于请求比例分发流量，不区分用户特征。
  - **渐进式验证**：通过小范围试错降低风险。

##### **优缺点**
| **优点**                                                     | **缺点**                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. **风险可控**：问题仅影响少量用户。<br>2. **资源占用低**：仅需少量新实例。<br>3. **快速迭代**：适合频繁发布。 | 1. **流量分配复杂度高**：需依赖负载均衡器或服务网格（如 Istio）。<br>2. **用户无感知差异**：无法定向测试特定用户群体。 |

##### **适用场景**
- 新功能上线前的稳定性验证。
- 修复关键问题后的补丁测试。
- 多版本功能 A/B 测试。
### **5. 灰度发布（Gray Release）**
##### **定义与流程**
- **流程**：
  1. **用户筛选**：按用户特征（如地理位置、用户 ID、设备类型）选择部分用户作为“小白鼠”。
  2. **定向发布**：仅向选定用户开放新功能。
  3. **反馈收集**：根据用户反馈或监控数据决定是否全量发布。

- **关键特点**：
  - **用户维度控制**：基于用户特征定向分发流量。
  - **业务导向**：常用于功能试水或 A/B 测试。

##### **优缺点**
| **优点**                                                     | **缺点**                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1. **精准用户测试**：定向验证特定用户群体。<br>2. **降低舆论风险**：问题仅影响小部分用户。<br>3. **数据驱动决策**：基于反馈优化功能。 | 1. **实现复杂**：需集成用户标识与流量管理工具。<br>2. **依赖用户画像**：需提前定义用户特征。 |

##### **适用场景**
- 新功能试运行或用户体验优化。
- 需要收集用户反馈的场景（如电商促销活动）。
### **6. 策略对比与总结**
| **策略**       | **核心维度** | **资源消耗** | **回滚速度** | **适用场景**             |
| -------------- | ------------ | ------------ | ------------ | ------------------------ |
| **滚动发布**   | 实例替换     | 低           | 慢           | 非关键服务、资源受限环境 |
| **蓝绿发布**   | 环境切换     | 高           | 快           | 关键业务、大版本更新     |
| **金丝雀发布** | 流量比例     | 中           | 中           | 频繁迭代、逐步验证       |
| **灰度发布**   | 用户特征     | 中           | 中           | 功能试水、A/B 测试       |

##### **核心区别**
- **蓝绿 vs 金丝雀**：  
  - 蓝绿以环境为单位切换流量，金丝雀以流量比例控制范围。  
  - 蓝绿需全量资源冗余，金丝雀仅需部分实例。  
- **金丝雀 vs 灰度**：  
  - 金丝雀基于流量比例，不区分用户；灰度基于用户特征定向分发。  
  - 灰度是金丝雀的扩展，支持更精细的用户分组。
## 八、Ingress-金丝雀发布

金丝雀发布的流量控制分为两类：**基于权重**和**基于用户请求**。以下是具体实现方式：
### **1. 基于权重（Canary by Weight）**
- **原理**：按比例分配流量到新旧版本（如 10% 到新版本，90% 到旧版本）。  
- **实现工具**：Nginx Ingress Controller（通过注解配置）。  
- **配置示例**：  
  ```yaml
  # 主 Ingress（处理 90% 流量）
  apiVersion: networking.k8s.io/v1
  kind: Ingress
  metadata:
    name: main-ingress
    annotations:
      nginx.ingress.kubernetes.io/canary: "false"  # 非金丝雀规则，默认，不设置也行
  spec:
    rules:
      - host: example.com
        http:
          paths:
            - path: /
              backend:
                service:
                  name: old-service
                  port: 88
  ```
  
  ```yaml
  # 金丝雀 Ingress（处理 10% 流量）
  apiVersion: networking.k8s.io/v1
  kind: Ingress
  metadata:
    name: canary-ingress
    annotations:
      nginx.ingress.kubernetes.io/canary: "true"          # 启用金丝雀
      nginx.ingress.kubernetes.io/canary-weight: "10"      # 10% 流量到新版本，会向nginx的配置文件的 upstream 模块添加 server main:88 weigh=9;server canary:88 weigh=1 
  spec:
    rules:
      - host: example.com
        http:
          paths:
            - path: /
              backend:
                service:
                  name: new-service
                  port: 88
  ```
- **注意事项**：  
  - 权重范围：`0-100`，总和超过 100 时按比例分配。  
  - **主 Ingress 与金丝雀 Ingress 需共享相同 `host` 和 `path`**。  
  - 动态调整：可通过工具（如脚本、CI/CD 流水线）逐步增加 `canary-weight`。
### **2. 基于用户请求（Canary by Header/Cookie）**
- **原理**：根据 HTTP 请求中的 **Header** 或 **Cookie** 值定向流量到新版本。  
- **常见场景**：  
  - 内部测试：仅公司员工（特定 Header）访问新版本。  
  - 地域测试：特定地区用户（通过 Header 标识）体验新功能。  

##### **2.1 基于 Header（Canary by Header）**
- **配置示例**：  
  ```yaml
  apiVersion: networking.k8s.io/v1
  kind: Ingress
  metadata:
    name: canary-ingress
    annotations:
      nginx.ingress.kubernetes.io/canary: "true"
      nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"      # 检查 Header 是否存在
      nginx.ingress.kubernetes.io/canary-by-header-value: "true"    # Header 值需匹配
  spec:
    rules:
      - host: example.com
        http:
          paths:
            - path: /
              backend:
                service:
                  name: new-service
                  port: 80
  ```

- **行为说明**：  

  - 若请求包含 `X-Canary: true`，流量转发到 `new-service`。  
  - 其他请求仍由 `main-ingress` 处理。

- 当 `nginx.ingress.kubernetes.io/canary-by-header-value` 未显式配置时（即只有 `canary-by-header`）的几种情况：

  | **场景**（Header）                              | **优先级** | **流量分配逻辑**                                             |
  | :---------------------------------------------- | :--------- | :----------------------------------------------------------- |
  | `X-Canary: always`                              | 高         | 100% 到金丝雀服务                                            |
  | `X-Canary: never`                               | 高         | 0% 到金丝雀服务                                              |
  | `X-Canary: <其他值>` 或 `X-Canary` 存在但值为空 | 低         | 若同时配置了 `canary-by-header` 和 `canary-weight`，按 `canary-weight` 分配 |
  | `X-Canary` 不存在                               | 低         | 同上                                                         |

##### **2.2 基于 Cookie（Canary by Cookie）**
- **配置示例**：  
  
  ```yaml
  apiVersion: networking.k8s.io/v1
  kind: Ingress
  metadata:
    name: canary-ingress
    annotations:
      nginx.ingress.kubernetes.io/canary: "true"
      nginx.ingress.kubernetes.io/canary-by-cookie: "canary_user"   # 检查 Cookie 名称
  spec:
    rules:
      - host: example.com
        http:
          paths:
            - path: /
              backend:
                service:
                  name: new-service
                  port: 80
  ```
- **行为说明**：  
  - 若请求包含 `Cookie: canary_user=always`，流量转发到 `new-service`。  
  - Cookie 值可自定义（如 `always`、`never`），需与后端逻辑配合。
### **3. 多条件组合控制**
- **优先级规则**（Nginx Ingress）：  
  
  `canary-by-header` > `canary-by-cookie` > `canary-weight`。  
  
  - 若同时配置多个条件，优先匹配 Header/Cookie，未匹配时按权重分配。  
  
- **示例**：  
  
  ```yaml
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "20"
    nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"
    nginx.ingress.kubernetes.io/canary-by-header-value: "internal"
  ```
  - 请求包含 `X-Canary: internal` → 转发到新版本。  
  - 其他请求 → 20% 流量到新版本。
### **4. 注意事项**
1. **控制器兼容性**：  
   - 不同 Ingress 控制器（如 Traefik、Istio）实现方式不同，需参考官方文档。  
   - Nginx Ingress 的注解前缀为 `nginx.ingress.kubernetes.io/`。

2. **会话一致性**：  
   - 若应用依赖会话（如购物车），需确保同一用户的请求始终路由到同一版本（可通过 Cookie 实现）。

3. **监控与回滚**：  
   - 部署监控（如 Prometheus + Grafana）跟踪新版本错误率、延迟等指标。  
   - 发现问题时，快速调整权重至 0 或禁用金丝雀规则。

4. **测试覆盖**：  
   - 确保金丝雀流量覆盖核心功能用例。  
   - 使用自动化测试工具模拟真实用户请求。
### **5. 总结**
| **控制方式**    | **适用场景**                   | **优势**                   | **工具依赖**            |
| --------------- | ------------------------------ | -------------------------- | ----------------------- |
| **基于权重**    | 简单流量比例分配               | 配置简单，快速验证基础功能 | Nginx Ingress 注解      |
| **基于 Header** | 定向测试内部用户或特定条件请求 | 精准控制测试范围           | 需客户端携带指定 Header |
| **基于 Cookie** | 长期用户分组（如 A/B 测试）    | 用户无感知，适合长期灰度   | 需管理 Cookie 生命周期  |
