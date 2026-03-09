---
title: "PV与PVC"
draft: false
tags: ["k8s", "进阶", "存储"]
---

#### **一、概念介绍**
1. **数据持久化需求**  
   - Pod由容器组成，容器停机后数据丢失。若想永久保存数据，需通过存储资源（PV/PVC）实现数据持久化。

2. **PV与PVC的作用**  

   <figure class="half">
       <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250410195713555.png" width=300/>
       ......
       <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250410195726292.png" width=450/>
   </figure>

   - **PV（PersistentVolume）**：对接底层存储（如NFS、Ceph），屏蔽存储设备差异。  （可跨命名空间）
   - **PVC（PersistentVolumeClaim）**：
     - 用户对存储资源的申请
     - 负责对接PV，屏蔽PV差异，解耦Pod与底层存储
     - 不可跨命名空间
     - 一个PV仅能被一个PVC绑定
   - **优势**：避免直接管理存储细节（如IP变更仅需修改PV），提高灵活性。

3. **StorageClass**

   <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/image-20250429194747584.png" alt="image-20250429194747584" style="zoom:33%;" />

   - 解决大规模场景手动创建PV的繁琐问题，支持动态PV。  
   - 归类存储设备性能（如高速SSD、普通HDD），简化Pod使用。

   **示例**：

   ```yaml
   apiVersion: storage.k8s.io/v1
   kind: StorageClass
   metadata:
     name: fast-storage
   provisioner: kubernetes.io/gce-pd  # 存储提供者，这里是Google Cloud Engine的持久性磁盘
   parameters:
     type: pd-ssd  # 磁盘类型，这里是SSD磁盘
     replication-type: regional-pd  # 复制类型，这里是区域复制，提供更高的可用性
   reclaimPolicy: Delete  # 回收策略，当PVC被删除时，相应的PV也会被删除
   allowVolumeExpansion: true  # 允许在创建后扩展卷的大小
   mountOptions:
     - debug  # 挂载选项，启用调试模式
     - nofail  # 挂载选项，即使挂载失败也不会导致Pod启动失败
   ```
   
   - **provisioner**：一个负责资源预配置或供应的程序或组件。
     - **PV Provisioner**：
       - 当用户创建一个PVC时，Provisioner会根据PVC中指定的存储类（StorageClass）动态地创建一个PV来满足需求。
       - Provisioner通常与外部存储系统（如AWS EBS、GCE PD、NFS服务器等）集成，以便在收到请求时能够从这些系统中分配存储资源。
   
   ```yaml
   # 通过PVC自动创建PV，指定`StorageClass`即可
   apiVersion: v1
   kind: PersistentVolumeClaim
   metadata:
     name: nfs-sc-pvc
   spec:
     storageClassName: nfs-client  # 动态PV类，不同的storageClass对应不同的存储设备类型
     accessModes:
       - ReadWriteOnce
     resources:
       requests:
         storage: 1Gi
   ```
#### **二、快速示例**
1. **静态PV创建**  
   ```yaml
   # pv.yaml
   apiVersion: v1
   kind: PersistentVolume
   metadata:
     name: pv-hostpath
     labels:
       type: local
   spec:
     capacity:
       storage: 10Gi
     accessModes:
       - ReadWriteOnce
     persistentVolumeReclaimPolicy: Retain
     hostPath:
       path: /data/test1
       type: DirectoryOrCreate # 若该目录不存在就会创建它(整条链路打通后)
     storageClassName: manual  # 标识静态PV（非必要声明）
   ```

2. **PVC创建与绑定**  
   ```yaml
   # pvc.yaml
   apiVersion: v1
   kind: PersistentVolumeClaim
   metadata:
     name: pvc-hostpath
   spec:
     storageClassName: manual  # 匹配静态PV
     accessModes:
       - ReadWriteOnce
     resources:
       requests:
         storage: 3Gi  # 绑定满足条件（当前最合适）的PV
   ```

3. **Pod使用PVC**  
   ```yaml
   # pod.yaml
   apiVersion: v1
   kind: Pod
   metadata:
     name: pv-hostpath-pod
   spec:
     volumes:
       - name: pv-hostpath1
         persistentVolumeClaim:
           claimName: pvc-hostpath #  pvc
     containers:
       - name: nginx
         image: nginx
         volumeMounts:
           - mountPath: /usr/share/nginx/html
             name: pv-hostpath1
   ```
   - 验证：在节点目录`/data/test1`创建`index.html`，访问Pod IP可查看内容。
#### **三、PV详解**
##### **核心配置项**  

- **存储能力（Capacity）**：指定存储大小（如`10Gi`）。  

- **访问模式（AccessModes）**： 
  
  描述用户应用对存储资源的访问权限。（了解即可，其底层并未严格实现该权限限制） 
  
  - `ReadWriteOnce`（RWO）：读写权限，只能被单个节点上的一个或多个Pod挂载使用。  
  - `ReadOnlyMany`（ROX）：只读权限，可以同时在多个节点上挂载并被不同的Pod使用。  
  - `ReadWriteMany`（RWX）：读写权限，可以同时在多个节点上挂载并被不同的Pod使用。  
  - `ReadWriteOncePod`（v1.22+）：仅允许单个Pod读写。  
  
- **回收策略（Reclaim Policy）**：  
  | 策略    | 描述                                                         |
  | :------ | :----------------------------------------------------------- |
  | Retain  | PVC删除后保留PV和数据（状态为released，无法再被PVC关联），需手动清理（推荐生产环境使用）。 |
  | Delete  | PVC删除后自动删除PV及底层存储资源（仅部分存储类型支持，不同存储类型的最终效果也会有点不同。比如`hostPath`只允许删除挂载到`/tmp`下的PV，并且即使删除了PVC，PV也被删除了，该目录也不会删除，这是k8s基于数据安全的考虑）。 |
  | Recycle | 数据清空后标记为可用（已弃用，仅NFS和HostPath支持）。        |
  
- **状态（Status）**：  
  
  - **Available**（可用）：表示可用状态，还未被任何 PVC 绑定
  - **Bound**（已绑定）：表示 PV 已经被 PVC 绑定
  - **Released**（已释放）：PVC 被删除，但是资源还未被集群重新声明
  - **Failed**（失败）： 表示该 PV 的自动回收失败
  - available -> bound -> released/failed

##### **存储类型**  

- **本地存储**：`hostPath`、`emptyDir`（临时）。
- **网络存储**：NFS、iSCSI。
- **分布式存储**：Ceph、GlusterFS。
- **云存储**：AWS EBS、Azure Disk。

```bash
# 查看k8s支持的存储类型
kubectl explain pod.spec.volumes
```
#### **四、关键注意事项**
1. **权限与路径限制**  
   - `hostPath`使用非`/tmp`目录时，删除策略可能失败（需手动处理）。  
   - 生产环境推荐使用CSI插件（如Ceph），避免原生卷插件限制。

2. **状态与故障处理**  
   - **Released状态**：需管理员手动清理或重新绑定。  
   - **Failed状态**：常见于底层存储操作失败（如权限不足）。
3. **清除顺序**：Pod -> PVC -> PV 
