# Analysis: What Broke in walletSlice Implementation (Commit 9376e82)

## Executive Summary

Commit 9376e82 introduced `walletSlice` to optimize wallet and submissions requests using Redux store. However, this implementation caused infinite loops and page freezes. The root causes are:

1. **Unstable selectors with `Date.now()`** - Selectors call `Date.now()` on every render, creating new return values each time
2. **useEffect dependencies on unstable selector results** - useEffect depends on values that change on every render
3. **Missing refs for loading state tracking** - Removed refs that prevented duplicate dispatches
4. **Array length in dependencies** - `submissions.length` in dependencies causes unnecessary re-runs

## Detailed Root Cause Analysis

### Issue 1: Unstable Selectors with Date.now()

**Location**: `src/store/slices/walletSlice.ts` lines 100-111

**Problem Code**:
```typescript
export const selectWallet = (state: { wallet: WalletState }, channelSlug: string): Wallet | null => {
  const entry = state.wallet.wallets[channelSlug];
  if (!entry) return null;
  
  // Check if cache is still valid
  const now = Date.now();  // ❌ PROBLEM: Called on every render
  if (now - entry.timestamp > WALLET_CACHE_TTL) {
    return null; // Cache expired
  }
  
  return entry.data;
};
```

**Why This Causes Infinite Loops**:
1. Component renders → `useAppSelector(selectWallet)` runs
2. Selector calls `Date.now()` → returns NEW value (e.g., 1703012345678)
3. Even though wallet data hasn't changed, React sees a "new" execution path
4. React's reconciliation might trigger re-render
5. Re-render → selector runs again → `Date.now()` returns different value → loop continues

**Evidence**: The selector is called inside `useAppSelector`, which runs on every render. Since `Date.now()` returns a different value each time (even if just milliseconds apart), the selector appears to return a "different" result, triggering React's change detection.

### Issue 2: useEffect Dependencies on Selector Results

**Location**: `src/components/Header.tsx` lines 89-117, `src/pages/StreamerProfile.tsx` lines 128-133

**Problem Code in Header.tsx**:
```typescript
const reduxWallet = useAppSelector((state) => targetChannelSlugForWallet ? selectWallet(state, targetChannelSlugForWallet) : null);
const walletLoading = useAppSelector((state) => targetChannelSlugForWallet ? selectWalletLoading(state, targetChannelSlugForWallet) : false);

// Later in useEffect:
useEffect(() => {
  // ...
  if (reduxWallet) {  // ❌ PROBLEM: reduxWallet in condition
    return;
  }
  if (walletLoading) {  // ❌ PROBLEM: walletLoading in condition
    return;
  }
  dispatch(fetchWallet({ channelSlug: targetChannelSlugForWallet }));
}, [user, targetChannelSlugForWallet, reduxWallet, walletLoading, dispatch, location.pathname]);
// ❌ PROBLEM: reduxWallet and walletLoading in dependencies
```

**Why This Causes Infinite Loops**:
1. `reduxWallet` and `walletLoading` are values from unstable selectors (Issue 1)
2. They appear to change on every render
3. useEffect sees dependency change → runs effect
4. Effect might dispatch action → Redux updates → selector runs → returns "new" value → useEffect runs again

**Evidence from StreamerProfile.tsx**:
```typescript
useEffect(() => {
  if (user && slug) {
    if (!reduxWallet && !walletLoading) {  // ❌ Using selector results
      dispatch(fetchWallet({ channelSlug: slug }));
    }
  }
}, [user, slug, reduxWallet, walletLoading, dispatch]);
// ❌ reduxWallet and walletLoading in dependencies
```

### Issue 3: submissions.length in Dependencies

**Location**: `src/components/Header.tsx` line 84, `src/pages/Dashboard.tsx` line 37, `src/pages/Admin.tsx`

**Problem Code**:
```typescript
useEffect(() => {
  // ...
}, [user, user?.role, user?.channelId, submissions.length, submissionsLoading, dispatch]);
// ❌ PROBLEM: submissions.length in dependencies
```

**Why This Causes Problems**:
1. `submissions` is an array from Redux
2. When Redux updates (even with same length), array reference changes
3. `submissions.length` itself is stable, but when combined with unstable selectors, it amplifies re-renders
4. Combined with Issue 1 and 2, this creates cascading effects

**Working Version (94eb6ed)**:
```typescript
const submissionsLoadedRef = useRef(false);
useEffect(() => {
  if (user && ... && !submissionsLoadedRef.current) {
    if (submissions.length === 0) {
      submissionsLoadedRef.current = true;
      dispatch(fetchSubmissions({ status: 'pending' }));
    }
  }
}, [user, user?.role, user?.channelId, submissionsLoading, dispatch]);
// ✅ No submissions.length in dependencies, uses ref instead
```

### Issue 4: Missing Refs for Loading State Tracking

**Location**: Multiple files - refs were removed in 9376e82

**Problem**: 
- `submissionsLoadedRef` was removed from Header.tsx, Dashboard.tsx, Admin.tsx
- `walletLoadedRef` was removed from Header.tsx

**Why This Causes Problems**:
1. Refs prevent duplicate dispatches by tracking if we've already attempted to load
2. Without refs, useEffect might dispatch `fetchSubmissions` or `fetchWallet` multiple times
3. Multiple dispatches → multiple Redux updates → multiple re-renders
4. Combined with unstable selectors, this creates cascading re-renders

**Working Version (94eb6ed) - Header.tsx**:
```typescript
const submissionsLoadedRef = useRef(false);
const walletLoadedRef = useRef<string | null>(null);

useEffect(() => {
  if (user && ... && !submissionsLoadedRef.current) {
    // Only dispatch if ref says we haven't tried yet
    submissionsLoadedRef.current = true;
    dispatch(fetchSubmissions({ status: 'pending' }));
  }
}, [user, ...]); // ✅ Stable dependencies, ref prevents duplicates
```

## Comparison: Working vs Broken

### Working Version (94eb6ed)

**Wallet Loading**:
- Uses `useState<Wallet | null>` for local component state
- Uses `useRef` to track loading attempts (`walletLoadedRef`)
- useEffect dependencies are stable (user, channelId, etc.)
- No `Date.now()` in render cycle
- Wallet loaded via direct API call, stored in component state

**Submissions Loading**:
- Uses `useRef` to track loading attempts (`submissionsLoadedRef`)
- useEffect dependencies don't include array length
- Checks `submissions.length === 0` inside effect, not in dependencies

### Broken Version (9376e82)

**Wallet Loading**:
- Uses `useAppSelector` with unstable selector (calls `Date.now()`)
- No refs for loading tracking
- useEffect depends on selector results (`reduxWallet`, `walletLoading`)
- Selector runs on every render, potentially returning different values

**Submissions Loading**:
- Removed `submissionsLoadedRef`
- useEffect depends on `submissions.length` (array reference might change)
- No mechanism to prevent duplicate dispatches

## The Cascade Effect

These issues combine to create a perfect storm:

1. Component renders
2. `useAppSelector(selectWallet)` runs → calls `Date.now()` → returns "new" value
3. React sees selector return value as "changed" → triggers re-render
4. useEffect sees `reduxWallet` dependency "changed" → runs effect
5. Effect might dispatch action → Redux updates
6. Redux update → all selectors re-run → `Date.now()` returns different value
7. Component re-renders → back to step 2 → infinite loop

## Solutions

1. **Fix selectors**: Remove `Date.now()` from selectors, make them stable by returning data directly
2. **Move TTL check**: Do TTL validation in `fetchWallet` thunk or in useEffect before dispatching
3. **Fix useEffect dependencies**: Remove unstable dependencies (`reduxWallet`, `walletLoading`, `submissions.length`), use refs instead
4. **Add back loading tracking**: Use refs (`walletLoadedRef`, `submissionsLoadedRef`) to prevent duplicate dispatches
5. **Check state directly**: Use `store.getState()` inside useEffect to check state without creating dependencies

## Recommended Fix Strategy

1. Keep walletSlice but make selectors stable (no Date.now())
2. Check TTL in fetchWallet thunk or useEffect before dispatching
3. Use refs to track loading attempts (don't depend on selector results)
4. Check Redux state directly in useEffect using `store.getState()` if needed
5. Keep `submissions.length` out of dependencies, use refs instead
