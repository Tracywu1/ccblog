---
title: "Helm命令"
draft: false
tags: ["k8s", "进阶", "Helm"]
---

一般的使用流程：

| 步骤                  | 命令                                  | 说明                  |
| :-------------------- | :------------------------------------ | :-------------------- |
| 1. 添加仓库           | `helm repo add <name> <url>`          | 注册远程仓库          |
| 2. 更新索引           | `helm repo update`                    | 获取最新 Chart 列表   |
| 3. 查找 Chart         | `helm search repo <name>`             | 查找可用的 Chart      |
| 4. 拉取 Chart（可选） | `helm pull <repo/chart>`              | 下载 Chart 到本地     |
| 5. 安装 Chart         | `helm install <release> <repo/chart>` | 部署应用到 Kubernetes |
| 6. 查看 Release       | `helm status <release>`               | 检查部署状态          |
| 7. 升级/卸载          | `helm upgrade` / `helm uninstall`     | 更新或删除部署        |

注意：

- **`helm pull` 是可选的**，大多数情况下直接 `helm install` 即可。
- **Helm 安装的是 Release，不是 Chart**。Chart 是模板，Release 是实例。

## 一、介绍

### 1. Helm 是什么？
- Helm 是 K8s 的包管理工具，用于安装和管理 **Chart 包**
- **Chart 包**：一组预配置的 K8s YAML 文件集合，用于描述复杂应用的完整部署方案

### 2. 为什么使用 Helm？
- 解决复杂应用部署时 YAML 文件过多的问题
- 提供 Chart 包的版本管理、依赖管理、配置覆盖等功能
- 支持一键安装/卸载完整应用

### 3. helm如何与k8s集群连接？

- 与 `kubectl` 相同：

  - **凭证读取**：Helm 自动使用 `~/.kube/config` 连接 K8s 集群

  - helm 和 kubectl 都涉及把资源清单提交给 k8s 集群，不过前者是提交 chart 包，后者直接提交 yaml 文件。

### 4. 核心概念
| 概念       | 说明                                                 |
| ---------- | ---------------------------------------------------- |
| Repository | Chart 包仓库（类似 Docker Registry）                 |
| Chart      | 应用程序包，包含部署所需的所有资源定义               |
| Release    | 每次安装/升级 Chart 生成的部署实例（支持多版本管理） |

## 二、安装与配置
### 1. Helm 安装
```bash
# 下载地址（选择对应版本）
https://github.com/helm/helm/releases

# 安装示例（v3.12.0）
wget https://get.helm.sh/helm-v3.12.0-linux-amd64.tar.gz
tar zxvf helm-v3.12.0-linux-amd64.tar.gz
mv linux-amd64/helm /usr/local/bin/
```

### 2. 仓库配置
```bash
# 添加稳定版仓库（国内镜像源）
helm repo add stable http://mirror.azure.cn/kubernetes/charts/

# 更新仓库缓存（类似 yum makecache）
helm repo update

# 查看已配置仓库
helm repo list
```

## 三、Chart 包操作
### 1. 搜索 Chart 包
```bash
# 搜索仓库中的包
helm search repo stable

# 搜索特定包（如 MySQL）
helm search repo stable/mysql
```

### 2. 下载 Chart 包

```bash
# 下载最新版
helm pull stable/mysql
# 指定存放目录（默认是在当前工作目录）
helm pull stable/mysql -d /path/to/save

# 下载指定版本（不指定版本的话，默认最新版）
helm pull stable/prometheus-rabbitmq-exporter --version 0.1.1
```

### 3. 安装 Chart 包
#### 多种安装方式：
```bash
# 方式1：从仓库直接安装(无需提前 pull)
helm install my-release stable/mysql --version 1.6.9 
# my-release：自定义的release名，需要独一无二
# 不指定version，则安装最新版本

# 方式2：使用本地压缩包
helm install my-release ./mysql-1.6.9.tgz

# 方式3：使用解压后的目录
helm install my-release /path/to/mysql-chart/

# 方式4：指定命名空间安装
helm install my-release stable/mysql --namespace kube-system

# 模拟安装（dry-run 测试）
# 不会真正安装，但是会将要安装的yaml罗列出来
# 这些yaml是渲染之后的结果
helm install my-release stable/mysql --dry-run
```

> `helm install myapp ./myapp` 做了什么？
>
> 1. **加载 Chart 和元数据**: 读取 `./myapp/Chart.yaml`，了解这个 Chart 的基本信息。
>
> 2. **处理依赖**: 检查 `./myapp/requirements.yaml` (或 `Chart.yaml` 中的 `dependencies` 部分)，看看这个 Chart 依赖哪些其他的 Charts。然后，它会去下载这些依赖的 Charts（如果它们不在 `charts/` 目录下），并将它们打包到 `charts/` 目录中。
>
> 3. **合并配置**: 将 Chart 的默认值 (`./myapp/values.yaml`) 与你提供的自定义值（通过 `-f my-values.yaml` 或 `--set`）进行合并，生成一份最终的、完整的配置值。
>
> 4. **渲染模板**: 使用上一步生成的最终配置值，去渲染 `./myapp/templates/` 目录下的所有模板文件。Helm 会遍历每个模板文件，将 `{{ .Values.xxx }}`、`{{ .Release.Name }}` 等占位符替换成实际的值，最终生成一系列标准的、纯文本的 Kubernetes YAML 资源清单文件。
>
> 5. **执行安装（与集群交互）**: 将渲染好的所有 YAML 文件一次性发送给 k8s API Server。API Server 会根据这些清单文件创建、更新或配置集群中的资源（如 Deployment, Service, ConfigMap 等）。
>
> 6. **记录 Release**: 安装成功后，Helm 会在集群中创建一个 **Secret**（默认存储在目标命名空间下），用来记录这次**安装的详细信息**（Release 名称、配置、生成的清单、版本等）。这就是为什么你可以用 `helm list` 看到已安装的 Release，并可以用 `helm upgrade`, `helm rollback`, `helm uninstall` 来管理它。
>
>    | 特性                          | `helm dep update`           | `helm template`                | `helm install`                      |
>    | :---------------------------- | :-------------------------- | :----------------------------- | :---------------------------------- |
>    | **核心作用**                  | 下载并打包依赖 Charts       | 在本地渲染模板，生成 YAML      | 在集群中安装/更新应用，创建 Release |
>    | **与集群交互**                | ❌ 否                        | ❌ 否                           | ✅ 是                                |
>    | **创建 Release**              | ❌ 否                        | ❌ 否                           | ✅ 是                                |
>    | **输出**                      | 更新 `charts/` 目录下的文件 | 将渲染后的 YAML 打印到终端     | 在集群中创建资源，并返回安装信息    |
>    | **在 CI/CD 中用途**           | 准备离线包或显式管理依赖    | 静态分析、验证生成的 Manifest  | 真正部署应用到环境                  |
>    | **相当于 `install` 的哪一步** | 第 2 步：处理依赖           | 第 3、4 步：合并配置、渲染模板 | **完整的 1-6 步**                   |

### 4. 卸载

```bash
helm uninstall my-release
helm -n kube-system uninstall my-release
# 保留历史记录
# helm -n kube-system list/ls -a 可查看
helm -n kube-system uninstall my-release --keep history
```

## 四、定制化配置
### 1. 查看默认配置
```bash
# 查看 Chart 的默认 values.yaml
# chart 包的路径多样（同安装）
helm show values stable/mysql > values.yaml
```

### 2. 自定义配置方式

**参数合并机制** ：使用 `--set` /自定义values文件 指定的值会覆盖 Chart 中默认的 values.yaml 对应的值。如果有多个 `--set` 参数/values 文件，后面的会覆盖前面的同名参数值。

#### (1) 使用 --set
```bash
helm install mydb stable/mysql \
  
--set outer.inner=value
# 对应yaml：
# outer
#   inner: value

--set name={a, b, c}
# 对应yaml:
# name:
# -a
# -b
# -c

--set servers[0].port=80
# 对应yaml:
# servers:
#  - port: 80

--set name=value1\.value2
# 对应yaml：
# name:"value1.value2"

--set nodeSelector."kubernetes\.io/role"=master
# 对应yaml：
# nodeSelector:
#   kubernetes.io/role:master
```

#### (2) 使用 values 文件（常用）
```yaml
# custom-values.yaml(只需包含需要修改的值即可，helm 会自动合并)
mysqlDatabase: db01

# 如果自定义的参数没有出现在chart默认的values.yaml中，需要修改对应的模板语法
# 比如values.yaml中，原本：name: {{ template "mysql.fullname" . }}
# 自定义中的 values 文件中出现了参数 suffix: tracy
# 那么需要修改为name: {{ template "mysql.fullname" . }}-{{ .Values.suffix }}
# 如果自定义的参数有层级，那么可以一层层.下去
```

```bash
helm install mydb stable/mysql -f custom-values.yaml
```

#### （3）直接修改 Chart 的默认 values.yaml

## 五、升级与回滚
### 1. 升级 Release
```bash
# 直接修改 Chart 的默认 values.yaml
helm upgrade mydb stable/mysql

# 修改 custom-values.yaml 后执行升级
helm upgrade mydb stable/mysql -f custom-values.yaml

# 使用 --set 直接修改参数
helm upgrade mydb stable/mysql --set mysqlDatabase=newdb
```

### 2. 版本管理
```bash
# 查看发布历史
helm history mydb

# 回滚到指定版本
helm rollback mydb 2  # 回滚到 REVISION=2 的版本

# 查看回滚状态
helm status mydb
```

## 六、注意事项
1. **命名规范**：Release 名称在集群内必须唯一
2. **版本控制**：生产环境建议使用 `--version` 固定 Chart 版本
3. **调试技巧**：使用 `--dry-run` 验证配置，避免直接部署
4. 当在 `values.yaml` 文件中对某一行进行注释时，Helm 并不会识别这些注释，而是会同样进行渲染。

## 附：常用命令速查
| 命令                        | 功能描述             |
| --------------------------- | -------------------- |
| `helm list`                 | 列出已部署的 Release |
| `helm uninstall <release>`  | 卸载指定 Release     |
| `helm status <release>`     | 查看 Release 状态    |
| `helm get values <release>` | 查看生效的配置值     |
| `helm dependency update`    | 更新 Chart 的依赖项  |