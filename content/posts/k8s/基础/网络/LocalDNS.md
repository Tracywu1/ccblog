---
title: "LocalDNS"
draft: false
tags: ["k8s", "基础", "网络"]
---

#### **一、CoreDNS 在高并发场景下的问题**
- **现象**：  
  
  集群规模较大时，CoreDNS 可能出现 DNS 查询超时（默认 5 秒），导致应用解析延迟。
  
- **根本原因**：  
  
  - **Conntrack 冲突**：无论是 iptables 还是 ipvs 模式，底层依赖 `conntrack` 内核模块管理 DNS 的 UDP 查询包。  
  - **高并发场景**：并发 UDP 包竞争导致部分请求被丢弃，触发客户端超时重试机制。
#### **二、DNS 性能测试（未优化前）**
1. **部署测试服务**：
   ```yaml
   # nginx.yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: my-nginx
   spec:
     replicas: 2
     selector:
       matchLabels:
         app: my-nginx
     template:
       metadata:
         labels:
           app: my-nginx
       spec:
         containers:
         - name: my-nginx
           image: nginx:1.18.0
           ports:
           - containerPort: 80
apiVersion: v1
   kind: Service
   metadata:
     name: my-nginx
   spec:
     ports:
     - name: http
       port: 80
       targetPort: 80
     selector:
       app: my-nginx
     type: ClusterIP
   ```

2. **压测工具（testdns[Golang]）**：
   
   - **代码功能**：并发解析 `my-nginx.default` 域名，统计成功率、延迟和超时次数。  ()
   - **测试结果**：  
     - 平均解析时间：35-38ms  
     - 超时请求数（>5s）：约 280-317 次  
     - 最大延迟：10s+  
   
3. **测试命令**：
   ```bash
   # 进入测试 Pod
   kubectl exec -ti test /bin/sh
   # 执行压测（200 并发，持续 30 秒，阈值为5000ms）
   ./testdns -host my-nginx.default -c 200 -d 30 -l 5000
   ```
#### **三、NodeLocal DNSCache 部署与优化**

- **部署背景**

  - **问题**：大规模集群中 CoreDNS 因 **conntrack 竞争**导致 DNS 查询超时。

  - **目标**：通过 NodeLocal DNSCache 实现 **本地 DNS 缓存**，降低延迟并提升可靠性。

- **核心原理**：

   - **本地缓存**：每个节点部署 DaemonSet（并且使用 hostNetwork 模式），监听 `169.254.20.10`（宿主机上的特殊网卡 nodelocaldns），缓存 DNS 解析结果。  

   - **减少竞争**：避免 conntrack 冲突，降低内核资源消耗，提升 UDP 包处理效率。  

   - **TCP 升级**：未命中缓存时，使用 TCP 向上游 CoreDNS 查询，减少 UDP 丢包。  

     <img src="https://ccwu-1316557530.cos.ap-guangzhou.myqcloud.com/0762b60c26b5648681e2722940926f0038446735.png" alt="img" style="zoom: 50%;" />

- **部署步骤**：
   - **下载官方清单**：
     ```bash
     wget https://github.com/kubernetes/kubernetes/raw/master/cluster/addons/dns/nodelocaldns/nodelocaldns.yaml
     ```
   - **配置变量**：
     
     ```bash
     # 定义 CoreDNS ClusterIP、本地监听 IP、集群域
     kubedns=10.96.0.10
     localdns=169.254.20.10
     domain=cluster.local
     # 替换占位符为实际的值（IPVS 模式示例）
     sed -ri "s/__PILLAR_LOCAL_DNS__/$localdns/g; s/__PILLAR_DNS_DOMAIN__/$domain/g; s/,?__PILLAR_DNS_SERVER__//g; s/__PILLAR_CLUSTER_DNS__/$kubedns/g" nodelocaldns.yaml
     ```
   - **修改镜像地址为自己的（可选）**
   - **部署 DaemonSet**：
     
     ```bash
     kubectl apply -f nodelocaldns.yaml
     ```

- **调整 kubelet 配置（仅 IPVS 模式）**：
   - **修改 `/var/lib/kubelet/config.yaml`**：
     ```yaml
     clusterDNS:
     - 169.254.20.10  # 原值为 10.96.0.10
     ```
   - **重启 kubelet**：
     ```bash
     systemctl restart kubelet
     ```
#### **四、优化后性能测试**
1. **验证本地 DNS 解析**：
   ```bash
   # 检查本地监听 IP
   ip a | grep 169.254.20.10
   # 测试解析（宿主机执行）
   dig @169.254.20.10 my-nginx.default.svc.cluster.local
   ```

2. **压测结果对比**：
   - **优化前**：
     - 平均解析时间：35-38ms  
     - 超时请求数：约 280-317 次  
   - **优化后**：
     - 平均解析时间：27ms（降低 30%）  
     - 超时请求数：约 300-346 次（部分场景仍有提升空间）  

3. **关键命令**：
   ```bash
   # 重建 Pod 以应用新 DNS 配置
   kubectl delete pod test
   kubectl run test --image=centos:7 -- sleep 10000
   # 重新压测
   kubectl exec -ti test -- ./testdns -host my-nginx.default -c 200 -d 30 -l 5000
   ```
