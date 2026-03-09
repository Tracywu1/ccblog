---
title: "PromQL"
draft: false
tags: ["k8s", "进阶", "监控"]
---

## **一、PromQL 介绍**
- **定义**：PromQL 是 Prometheus 内置的数据查询语言，用于处理时间序列数据。
- **核心作用**：支持数据过滤、聚合、计算，是告警、仪表盘等功能的底层基础。
- **官方文档**：[PromQL Basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
## **二、数据格式解析**
### **1.  采集的数据格式**
- **示例数据**：
  
  ```text
  # 采集的数据
  # HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.（CPU 在每种模式下花费的总秒数）
  # TYPE node_cpu_seconds_total（counter node_cpu_seconds_total的类型是 counter，即计数器，它的值只能递增
  node_cpu_seconds_total{cpu="0",mode="idle"} 3853.38 # idele：空闲
  ```
  
- **组成部分**：
  1. **指标（Metric）**：
     - 格式：`<metric name>{<label1>=<value1>, <label2>=<value2>, ...}`
     - `<metric name>` 和 `<label>` 命名规则：ASCII字符、数字、下划线、冒号，符合正则 `[a-zA-Z_:][a-zA-Z0-9_:]*`。
     - 标签（Labels）：描述样本特征和维度（如监控哪颗cpu的什么状态），用于过滤和聚合。
  2. **指标值（Value）**：浮点数，表示当前样本的数值。
  3. **时间戳（Timestamp）**：精确到毫秒，由 Prometheus 自动附加。
### 2. 时间序列/向量

#### **2.1 时间序列（Time Series）**

- **定义**：每个样本按时间顺序存储为时间序列（Time Series）。
- **存储方式**：Prometheus 将时间序列数据保存在内存数据库（TSDB）中，并定期持久化到磁盘。
- **存储格式**：`<metric-name>{labels}@<timestamp> => <value>`。
- **示例**：`http_request_total{status="200", method="GET"}@1434417560938 => 94355`。

- ##### **特点**
  - **周期性采集**：通过 `scrape_interval` 配置采集间隔（如 `15s`），定期生成新数据点。

  - **连续性存储**：同一指标按时间顺序形成连续数据序列，例如：  
    
    `数据点1 → 数据点2 → 数据点3 → ...`
#### **2.1 向量（Vector）**
向量是时间序列的集合，分为以下三种类型：
##### **2.1.1 瞬时向量（Instant Vector）**
- **定义**：某一时刻最新的单个样本值集合。
- **用途**：
  - **实时查询**：获取当前系统状态（如 `node_memory_MemFree_bytes` 查询当前内存）。
  - **仪表盘展示**：显示最新指标值。
- **示例**：  
  ```promql
  node_cpu_seconds_total{cpu="0", mode="idle"}  # 返回 CPU 0 空闲时间的最新值
  ```
##### **2.1.2 区间向量（Range Vector）**
- **定义**：一段时间范围内的样本值集合，需通过时间范围选择器（如 `[5m]`）指定区间。
- **用途**：
  - **趋势分析**：计算速率（`rate()`）、增量（`increase()`）等。
  - **聚合计算**：统计总和（`sum_over_time()`）、平均值（`avg_over_time()`）。
- **示例**：  
  
  ```promql
  sum_over_time(container_cpu_usage_seconds_total[1h])  # 过去 1 小时 CPU 使用总量
  ```
##### **2.1.3 标量（Scalar）**
- **定义**：单一浮点数值，可以是常量或计算结果。
- **用途**：
  - **阈值比较**：如 `node_load1 > 1`。
  - **数值计算**：与其他向量进行运算（如百分比计算）。
  - **聚合结果转换**：使用 `scalar()` 将瞬时向量转为标量。
- **示例**：  
  ```promql
  (node_memory_MemFree_bytes / node_memory_MemTotal_bytes) * 100  # 计算内存使用百分比
  ```

- **`scalar()` 函数的作用**

  - **核心功能**	

    - **强制类型转换**：将瞬时向量（可能包含多个样本）转换为单一标量值。如果瞬时向量中包含多个样本，`scalar()` 会返回 `NaN`。

    - **避免多值冲突**：确保表达式结果类型匹配。
#### **2.3 指标数据类型**
Prometheus 定义四种指标类型：

1. **Counter（计数器）**：
   
   - **特点**：只增不减（如请求数、错误数）。
   - **应用场景**：
     - 统计增长率：`rate(node_cpu_seconds_total[5m])`。
     - 请求量排名：`topk(3, http_requests_total)`。
   
2. **Gauge（仪表盘）**：
   - **特点**：可增可减（如内存使用、cpu温度）。
   - **应用场景**：
     - 当前状态查询：`node_memory_MemAvailable_bytes`。
     - 变化量计算：`delta(cpu_temp_celsius[2h])`。
     - 趋势预测：`predict_linear(node_filesystem_free_bytes[24h], 5d)`。

3. **Histogram（直方图）**：
   
   - **特点**：按桶（Bucket）统计样本分布。
   
   - **结构**：
     - `_bucket{le="<上限>"}`：各桶（包含所有指标数据<=上限）的样本计数。 
       - **分桶原理**
         - Histogram 将整个数值范围划分为多个**连续区间**（桶）。
         - 每个桶由一个 `le` 标签标识其**上边界值**（例如 `le="0.1"` 表示 ≤ 0.1 的桶）。
         - 桶的范围通常是递增的，如：`[0, 0.005)`, `[0.005, 0.01)`, `[0.01, 0.025)`, ..., `[0.5, +Inf)`。
     - `_sum`：所有样本值的总和。
     - `_count`：样本总数。
     
   - **应用场景**：
     - 计算分位数：`histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))`。（计算一个持续时间值，使得99%的HTTP请求的持续时间都小于或等于这个值）
     
       - **客户端只做简单统计**：
         - 统计每个桶内的数据点数量
         - 计算总和 (`_sum`)
         - 计数数据点总数 (`_count`)
     
       - **服务端后期处理**：
     
         ```promql
         # 计算 95% 响应时间
         histogram_quantile(0.95, 
           rate(http_request_duration_seconds_bucket[5m])
         )
         ```
     
         - 需要专门计算函数 `histogram_quantile()`
         - 查询时进行复杂的分布计算
     
           - **获取总样本数**：从 `_count` 指标中获取总请求数，比如是 `15000`。
     
           - **计算目标计数**：95% 的请求数是 `15000 * 0.95 = 14250`。
       
           - **寻找合适的桶**：Prometheus 开始遍历所有的桶 (_bucket指标)，寻找第一个计数大于或等于 `14250`
       
             的桶。
       
             - 它发现 `le="0.1"` 的桶计数是 `10500`（不够）。
             - 它发现 `le="0.2"` 的桶计数是 `14800`（够了！）。
       
           - **进行线性插值**（最复杂的一步）：
       
             - 我们知道 95% 的请求（第 14250 个请求）落在 `0.1` 秒和 `0.2` 秒之间。
             - 但我们只知道在 `0.1` 秒时有 `10500` 个请求，在 `0.2` 秒时有 `14800` 个请求。
             - **Histogram 无法精确知道第 14250 个请求的真实耗时**，它只能做一个**估算**。它假设这 `14800 - 10500 = 4300` 个请求是**均匀分布**在 `0.1` 到 `0.2` 这个区间内的。
             - 通过线性插值公式，它会估算出一个值，这个值就是 `histogram_quantile(0.95, ...)` 的结果。
       
       - **存储结构**：
       
         ```yaml
         # 假设定义桶边界（单位:s）：[0.1, 0.5, 1.0, +Inf]
         # 每个桶的累积计数
         http_request_duration_seconds_bucket{le="0.1"} 20	# 有 20 个请求的持续时间 ≤ 0.1 秒,P20
         http_request_duration_seconds_bucket{le="0.5"} 45	# P45
         http_request_duration_seconds_bucket{le="1.0"} 70	# P70
         http_request_duration_seconds_bucket{le="+Inf"} 100
         
         # 全局总和和计数
         http_request_duration_seconds_sum 52.7	# 所有 100 个请求的总耗时为 52.7 秒
         http_request_duration_seconds_count 100
         ```
   
4. **Summary（摘要）**：
   - **特点**：预计算分位数（如 P50、P99），直接暴露结果。
   
   - **结构**：
     
     - `{quantile="<分位>"}`：各分位对应的值。
     - `_sum` 和 `_count` 同 Histogram。
     
   - **计算分位数**：
   
     - **客户端承担重计算**：
   
       - 直接在应用内计算分位数
       - 使用如 `go-kit` 等库实现算法
   
     - **服务端即取即用**：
   
       ```
       # 直接获取 90% 响应时间
       http_request_duration_seconds{quantile="0.9"}
       ```
   
       - 无需特殊计算函数
       - 数值直接存储在标签值中
   
     - **存储结构**：
   
       ```yaml
       http_request_duration_seconds{quantile="0.5"} 0.23	# quantile="0.5"：P50，50% 的请求耗时 ≤ 0.23 秒
       http_request_duration_seconds{quantile="0.9"} 0.42
       http_request_duration_seconds{quantile="0.99"} 1.56
       http_request_duration_seconds_sum 52.7
       http_request_duration_seconds_count 100
       ```

**长尾问题处理**：

- **长尾问题**：
  
  - 在一个数据集中，大部分数据点集中在某个较小的范围内，但仍有少量数据点分布在远离中心的尾部。这些尾部的数据虽然数量少，但可能对整体数据分析产生重要影响，尤其是在性能分析中。
  - 例如，在系统的API调用中，如果大部分请求的响应时间都在100ms左右，但有个别请求的响应时间达到了5秒，这些极慢的请求会显著影响平均响应时间的统计结果，使得平均值不能真实反映大部分请求的体验。
  - 在处理长尾问题时，通常需要采用更合适的方法来分析和呈现数据，例如使用百分位数（如95%或99%分位数）来描述大多数数据的性能，而不是仅仅依赖平均值。
  
  ```mermaid
  graph LR
      subgraph Histogram [Histogram 工作流]
      direction LR
      A[应用产生原始值] --> B[客户端预聚合]
      B --> C1[计数 count]
      B --> C2[求和 sum]
      B --> C3[桶统计 bucket]
      C3 --> D[服务端计算] --> E[查询时分位数]
      end
      
      subgraph Summary [Summary 工作流]
      direction LR
      F[应用产生原始值] --> G[客户端计算]
      G --> H[分位数 ready]
      H --> I[服务端直接暴露]
      I --> J[查询时分位数]
      end
  ```
  
  - **Histogram**：通过桶统计分布，需计算分位数，支持跨实例聚合。
  
    ```
    # 跨多个实例计算全局API延迟P95
    # 计算过去 5 分钟内，每个路由路径的 HTTP 请求延迟的 95 分位数
    histogram_quantile(0.95, 
      sum by(le, route) (	# 对 api_request_duration_seconds_bucket 指标按 le（桶边界）和 route（路由路径）分组求和
        rate(api_request_duration_seconds_bucket[5m])
      )
    )
    ```
  
    优点：集群级别的精确分布视图
  
  - **Summary**：直接暴露分位数，无需后期计算，分位数无法聚合。
  
    ```
    # 数据库实例的内部队列监控
    metrics:
      tx_queue_wait_time:
        type: summary
        quantiles: {0.5: 0.01, 0.99: 0.001}
    ```
  
    优点：实例内部状态的高精度统计

## 三、PromQL 查询语法

### **1. 基本查询**
- **查询结构**：以指标名称为起点，格式为 `<metric name>{<label name>=<label value>, ...}`。
- **常用指标示例**：
  
  ```promql
  node_memory_MemTotal_bytes             # 节点总内存
  node_memory_MemFree_bytes              # 节点剩余可用内存
  node_memory_MemTotal_bytes{instance="master01"}  # 指定节点的总内存
  node_disk_io_time_seconds_total{device="sda"}    # 指定磁盘的每秒 IO 时间
  node_filesystem_free_bytes{device="/dev/sda1", fstype="xfs", mountpoint="/boot"}  # 指定分区的剩余空间
  node_load1, node_load5, node_load15    # 系统负载（1、5、15分钟）
  ```
### **2. 过滤器**
- **标签过滤运算符**：
  
  - `=`：等于
  - `!=`：不等于
  - `=~`：正则匹配（支持 [RE2 语法](https://github.com/google/re2/wiki/Syntax)）
  - `!~`：正则不匹配
  
- **组合过滤**：
  - 逗号分隔多个标签过滤器表示 **AND 关系**。
  - `or` 关键字表示 **OR 关系**。
  ```promql
  # 排除指定实例
  node_cpu_seconds_total{instance!="node01", instance!="master01"}
  
  # 正则匹配实例名以 "master" 开头且 CPU 空闲的指标
  node_cpu_seconds_total{instance=~"master.*", mode="idle"}
  
  # OR 关系查询（两种写法）
  node_cpu_seconds_total{instance=~"master.*"} or node_cpu_seconds_total{mode="idle"}
  node_cpu_seconds_total{instance=~"master01|master02"}  # 同一标签正则合并
  ```
### **3. 时间范围**
- **时间单位**：
  - `s`（秒）、`m`（分钟）、`h`（小时）、`d`（天）、`w`（周）、`y`（年）。
- **区间向量查询**：
  - 格式：`<metric>{}[<time>]`（如 `node_cpu_seconds_total[5m]`）。
  - **必须结合函数使用**（如 `rate()`、`irate()`），否则无法直接渲染。
- **函数对比**：
  - `rate()`：计算区间内 **平均速率**（适合平滑趋势）。
  - `irate()`：基于区间内 **最后两个样本** 计算瞬时速率（适合快速变化监控）。
  - 计算时使用的实际时间：Prometheus显示的最后一个时间戳 - 第一个时间戳
  ```promql
  rate(node_cpu_seconds_total{mode="idle"}[5m])          # 过去5分钟平均空闲率
  irate(node_cpu_seconds_total{mode="idle"}[1m])         # 最近1分钟的瞬时速率
  ```
- **历史查询**（`offset`）：
  ```promql
  node_cpu_seconds_total{instance="node01"} offset 30m   # 查询30分钟前的数据
  rate(node_cpu_seconds_total[5m] offset 5h)             # 5小时前的5分钟增长率
  ```
### **4. 运算符**
- **算术运算符**：`+`、`-`、`*`、`/`、`%`、`^`。
  ```promql
  node_memory_MemFree_bytes / 1024 / 1024                # 字节转兆字节
  node_disk_read_bytes_total{device="sda"} + node_disk_written_bytes_total{device="sda"}  # 磁盘总读写量
  ```
- **比较运算符**：`==`、`!=`、`>`、`<`、`>=`、`<=`。
- **逻辑运算符**（仅限瞬时向量）：
  - `and`：交集
  - `or`：并集
  - `unless`：排除匹配项
  ```promql
  # 查询 CPU 空闲或实例以 "master" 开头的指标
  node_cpu_seconds_total{mode="idle"} or node_cpu_seconds_total{instance=~"master.*"}
  ```
### **5. 聚合运算**
#### **5.1 基础聚合**
- `max()`、`min()`、`avg()`：
  
  ```promql
  max(node_network_receive_bytes_total) by (instance)     # 各节点最大接收流量
  avg(rate(node_cpu_seconds_total[5m])) by (mode)         # 各 CPU 模式的平均使用率
  ```

#### **5.2 统计聚合**
- `sum()`：求和。
- `count()`：统计条目数。
  ```promql
  sum(prometheus_http_requests_total)                     # 总 HTTP 请求数
  count(node_os_version{kubernetes_io_hostname=~".*"})    # 统计符合条件的记录数
  ```

#### **5.3 其他函数**
- `abs()`、`absent()`：
  ```promql
  absent(sum(prometheus_http_requests_total))             # 监控项不存在时返回1（用于告警）
  ```
  
  > 应用场景：制作“死活”告警或“心跳”检测告警
  >
  > 例如，一个关键的批处理任务每天都应该上报它的执行结果指标。我们可以使用 `absent(job_last_success_timestamp)` 来告警。如果这个任务今天没有运行，导致该指标不存在，`absent()` 就会返回 1，从而触发告警，通知我们任务“失联”了。
- `stddev()`、`stdvar()`：
  ```promql
  stddev(prometheus_http_requests_total)                  # 标准差（衡量数据波动）
  ```
- `topk()`、`bottomk()`：
  ```promql
  topk(5, node_memory_MemFree_bytes)                      # 内存剩余最多的前5节点
  bottomk(5, node_load1)                                  # 负载最低的5节点
  ```

#### **5.4 分组与排除**
- `by`：按指定标签分组。
- `without`：排除指定标签。
  ```promql
  sum(rate(node_network_receive_bytes_total[5m])) by (instance)  # 按实例分组统计
  sum(prometheus_http_requests_total) without (instance, job)    # 排除实例和任务标签
  ```

