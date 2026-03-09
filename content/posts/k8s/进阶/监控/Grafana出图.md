---
title: "Grafana出图"
draft: false
tags: ["k8s", "进阶", "监控"]
---

### **1. Grafana 介绍**
- **功能**：强大的可视化面板，支持多种数据源（Prometheus、Zabbix、Elasticsearch 等），提供灵活的仪表盘和图表编辑器。
- **优势**：相比 Prometheus 原生图表，Grafana 支持更丰富的插件和布局，展示效果更优。
- **官网**：https://grafana.com/
### 2. 安装 Grafana 到 K8s

#### **2.1 准备 NFS 存储**
1. **NFS 服务端配置（192.168.71.101）**：
   
   ```bash
   # 关闭防火墙
   systemctl stop firewalld.service
   systemctl disable firewalld.service
   
   # 安装依赖（实际上，ufs-utils包包含rpcbind服务，并且启动nfs服务时，rpcbind服务也会被自动启动，故可不用显式安装rpcbind，以及启动rpcbind服务）
   # rpcbind服务：会监听来自客户端的RPC(Remote Procedure Call，远程过程调用）请求，并根据请求的类型将它们转发到相应的服务端口
   yum install -y nfs-utils rpcbind
   
   # 创建共享目录
   mkdir -p /data/nfs
   chmod 755 /data/nfs
   
   # 配置共享目录
   cat > /etc/exports <<EOF
   /data/nfs *(rw,sync,no_root_squash)
   EOF
   
   # 启动服务
   systemctl start rpcbind.service
   systemctl enable rpcbind
   systemctl start nfs
   systemctl enable nfs
   ```
   
2. **客户端验证（所有 Node 节点）**：
   ```bash
   yum install -y nfs-utils
   showmount -e 192.168.71.101  # 查看共享目录
   ```

#### **2.2 配置 StorageClass + NFS**
1. **安装 Helm**：
   ```bash
   # 下载并安装 Helm
   wget https://get.helm.sh/helm-v3.15.2-linux-amd64.tar.gz
   tar xf helm-v3.15.2-linux-amd64.tar.gz
   mv linux-amd64/helm /usr/bin/helm
   ```

2. **配置 Containerd 镜像加速**：
   - 修改 `/etc/containerd/config.toml`，添加镜像加速地址（略，见原配置）。
   - 重启 Containerd：
     ```bash
     systemctl daemon-reload			# 让 systemd 重新加载配置
     systemctl restart containerd	# 应用更改并重启 containerd 服务
     ```

3. **安装 NFS Provisioner**：
   
   ```bash
   # 添加 Helm 仓库
   helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
   
   # 安装 Provisioner（替换镜像地址为国内源）
   helm upgrade --install nfs-subdir-external-provisioner \
     nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
     --set image.tag=v4.0.2 \
     --set nfs.server=192.168.71.101 \
     --set nfs.path=/data/nfs \
     --set storageclass.defaultClass=true \
     -n kube-system
   ```
   
4. **验证安装**：
   ```bash
   kubectl get sc nfs-client  # 名为 nfs-client 的 StorageClass存储类的详细信息
   kubectl -n kube-system get pods | grep nfs  # 查看 Provisioner Pod
   ```

#### **2.3 部署 Grafana**
1. **YAML 编排文件（grafana.yaml）**：
   ```yaml
   # PVC 配置
   apiVersion: v1
   kind: PersistentVolumeClaim
   metadata:
     name: grafana-pvc
     namespace: monitor
   spec:
     storageClassName: nfs-client
     accessModes:
       - ReadWriteOnce
     resources:
       requests:
         storage: 2Gi
# Deployment 配置
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: grafana
     namespace: monitor
   spec:
     selector:
       matchLabels:
         app: grafana
     template:
       metadata:
         labels:
           app: grafana
       spec:
         securityContext:
           runAsUser: 0  # 容器内进程以 root（系统UID0） 运行
         volumes:
           - name: storage
             persistentVolumeClaim:
               claimName: grafana-pvc
         containers:
           - name: grafana
             image: grafana/grafana
             imagePullPolicy: IfNotPresent	# 本地不存在指定镜像时，才会从镜像仓库拉取该镜像
             # Always：每次启动Pod时，k8s都会从镜像仓库拉取最新镜像
             # Never：k8s永远不会从镜像仓库拉取镜像
             ports:
               - containerPort: 3000	# 容器端口
             env: # grafana 的管理员账号和密码
               - name: GF_SECURITY_ADMIN_USER
                 value: admin
               - name: GF_SECURITY_ADMIN_PASSWORD
                 value: admin321
             readinessProbe:
               httpGet:
                 path: /api/health
                 port: 3000
             livenessProbe:
               httpGet:
                 path: /api/health
                 port: 3000
             volumeMounts:
               - mountPath: /var/lib/grafana
                 name: storage
# Service 配置
   apiVersion: v1
   kind: Service
   metadata:
     name: grafana
     namespace: monitor
   spec:
     type: NodePort
     ports:
       - port: 3000		# 容器内部暴露的端口号
         nodePort: 30429	# 暴露给集群外部客户端的端口号
     selector:
       app: grafana
   ```
   
2. **应用配置**：
   ```bash
   kubectl apply -f grafana.yaml
   ```

3. **验证部署**：
   
   ```bash
   kubectl -n monitor get pods -l app=grafana  # 查看 Pod 状态
   kubectl -n monitor get svc grafana         # 查看 Service 端口
   ```

#### **2.4 访问 Grafana**
- **URL**: `http://<NodeIP>:30429`
- **账号**: `admin`
- **密码**: `admin321`
### **3. 配置数据源（Prometheus）**
1. **登录 Grafana**  
   - 访问 `http://<NodeIP>:30429`，使用账号 `admin` 和密码 `admin321` 登录。

2. **添加数据源**  
   - 进入首页后，点击左侧导航栏的 **⚙️ 设置图标** → **Data Sources** → **Add data source**。

3. **选择数据源类型**  
   - 在数据源列表中选择 **Prometheus**。

4. **配置 Prometheus 连接信息**  
   - **Name**: 自定义数据源名称（如 `Prometheus`）。
   - **URL**: 输入 Prometheus 的 Service 地址：  
     - 由于 Grafana 和 Prometheus 在同一个 K8s 命名空间（`monitor`），可直接使用 Service 名称访问：  
       `http://prometheus:9090`  
     - 若跨命名空间，需使用完整 DNS：`http://prometheus.monitor.svc.cluster.local:9090`。
   - **其他参数保持默认**（如 `Access` 为 `Server`）。

5. **验证与保存**  
   - 点击页面底部的 **Save & Test**，显示绿色提示框 “Successfully queried the Prometheus API.” 表示配置成功。
### **4. 导入 Dashboard 模板**
1. **获取 Dashboard 模板**  
   - **官方模板库**：https://grafana.com/grafana/dashboards  
   - **推荐模板**：Node Exporter 监控模板（ID `8919`），链接：  
     https://grafana.com/grafana/dashboards/8919

2. **导入模板**  
   - 点击右上角的 **New** → **Import**。
   - 在 **Find and import dashboards for common application at grafana.com/dashboards** 输入框中填写模板 ID（如 `8919`）或 URL，点击 **Load**。

3. **配置导入参数**  
   - **Name**: 自定义 Dashboard 名称（默认保留模板名称）。
   - **Folder**: 选择存储目录（默认 `Dashboards`）。
   - **Prometheus**: 选择已配置的 Prometheus 数据源。
   - 点击 **Import** 完成导入。

4. **验证 Dashboard**  
   - 进入导入的 Dashboard，检查图表是否正常显示数据。
   - **常见问题**：  
     - 若无数据，检查 PromQL 语句或数据源连接。  
     - 编辑图表调整查询条件（如主机名、时间范围）。
### **5. 自行查找模板**
1. **访问 Grafana 官方模板库**  
   - 官网地址：https://grafana.com/grafana/dashboards  
   - 按关键词（如 `Node Exporter`、`Kubernetes`）搜索模板。

2. **筛选与评估**  
   - 查看模板的 **下载量**、**评分**、**更新日期**，选择活跃维护的模板。
### **6. 离线下载模板导入**
1. **下载 JSON 文件**  
   - 在模板页面点击 **Download JSON**（如模板 ID `8919` 的 JSON 文件）。

2. **手动导入**  
   - 在 Grafana 的 **Import** 界面，点击 **Upload JSON file**，选择本地 JSON 文件上传。
   - 配置数据源后点击 **Import**。
### **7. 自定义图表**
1. **创建新 Dashboard**  
   - 点击右上角的 **New** → **Dashboard** → **Add visualization**。

2. **配置图表**  
   - **数据源**: 选择已配置的 Prometheus。
   - **PromQL**: 输入查询语句（如 `node_memory_MemFree_bytes`）。
   - **可视化类型**: 选择图表类型（如 Graph、Gauge、Table）。
   - 调整样式、单位、颜色等参数。 

3. **保存 Dashboard**  
   - 点击顶部 **Save**，输入名称和文件夹后保存。

