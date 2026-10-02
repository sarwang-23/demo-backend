export class Metrics {
    constructor() { this.requests = new Map(); this.count = 0; this.durationSum = 0; this.active = 0; this.start = Date.now(); this.buckets = new Map([0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60].map(x => [x, 0])); }
    observe(status, seconds) { this.requests.set(String(status), 1 + (this.requests.get(String(status)) || 0)); this.count++; this.durationSum += seconds; for (const [b, n] of this.buckets)
        if (seconds <= b)
            this.buckets.set(b, n + 1); }
    render() {
        const out = ['# TYPE carbonsynq_http_requests_total counter'];
        for (const [status, count] of this.requests)
            out.push(`carbonsynq_http_requests_total{status="${status}"} ${count}`);
        out.push('# TYPE carbonsynq_http_duration_seconds histogram');
        for (const [b, n] of this.buckets)
            out.push(`carbonsynq_http_duration_seconds_bucket{le="${b}"} ${n}`);
        out.push(`carbonsynq_http_duration_seconds_bucket{le="+Inf"} ${this.count}`, `carbonsynq_http_duration_seconds_sum ${this.durationSum}`, `carbonsynq_http_duration_seconds_count ${this.count}`, '# TYPE carbonsynq_http_active gauge', `carbonsynq_http_active ${this.active}`, '# TYPE carbonsynq_process_uptime_seconds gauge', `carbonsynq_process_uptime_seconds ${(Date.now() - this.start) / 1000}`);
        return out.join('\n') + '\n';
    }
}
