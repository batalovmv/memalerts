export function maybeFailDualWrite(step: string): void {
  if (process.env.NODE_ENV !== 'test') return;
  if (process.env.DUAL_WRITE_FAIL_STEP === step) {
    throw new Error(`DUAL_WRITE_FAIL_STEP:${step}`);
  }
}
