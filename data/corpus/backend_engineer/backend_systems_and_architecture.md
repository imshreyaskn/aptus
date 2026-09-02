# Modern Backend Engineering: Systems Architecture, Data Storage, and Distributed Reliability

# Chapter 1: Database Storage Engines: B-Trees vs. LSM-Trees
Relational databases (PostgreSQL, MySQL InnoDB) traditionally rely on B+ Trees. B+ Trees store keys and records in balanced tree nodes, keeping leaf nodes in a doubly-linked list for efficient sequential range scans. Updates are in-place, requiring random disk I/O and Write-Ahead Logging (WAL) for durability. In contrast, Log-Structured Merge-Trees (LSM-Trees, used in RocksDB, Cassandra, Bigtable) append incoming writes sequentially to an in-memory MemTable backed by a commit log. When the MemTable fills, it flushes immutable Sorted String Tables (SSTables) to disk. Background compaction merges and deduplicates SSTables. LSM-Trees offer superior write throughput and storage compression at the expense of read amplification and compaction I/O overhead.

# Chapter 2: ACID Transactions and Isolation Levels
ACID guarantees database reliability. Atomicity ensures all-or-nothing execution via WAL rollback. Consistency preserves defined schema invariants and foreign keys. Isolation prevents concurrent transactions from interfering. Durability guarantees committed writes survive crashes via fsync to non-volatile storage. The ANSI SQL isolation levels address concurrency anomalies:
- Read Uncommitted: Permits Dirty Reads (reading uncommitted writes).
- Read Committed: Prevents dirty reads; vulnerable to Non-Repeatable Reads. Implemented in Postgres via Multi-Version Concurrency Control (MVCC), where each query sees a snapshot created at query start.
- Repeatable Read: Prevents non-repeatable reads by fixing the snapshot at transaction start; vulnerable to Write Skew anomalies.
- Serializable: Strongest isolation; eliminates Phantom Reads and Write Skew using Two-Phase Locking (2PL) or Serializable Snapshot Isolation (SSI).

# Chapter 3: Distributed Systems, CAP Theorem, and Consensus Protocols
Distributed architectures partition work across independent networked nodes. The CAP Theorem proves that a distributed data store can guarantee at most two of three properties under network partitioning ($P$): Consistency ($C$, linearizable real-time single-copy consistency) or Availability ($A$, every non-failing node returns non-error responses). PACELC extends CAP: if partitioned ($P$), choose between Availability ($A$) and Consistency ($C$); Else ($E$), choose between Latency ($L$) and Consistency ($C$). Distributed consensus algorithms (Raft, Paxos) ensure replica nodes agree on an ordered state machine log despite node crashes and network delays, using leader election, term numbering, and majority quorum ($N/2 + 1$).

# Chapter 4: Caching Architectures, Invalidation, and Eviction Policies
Caching mitigates database latency and load. Caching topologies include Cache-Aside (Lazy Loading: application checks cache, falls back to DB on miss, and updates cache), Read-Through (cache acts as primary reader), Write-Through (writes update cache and DB synchronously), and Write-Behind / Write-Back (writes update cache immediately and asynchronously batch-write to DB). Invalidation challenges include the Thundering Herd / Cache Stampede (multiple threads simultaneously query DB on key expiry; mitigated via distributed locks or probabilistic early recomputation). Eviction policies include Least Recently Used (LRU), Least Frequently Used (LFU), and TinyLFU.

# Chapter 5: API Architecture, Idempotency, and Fault-Tolerance Patterns
Robust APIs utilize HTTP semantics, REST principles, and explicit error contracts. Idempotency guarantees that multiple identical requests produce the same side-effects as a single request. Mutating endpoints (payments, order placement) implement Idempotency Keys stored in Redis with unique transaction tokens and distributed locking to prevent duplicate processing from network retries. Fault tolerance patterns include:
- Circuit Breaker: Automatically trips to open state when downstream error rate exceeds a threshold, failing fast without overwhelming degraded services.
- Rate Limiting: Token Bucket or Leaky Bucket algorithms enforce throughput limits.
- Exponential Backoff with Jitter: Randomizes retry intervals to prevent synchronized retry storms.

# Chapter 6: Message Brokers, Event-Driven Architecture, and Asynchronous Jobs
Asynchronous architectures decouple producer and consumer execution timelines. Point-to-point Message Queues (RabbitMQ, SQS) deliver messages to worker pools with acknowledgment (ACK/NACK) protocols and dead-letter queues (DLQ) for poisoned messages. Event Log Streaming (Apache Kafka, AWS Kinesis) maintains immutable partitioned append-only logs where consumers track their own offsets, enabling replayability, high throughput, and pub-sub stream processing. The Outbox Pattern ensures atomic database updates and event publishing by writing outgoing messages to an `outbox` table within the local DB transaction, polled or streamed via Change Data Capture (CDC / Debezium).

# Chapter 7: Horizontal Partitioning, Sharding, and Replication
Scaling beyond single-node vertical limits requires replication and sharding. Primary-Replica Replication offloads read traffic to read-replicas, introducing replication lag (eventual consistency). Multi-Primary Replication permits concurrent writes across regions, necessitating conflict resolution (Last-Write-Wins, CRDTs). Database Sharding partitions data horizontally across independent instances using hash-based partitioning or range-based partitioning. Consistent Hashing with virtual nodes distributes keys across a ring topology, minimizing key remapping during node additions or removals.
