---
title: "NFS共享存储"
draft: false
tags: ["k8s", "进阶", "存储"]
---

## 一、介绍
### 1.1 核心作用
- **解决Pod漂移问题**：网络存储（如NFS）允许Pod在不同节点间迁移时仍能访问同一数据卷，无需依赖本地存储。
- **适用场景**：对数据持久化有需求但无需极致读写性能的应用（如Web服务、文件共享）。

### 1.2 与本地存储的对比
| 存储类型                          | 优点                                    | 缺点                    |
| --------------------------------- | --------------------------------------- | ----------------------- |
| **本地存储**（hostPath/Local PV） | 高性能（SSD/HDD）                       | Pod需固定节点，无法漂移 |
| **NFS**                           | 支持Pod跨节点漂移<br />无需考虑延迟绑定 | 网络延迟可能影响性能    |
## 二、安装NFS服务端与客户端
### 2.1 服务端安装（以CentOS为例）
```bash
# 关闭防火墙
systemctl stop firewalld.service
systemctl disable firewalld.service

# 安装NFS服务
yum install -y nfs-utils rpcbind

# 创建共享目录并配置权限
mkdir -p /data/nfs
chmod 755 /data/nfs

# 配置共享目录（/etc/exports）
cat > /etc/exports <<EOF
/data/nfs *(rw,sync,no_root_squash)
EOF

# 启动服务
systemctl start rpcbind.service
systemctl enable rpcbind.service
systemctl start nfs-server.service
systemctl enable nfs-server.service

# 验证
rpcinfo -p | grep nfs
```

### 2.2 客户端安装（所有K8s节点）
```bash
yum install -y nfs-utils

# 验证NFS共享是否可用
showmount -e <NFS-Server-IP>
# 示例输出：
# Export list for 192.168.71.12:
# /data/nfs *
```
## 三、创建静态NFS PV/PVC
### 3.1 定义PV（PersistentVolume）
```yaml
# nfs-pv.yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: nfs-pv
spec:
  storageClassName: manual
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  nfs:
    path: /data/nfs       # NFS共享目录路径
    server: 192.168.71.12 # NFS服务器IP
```

### 3.2 定义PVC（PersistentVolumeClaim）
```yaml
# nfs-pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: nfs-pvc
spec:
  storageClassName: manual
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
```

### 3.3 创建Pod挂载PVC
```yaml
# nfs-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: test-volumes
spec:
  volumes:
    - name: nfs
      persistentVolumeClaim:
        claimName: nfs-pvc
  containers:
    - name: web
      image: nginx:1.18
      ports:
        - containerPort: 80
      volumeMounts:
        - name: nfs
          subPath: test-volumes  # 子目录隔离，/data/nfs/test-volumes
          mountPath: /usr/share/nginx/html # 容器中的目录
```

### 3.4 验证数据持久化
```bash
# 在NFS服务器上写入测试文件

# 访问Pod IP验证
kubectl get pods -o wide
curl <Pod-IP>
```
## 四、使用StorageClass动态创建PV
### 4.1 部署NFS Provisioner
#### 步骤1：安装Helm（若未安装）
```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
chmod 700 get_helm.sh
./get_helm.sh
```

#### 步骤2：通过Helm部署NFS Provisioner
```bash
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
helm install nfs-subdir-external-provisioner \
  nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --set nfs.server=192.168.71.12 \ # 记得改为自己设置的
  --set nfs.path=/data/nfs \
  --set storageClass.defaultClass=true \ # 可选
  -n kube-system
```

### 4.2 验证部署
```bash
# 查看Provisioner Pod状态
kubectl -n kube-system get pods | grep nfs-subdir

# 查看StorageClass
kubectl get sc
# 输出示例：
# NAME            PROVISIONER                                   RECLAIMPOLICY
# nfs-client (default) cluster.local/nfs-subdir-external-provisioner Delete
```

### 4.3 动态创建PVC与PV
#### 定义PVC（自动触发PV创建）
```yaml
# test-claim.yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: test-claim-xxx
spec:
  # 因为在部署的时候将nfs-client设置为默认的storageClass，所以这里不指定也没关系
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 10Mi
```

#### 创建Pod使用PVC
```yaml
# web-test.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  labels:
    app: web-test
  name: web-test
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web-test
  template:
    metadata:
      labels:
        app: web-test
    spec:
      containers:
        - image: nginx:1.18
          name: nginx
          volumeMounts:
            - name: wwwroot
              mountPath: /usr/share/nginx/html
      volumes:
        - name: wwwroot
          persistentVolumeClaim:
            claimName: test-claim-xxx
```

### 4.4 验证动态PV
```bash
# 查看PVC与PV状态
kubectl get pvc
kubectl get pv

# 在NFS服务器查看自动创建的目录
ls /data/nfs/
# 示例输出：
# default-test-claim-xxx-pvc-<UUID>

# 写入测试数据并访问Pod
curl <Pod-IP>
```

