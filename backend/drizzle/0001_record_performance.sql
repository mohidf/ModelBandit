-- record_performance: fold one observation into a model's running averages.
--
-- Called after every provider call. The first call for a (model_id, task_type)
-- pair inserts the raw values; every later call blends them in with an
-- exponential moving average:
--
--   new = p_alpha * observation + (1 - p_alpha) * old
--
-- It's one INSERT ... ON CONFLICT statement, so two requests finishing at the
-- same time for the same model serialise on the row lock instead of racing.

CREATE OR REPLACE FUNCTION record_performance(
  p_model_id    TEXT,
  p_provider    TEXT,
  p_tier        TEXT,
  p_task_type   TEXT,
  p_latency_ms  DOUBLE PRECISION,
  p_confidence  DOUBLE PRECISION,
  p_escalated   BOOLEAN,
  p_cost_usd    DOUBLE PRECISION,
  p_alpha       DOUBLE PRECISION DEFAULT 0.2
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_escalated_num DOUBLE PRECISION := CASE WHEN p_escalated THEN 1.0 ELSE 0.0 END;
BEGIN
  INSERT INTO performance_stats (
    model_id, provider, tier, task_type,
    total_requests, avg_latency_ms, avg_confidence, escalation_rate, avg_cost_usd, updated_at
  ) VALUES (
    p_model_id, p_provider, p_tier, p_task_type,
    1, p_latency_ms, p_confidence, v_escalated_num, p_cost_usd, NOW()
  )
  ON CONFLICT (model_id, task_type) DO UPDATE SET
    avg_latency_ms  = p_alpha * p_latency_ms    + (1.0 - p_alpha) * performance_stats.avg_latency_ms,
    avg_confidence  = p_alpha * p_confidence    + (1.0 - p_alpha) * performance_stats.avg_confidence,
    escalation_rate = p_alpha * v_escalated_num + (1.0 - p_alpha) * performance_stats.escalation_rate,
    avg_cost_usd    = p_alpha * p_cost_usd      + (1.0 - p_alpha) * performance_stats.avg_cost_usd,
    total_requests  = performance_stats.total_requests + 1,
    updated_at      = NOW();
END;
$$;
