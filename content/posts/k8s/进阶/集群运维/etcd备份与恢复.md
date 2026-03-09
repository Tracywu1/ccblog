---
title: "etcd备份与恢复"
draft: false
tags: ["k8s", "进阶", "集群运维"]
---

#### **一、周期性备份配置**
1. **备份命令**  
   定期执行以下命令生成 etcd 数据快照（建议通过脚本结合计划任务实现）：
   ```bash
   ETCDCTL_API=3 etcdctl \
     --endpoints=https://127.0.0.1:2379 \       # 本地 etcd 实例地址
     --cacert=/etc/kubernetes/pki/etcd/ca.crt \  # etcd CA 证书
     --cert=/etc/kubernetes/pki/etcd/server.crt \ # etcd 服务端证书
     --key=/etc/kubernetes/pki/etcd/server.key \  # etcd 服务端私钥
     snapshot save etcdbackupfile.db              # 快照保存路径
   ```
   **关键参数说明**：
   - `--endpoints`：指定 etcd 实例的监听地址。
   - `--cacert`/`--cert`/`--key`：用于认证的证书文件，确保权限正确（通常为 `640`）。
   - `snapshot save`：生成快照文件，建议文件名包含日期（如 `etcd-snapshot-$(date +%Y%m%d).db`）。

2. **自动化脚本示例**  
   创建备份脚本 `/usr/local/bin/etcd-backup.sh`：
   ```bash
   #!/bin/bash
   BACKUP_DIR=/opt/etcd-backups
   mkdir -p $BACKUP_DIR
   ETCDCTL_API=3 etcdctl \
     --endpoints=https://127.0.0.1:2379 \
     --cacert=/etc/kubernetes/pki/etcd/ca.crt \
     --cert=/etc/kubernetes/pki/etcd/server.crt \
     --key=/etc/kubernetes/pki/etcd/server.key \
     snapshot save $BACKUP_DIR/etcd-snapshot-$(date +%Y%m%d).db
   ```
   **添加计划任务**（每日备份）：
   ```bash
   crontab -e
   # 每天凌晨 2 点执行备份
   0 2 * * * /usr/local/bin/etcd-backup.sh
   ```
#### **二、etcd 数据恢复步骤**
##### **前提条件**
- **适用场景**：单节点 etcd 或 Stacked Control Plane 架构（每个 Master 节点独立运行 etcd）。
- **恢复影响**：恢复期间 etcd 服务不可用，需停止 K8s 控制平面。
##### **1. 停止相关服务**
```bash
# 停止 kubelet 管理的静态 Pod（包括 etcd、kube-apiserver 等）
mv /etc/kubernetes/manifests /etc/kubernetes/manifests_bak

# 停止 kubelet 服务
systemctl stop kubelet
```
**作用**：  
- 移动 `manifests` 目录防止恢复过程中组件自动重启。
- 停止 `kubelet` 服务确保恢复操作不受干扰。
##### **2. 清理旧数据**
```bash
# 备份原有数据（可选，防止恢复失败）
mv /var/lib/etcd /var/lib/etcd_bak

# 创建新数据目录
mkdir /var/lib/etcd
chmod 700 /var/lib/etcd  # 确保目录权限正确
```
**注意事项**：  
- 若磁盘空间不足，可直接清空 `/var/lib/etcd`，但建议先备份。
##### **3. 从快照恢复数据**
```bash
ETCDCTL_API=3 etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot restore etcdbackupfile.db \  # 指定快照文件
  --data-dir=/var/lib/etcd              # 恢复至新数据目录
```
**关键参数说明**：  
- `--data-dir`：必须与 etcd 启动参数中定义的数据目录一致（默认为 `/var/lib/etcd`）。
- 恢复操作会重新初始化 etcd 数据，**仅适用于单节点或全新集群**，多节点集群需额外操作。
##### **4. 重启服务**
```bash
# 恢复静态 Pod 配置
mv /etc/kubernetes/manifests_bak /etc/kubernetes/manifests

# 启动 kubelet
systemctl restart kubelet

# 检查服务状态（等待 1-2 分钟）
systemctl status kubelet
kubectl get pods -n kube-system  # 确认组件正常启动
```
**验证步骤**：  
- 执行 `etcdctl endpoint health` 检查 etcd 健康状态。
- 执行 `kubectl get nodes` 确认集群节点状态正常。
#### **三、注意事项**
1. **多节点 etcd 集群恢复**  
   - 若为多节点 etcd 集群（如外部 etcd），需在所有节点执行相同恢复操作，并重新建立集群关系。
   - **操作步骤**：
     - 停止所有节点上的 etcd 服务。
     - 在每个节点上恢复快照。
     - 使用 `--initial-cluster-state=existing` 重新启动 etcd 集群。

2. **备份文件管理**  
   - 定期清理过期备份（如保留最近 7 天）：
     ```bash
     find /opt/etcd-backups -name "*.db" -mtime +7 -exec rm -f {} \;
     ```
   - 备份文件需加密存储或传输至异地，防止数据泄露。

3. **恢复演练**  
   - 定期在测试环境模拟恢复流程，验证备份有效性。
   - 记录恢复耗时，优化应急预案。

4. **版本兼容性**  
   - 确保备份与恢复使用的 `etcdctl` 版本一致，避免兼容性问题。
