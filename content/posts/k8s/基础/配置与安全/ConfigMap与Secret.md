---
title: "ConfigMap与Secret"
draft: false
tags: ["k8s", "基础", "配置与安全"]
---

## 一、ConfigMap

### 1. 介绍
#### 1.1 是什么？
- **配置资源**：存储配置文件内容，可通过 Volume 挂载到多个 Pod。
- **注意事项**：
  - 仅通过 K8s API 创建的 Pod 可使用 ConfigMap（静态 Pod 不可用）。
  - 文件大小限制为 1MB（受 ETCD 限制）。

#### 1.2 为什么用？
- **配置中心**：统一管理配置，关联所有 Pod。
- **动态更新**：ConfigMap 更新后，关联 Pod 内的**文件会同步更新**（但**进程需手动重启或通过其他机制触发**）。

#### 1.3 ConfigMap vs Secret
- **ConfigMap**：存储非敏感字符串。
- **Secret**：存储敏感数据（如密码、Token）。
### 2. 创建 ConfigMap
#### 2.1 YAML 方式
```yaml
apiVersion: v1
data:
  xxx: "111" # 简单键值对，值非字符串的话，记得加引号
  yyy: "222"
  data.1: hello
  data.2: world
  config1: |
    property.1=value-1
    property.2=value-2
    property.3=value-3
    
  config2: |-
    hello
    world
    
  config3: |+
    hello
    world
    
  config4: >
    我是第一行
    我也是第一行
    我仍是第一行
    我依旧是第一行
    
    我是第二行
    这么巧我也是第二行
    
kind: ConfigMap
metadata:
  name: test1-config
  namespace: default
```

- **竖线符|**：在yaml中代表保留换行，但是每行的缩进和行尾空白都会被去掉，而额外的缩进会被保留。

  ```yaml
  lines: |
    我是第一行
    我是第二行
        我是第四行
    我是第五行
    
  # JSON
  ```

- **竖线符搭配 + 或 - 号**： + 表示保留文字块末尾的换行， - 表示删除字符串末尾的换行。

  ```yaml
  value: |
    hello
    world
    
  # {"value": "hello\nworld\n"}
  
  value: |-
    hello
    world
  
  # {"value": "hello\nworld"}
  
  value: |+
    hello
    world # 下面还有一行
  
  # {"value": "hello\nworld\n\n"} (有多少个回车就有多少个\n)
  ```

- **大于号>**： 在yaml中表示折叠换行，内容最末尾的换行会保留，但文中部分只有空白行才会被识别为换行，原来的换行符都会被转换成空格。

  ```yaml
  lines: >
    我是第一行
    我也是第一行
    我仍是第一行
    我依旧是第一行
    
    我是第二行
    这么巧我也是第二行
    
  # JSON
  {"lines": "我是第一行 我也是第一行 我仍是第一行 我依旧是第一行\n我是第二行 这么巧我也是第二行\n"}
  ```

#### 2.2 命令行创建

常用的集中方式，若想了解其他方式可以通过 `kubectl ceate configmap -h` 命令查看

##### (1) 指定目录
```bash
mkdir /myconf
cd /myconf

cat > redis.conf << EOF
host=127.0.0.1
port=6379
EOF

cat > mysql.conf << EOF
host=127.0.0.1
port=3306
EOF

kubectl create configmap test2-config --from-file=/myconf
```

##### (2) 指定文件
```bash
kubectl create configmap test3-config --from-file=/myconf/mysql.conf
```

##### (3) 使用 `--from-literal`

直接传递配置信息

```bash
kubectl create configmap test4-config \
  --from-literal=db.host=localhost \
  --from-literal=db.port=3306
```
### 3. 关联 ConfigMap 到 Pod
#### 3.1 以环境变量的方式注入
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: testcm1-pod
spec:
  containers:
    - name: testcm1
    image: busybox
    command: [ "/bin/sh", "-c", "tail -f /dev/null" ]
    env:
      - name: DB_HOST
        valueFrom:
          configMapKeyRef:
            name: test4-config
            key: db.host
      - name: DB_PORT
        valueFrom:
          configMapKeyRef:
            name: test4-config
            key: db.port
    envFrom:  # 注入整个 ConfigMap
      - configMapRef:
          name: test2-config
```

**容器命令中引用变量**

```yaml
command: [ "/bin/sh", "-c", "echo $(DB_HOST) $(DB_PORT)" ]
```

**注意**：环境变量适用于单行的key-value，多行的通常应该挂载到配置文件

#### 3.2 挂载 Volume

```yaml
# configMap
apiVersion: v1
data:
  mysql.conf: |
    host=127.0.0.1
    port=3306
  redis.conf: |
    host=127.0.0.1
    port=6379
kind: test3-config
metadata:
  name: cm-demo
  namespace: default
```

```yaml
volumes:
  - name: my-volume
    configMap:
      name: test3-config
containers:
  - volumeMounts:
    - name: my-volume
      mountPath: /etc/config
```

##### 定制子路径
```yaml
volumes:
  - name: my-volume
    configMap:
      name: test2-config
      items:
        - key: mysql.conf
          path: path1/to/mysql.conf
        - key: redis.conf
          path: path2/to/redis.conf
# mysql.conf和redis.conf两个配置文件被分别映射到Pod的path1/to/mysql.conf和path2/to/redis.conf路径下
```
### 4. ConfigMap 热更新
#### 4.1 更新机制

- **Volume 挂载**：ConfigMap 更新后，Pod 内文件会自动同步（无需重启 Pod）。
- **应用限制**：多数应用需重启或触发配置重载（如通过 Sidecar）。

#### 4.2 实现热更新
##### 方法 1：手动触发
```bash
kubectl delete pod <pod-name>  # 触发重建
```

##### 方法 2：使用 Reloader
**部署 Reloader**：

```bash
wget https://raw.githubusercontent.com/stakater/Reloader/master/deployments/kubernetes/reloader.yaml
kubectl apply -f reloader.yaml
```
#### 4.3 示例：Nginx 热更新
##### 4.3.1 创建 ConfigMap
```bash
kubectl create configmap nginx-config --from-file=www.conf
```

##### 4.3.2 挂载到 Deployment
```yaml
volumes:
  - name: nginxconf
    configMap:
      name: nginx-config
containers:
  - volumeMounts:
    - name: nginxconf
      mountPath: /etc/nginx/conf.d/

# 注意添加这一行到.metadata.
annotations:
  reloader.stakater.com/auto: "true"  # 自动重启 Pod
```

##### 4.3.3 测试更新
```bash
kubectl edit cm nginx-config  # 修改配置后，Reloader 自动重启 Pod
curl <Pod-IP>:<Port>          # 验证新配置生效
```
## 二、Secret
### 1. 介绍
#### 1.1 定义
- **Secret** 是 K8s 中存储敏感数据（如密码、私钥、证书等）的资源对象，数据以 Base64 编码形式存储在 etcd 中。
- 通过挂载卷或环境变量供 Pod 访问时，数据自动解码为明文。（在pod里访问这些数据时，显示的时明文）

#### 1.2 使用场景
- **安全性**：替代明文存储敏感信息（如密码、Token、证书）。
- **动态更新**：无需重建镜像即可更新配置。
- **类型支持**：
  - `Opaque`：通用 Base64 编码 Secret。
  - `kubernetes.io/tls`：存储 TLS 证书和私钥。
  - `kubernetes.io/dockerconfigjson`：存储 Docker 私有仓库认证信息。
### 2. 使用 Secret（Opaque 类型）
#### 2.1 定义 Secret
##### (1) 字段说明
- **data**：存储 Base64 编码的数据。
- **stringData**：存储明文数据，创建时自动编码为 Base64。

##### (2) 示例
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: test-secret
type: Opaque
data:
  password: MTIzNDU2  # "123456" 的 Base64 编码
```

##### (3) 使用 `stringData`
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: demo-secret
type: Opaque
stringData:
  config.yaml: |
    apiurl: "https://my.api.com/api/v1"
    password: 123
```

`kubectl describe secrets test-secret` 或 `kubectl get secrets <secret-name> -o yaml` 查看 `secret` 时，都不会暴露明文

#### 2.2 使用 Secret
##### (1) 挂载卷方式
- 将 Secret 挂载为目录，每个键对应一个文件。
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
spec:
  template:
    spec:
      containers:
        - volumeMounts:
            - name: secret-volume
              mountPath: /etc/my-secret
      volumes:
        - name: secret-volume
          secret:
            secretName: test-secret
```

##### (2) 环境变量方式
```yaml
env:
  - name: SECRET_USERNAME
    valueFrom:
      secretKeyRef:
        name: test-secret
        key: username
```

##### (3) 动态更新
- 修改 Secret 后，挂载卷的 Pod 会自动更新文件内容。
- 如需 Pod 重启，需在部署完 Reloader 后在控制器的 metadata 添加注解：
```yaml
metadata:
  annotations:
    reloader.stakater.com/auto: "true"
```
### 3. 使用 Secret（dockerconfigjson 类型）
#### 3.1 创建 Docker 仓库认证 Secret
```bash
# 定义变量
export DOCKER_REGISTRY_SERVER=10.0.0.100
export DOCKER_USER=root
export DOCKER_PASSWORD=root@123
export DOCKER_EMAIL=root@123.com

# 创建docker仓库的secret
kubectl create secret docker-registry myregistrykey \
--docker-server=DOCKER_REGISTRY_SERVER \
--docker-username=DOCKER_USER \
--docker-password=DOCKER_PASSWORD \
--docker-email=DOCKER_EMAIL

# 创建通用的secret
kubectl create secret generic my-registry-secret \
--from-file=.dockerconfigjson=/path/to/config.json \ # 本地文件系统中包含Docker配置信息的文件路径
													 # 通常包含了用于访问Docker镜像仓库的认证信息，如用户名和密码或访问令牌
													 # 在linux中，通常位于~/.docker/config.json
--type=kubernetes.io/dockerconfigjson
```

#### 3.2 在 Pod 中引用
```yaml
spec:
  containers:
    - image: 192.168.1.100:5000/test:v1
  imagePullSecrets:
    - name: myregistrykey
```

- Secrets 可以被 Pod 中的容器直接访问，也可以被 K8s 的其他组件访问。
- ImagePullSecrets 只能由 Kubelet 访问，用于拉取镜像的过程，不会被直接暴露给 Pod 中的容器。

#### 3.3  or 通过 ServiceAccount 自动注入
```yaml
# 会为SA是default的pod自动注入imagePullSecrets
apiVersion: v1
kind: ServiceAccount
metadata:
  name: default
  namespace: default
imagePullSecrets:
  - name: myregistrykey
```
### 4. kubernetes.io/service-account-token

> **储备知识**：
>
> - `ServiceAccount`：
>   - **定义**：
>     - K8s 中供 **Pod** 使用的身份标识，用于 Pod 与集群 API Server 的安全通信。
>     - **不是供用户使用的账号**，而是为 Pod、服务进程等资源提供身份认证。
>   - **核心特性**：
>     - 与 **命名空间（Namespace）** 绑定，每个 SA 属于特定命名空间。
>     - 实际身份认证依赖关联的 **凭证**（包含密钥、证书等敏感信息）。
>   - **1.24.0 版本前的实现机制**
>     - 每创建一个 SA，K8s 会自动生成一个与之绑定的 **Secret**，作为其唯一凭证。
>     - Secret 中存储以下关键信息：
>       - `ca.crt`：集群的 CA 证书，用于验证 API Server 的合法性。
>       - `namespace`：所属命名空间。
>       - `token`：JWT（JSON Web Token），用于身份认证。
>   - **1.24.0 版本前的主要问题**
>     - **凭证泄露风险**
>       - **问题根源**：
>         - SA 的凭证（Secret）默认以明文形式存储在节点文件系统中（`/var/run/secrets/kubernetes.io/serviceaccount`）。
>         - 系统组件（如 kube-proxy、CoreDNS）使用高权限 SA，其 Secret 的泄露可能导致集群被控制。
>       - **攻击面扩大**：
>         - 攻击者可通过窃取高权限 SA 的 Secret，伪装成合法组件与 API Server 通信，实现横向移动或权限提升。
>     - **弹性与容量问题**
>       - **资源浪费**：
>         - 每个 SA 必须绑定一个 Secret，导致 Secret 数量与 SA 线性增长。
>         - 大规模集群中（如数千个微服务），大量 Secret 占用 etcd 存储空间，影响集群性能。
>       - **管理复杂度**：
>         - 频繁创建/删除 SA 时，Secret 的生成和清理增加管控负担。
>     - **JWT 令牌的安全缺陷**
>       - **缺乏身份绑定**（Audience）：
>         - JWT 未明确指定 `audience` 字段，允许任意使用者互相扮演（伪装攻击）。例如，攻击者可利用泄露的 Token 访问其他服务的 API。
>       - **无过期时间**：
>         - JWT Token 永久有效，泄露后无法自动失效，只能通过 **轮转签发私钥**（SA 私钥）强制吊销所有已签发 Token。
>         - 私钥轮转操作复杂，且可能引发服务中断。

#### 4.1 特性
- **自动生成 Token**：
  - 从 K8s 1.24.0 开始，**创建 SA 时不再自动生成 Secret**。
  - 仅当 Pod 引用 SA 时，自动生成并挂载 Token。
    - **触发条件**：Pod 中通过 `serviceAccountName` 字段引用 SA
    - **挂载路径**：默认挂载到Pod的 `/var/run/secrets/kubernetes.io/serviceaccount` 目录
    - **包含文件**：
      - `ca.crt`：集群 CA 证书。
      - `namespace`：Pod 所属的命名空间。
      - `token`：动态生成的 JWT（JSON Web Token）。
- **动态更新**：
  - kubelet 负责监控 Token 有效期，并在到期前刷新（默认最小有效期 **10分钟**）。
  - 应用程序需主动重新加载更新后的 Token。

#### 4.2 示例
##### 4.2.1 **手动声明 Token 投影卷**

除默认自动生成的 Token 外，可手动声明自定义 Token 投影卷，灵活控制挂载路径、有效期等。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
  - image: nginx
    name: nginx
    volumeMounts:
    - mountPath: /var/run/secrets/tokens   # 自定义挂载路径
      name: vault-token                    # 自定义卷名称
  serviceAccountName: build-robot          # 引用的 ServiceAccount
  volumes:
  - name: vault-token                      # 自定义卷声明
    projected:
      sources:
      - serviceAccountToken:
          path: vault-token                # 挂载文件名
          expirationSeconds: 600           # 有效期（最低 600 秒）
          audience: vault                  # 指定 Token 受众（防止伪装攻击）
```

##### 4.2.2 **默认自动生成的 Token 卷**

**自动生成规则**

- **卷名称**：`kube-api-access-<随机后缀>`（如 `kube-api-access-f2b4k`）。
- **挂载路径**：`/var/run/secrets/kubernetes.io/serviceaccount`。

```yaml
volumes:
- name: kube-api-access-f2b4k
  projected:
    sources:
    - serviceAccountToken:
        expirationSeconds: 3607    # 默认有效期（约 1 小时）
        path: token                # Token 文件名
    - configMap:                   # 集群 CA 证书
        name: kube-root-ca.crt
        items:
          - key: ca.crt
            path: ca.crt
    - downwardAPI:                 # 命名空间信息
        items:
          - fieldRef:
              fieldPath: metadata.namespace
            path: namespace
```
### 5. 标记 Secret 不可变
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: immutable-secret
data:
  key: VGhpcyBpcyBhIHNlY3JldCE=
immutable: true  # 设为不可变后禁止修改，只能删除重建
				 # 现有的 Pod 将维持对已删除 Secret 的挂载点
				 # 也可以用于 configmap
```
### 6. Secret vs ConfigMap
#### 相同点
- 键值对存储。
- 支持挂载为卷或环境变量。
- 属于特定命名空间。
- 挂载为卷时可热更新。

#### 不同点
| **特性**            | **Secret**                         | **ConfigMap**  |
| ------------------- | ---------------------------------- | -------------- |
| 数据类型            | 敏感数据（Base64 编码）            | 非敏感明文数据 |
| 类型分类            | Opaque、dockerconfigjson、SA Token | 无类型区分     |
| 关联 ServiceAccount | 支持                               | 不支持         |
| 镜像拉取鉴权        | 支持（ImagePullSecrets）           | 不支持         |
| 大小限制            | 1MB（etcd 限制）                   | 1MB            |

Secret 虽然采用 Base64 编码，但是我们还是可以很方便解码获取到原始信息，所以对于非常重要的数据可以考虑使用 Vault（一种加密管理工具） 来进行加密管理。
