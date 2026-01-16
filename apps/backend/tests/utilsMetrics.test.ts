import {
  metricsRegistry,
  recordRetryAttempt,
  recordRetryOutcome,
  recordWalletOperation,
  recordWalletRaceConflict,
  setCircuitState,
} from '../src/utils/metrics.js';

describe('utils: metrics', () => {
  it('records counters and gauges in the registry', async () => {
    recordWalletOperation({ operation: 'increment', amount: 5 });
    recordWalletRaceConflict();
    setCircuitState('metrics-test', 'open');
    recordRetryAttempt('metrics-test');
    recordRetryOutcome({ service: 'metrics-test', outcome: 'success' });

    const output = await metricsRegistry().metrics();
    expect(output).toMatch(/memalerts_wallet_operations_total\{operation="increment"\} \d+/);
    expect(output).toMatch(/wallet_race_conflicts_total \d+/);
    expect(output).toMatch(/memalerts_circuit_state\{service="metrics-test",state="open"\} 1/);
    expect(output).toMatch(/memalerts_http_client_retry_attempts_total\{service="metrics-test"\} \d+/);
    expect(output).toMatch(
      /memalerts_http_client_retry_outcomes_total\{service="metrics-test",outcome="success"\} \d+/
    );
  });
});
